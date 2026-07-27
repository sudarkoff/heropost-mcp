# heropost-mcp

An [MCP](https://modelcontextprotocol.io) server for [Heropost](https://heropost.io), the
social-media scheduling tool. It lets an AI agent read your content calendar, pull
engagement analytics, triage the social inbox, and compose scheduled posts — instead of you
clicking through the web UI.

> **Unofficial.** Heropost publishes no public API, no API keys, and no developer docs. This
> project talks to the same private GraphQL services the Heropost web app uses, discovered by
> inspecting that app. It is **not affiliated with, endorsed by, or supported by Heropost**,
> and it can break without warning if they change those services. Use it with your own
> account, at your own risk.

## What it can do

22 tools across six areas. Every tool is prefixed `heropost_`.

| Tool | Type | What it does |
| --- | --- | --- |
| `list_workspaces` | read | Workspaces you can access, with ids and time zones. Start here. |
| `list_accounts` | read | Connected social accounts — id, network, followers, paused/failed state. |
| `list_posts` | read | The content calendar. Filter by status, date range, or publishing failure. |
| `get_post` | read | One post in full: per-network variants, media, per-account failure reasons. |
| `create_post` | write | Compose a post. **Always creates a draft** — never publishes. |
| `update_post` | write | Change text, title, first comment, or intended time. |
| `schedule_post` | write | ⚠️ Queue a draft to publish publicly at its scheduled time. |
| `unschedule_post` | write | Pull a queued post back to drafts so it will not go out. |
| `duplicate_post` | write | Copy a post to a new draft; `failedOnly` retries just the failed networks. |
| `delete_post` | write | ⚠️ Permanently delete a post from Heropost. |
| `upload_post_media` | write | Upload a local image/video and attach it to a post. |
| `get_post_analytics` | read | Reach, views, reactions, comments, shares — bucketed by day/hour/month/post. |
| `get_post_analytics_raw` | read | One row per post per account, for ranking actual posts. |
| `get_account_snapshots` | read | Follower counts over time. |
| `list_inbox_threads` | read | Comments, DMs, and mentions. Filter to unread to triage. |
| `get_inbox_thread` | read | Full message history of one conversation. |
| `reply_to_inbox_thread` | write | ⚠️ Send a reply — publicly visible for comments and mentions. |
| `update_inbox_thread` | write | Mark read / done / bookmarked. Nothing is published. |
| `list_approvals` | read | The post-approval queue. |
| `review_approval` | write | ⚠️ Approve or reject a submitted post. |
| `list_post_comments` | read | Internal team comments on posts (not social comments). |
| `add_post_comment` | write | Add an internal team comment. |

Supported networks: Facebook, Instagram, X, LinkedIn, Pinterest, YouTube, Twitch, Google My
Business, Reddit, Tumblr, Telegram, TikTok, Threads, and Bluesky.

### Safety by design

Publishing to social media is public and irreversible, so:

- **`create_post` only ever creates a draft.** Queueing something is a separate, explicit
  call to `schedule_post`.
- **Nothing publishes immediately.** Heropost's `publishCustomPost` mutation is deliberately
  not exposed.
- **`HEROPOST_READ_ONLY=1` withholds all 11 write tools at registration time** — they are not
  advertised at all, so a model cannot decide to try one.
- Tools whose effects are public say so in their descriptions and are flagged with MCP's
  `destructiveHint`.

Two hardening measures worth understanding, because both defend against *instructions the
model picked up from content it read* rather than against you:

- **`HEROPOST_MEDIA_ROOT` confines uploads.** `upload_post_media` reads a local file and sends
  it to Heropost, where it can end up on a public timeline — so an unrestricted path is an
  exfiltration route for anything image-shaped on disk (a screenshot of a password manager is
  a `.png` like any other). Set this to your media folder. Symlinks are resolved before the
  check, so a link inside the root cannot point outside it.
- **`advancedInput` cannot subvert a write.** The escape hatch below is for supplying fields
  this server hasn't modeled. It is rejected if it tries to set `workspaceId`,
  `customPostId`, `accountIds`, `postStatus`, or anything resembling a publish flag, and it
  can never override an argument you passed explicitly. Otherwise it would be a way to
  retarget a post to another workspace, or to flip a draft into something that publishes.

## Install

```bash
git clone https://github.com/sudarkoff/heropost-mcp.git
cd heropost-mcp
npm install
npm run build
```

Requires Node 20 or newer.

## Authentication

Heropost has no API keys. It uses OpenID Connect at `login.heropost.io`, and every request
carries a bearer access token.

**Run this once:**

```bash
node dist/index.js auth      # or: heropost-mcp auth
```

It walks you through a one-time authorization-code sign-in and stores a **self-renewing
refresh token** at `~/.config/heropost/credentials.json` (mode 0600). The server finds that
file on its own — no environment variables to set — and writes rotated tokens back to it, so
this should not need repeating.

Why a browser step is involved: Heropost's OIDC client only has *its own* app's redirect URIs
registered, so the sign-in lands on `app.heropost.io/callback.html?code=…`, and that page's
JavaScript will spend the authorization code within a fraction of a second. Blocking JavaScript
for that one host leaves the code in the address bar for you to paste back. The command spells
this out step by step; it takes about thirty seconds.

> **`heropost-mcp login` (device code) does not work, and it isn't your setup.** The identity
> provider advertises the grant, but `Heropost.WebFrontend` is not permitted to use it — tested,
> and it returns `unauthorized_client`. The command is kept in case that changes.

### If you'd rather not do the sign-in

You can paste a short-lived access token instead. Be aware this is the option that needs
babysitting: tokens last about an hour, and because Heropost keeps them in memory there is no
refresh token to copy alongside.

### Getting a token

Heropost keeps its OIDC tokens in an **in-memory** store — there is nothing in localStorage or
sessionStorage to copy (verified: a signed-in session has no `oidc.user:…` entry in either).
That's a deliberate, XSS-resistant choice on their part, and it means the only place to see a
token is on a request in flight.

1. Open [app.heropost.io](https://app.heropost.io) and sign in.
2. Open DevTools → **Network**, and filter for `graphql`.
3. Click around the app — the calendar or Insights — so it issues a request.
4. Select any `graphql` request → **Headers** → **Request Headers** → `authorization`.
5. Copy everything **after** `Bearer ` — just the token.

Or, from the console, capture it off the next request automatically:

```js
(() => {
  const orig = window.fetch;
  window.fetch = async (...args) => {
    try {
      const src = args[0] instanceof Request ? args[0].headers : args[1]?.headers;
      const a = new Headers(src || {}).get('authorization');
      if (a?.startsWith('Bearer ')) {
        copy(a.slice(7));
        console.log(`copied token (${a.length - 7} chars)`);
        window.fetch = orig;
      }
    } catch {}
    return orig(...args);
  };
  return 'patched — now click something in the app';
})()
```

**Access tokens expire in about an hour**, and because the tokens live only in memory there is
no refresh token to copy either. In practice that makes `HEROPOST_ACCESS_TOKEN_FILE` the
option worth using: when a call starts failing, repeat the capture above and overwrite that one
file — the running server picks it up on the next call, with no restart and no config change.

### Option 1: a token file (recommended)

```bash
install -m 600 /dev/null ~/.config/heropost/access-token
pbpaste > ~/.config/heropost/access-token     # or paste with an editor
```

```bash
HEROPOST_ACCESS_TOKEN_FILE=/Users/you/.config/heropost/access-token
```

Better than an environment variable for two reasons: the secret stays out of process listings
and out of the MCP client config file you might otherwise commit; and **the file is re-read on
demand**, so when the token expires you paste a new one into the same file and carry on — no
restart, no config edit.

`HEROPOST_REFRESH_TOKEN_FILE` works the same way for a refresh token.

### Option 2: an environment variable

Fine for a quick trial:

```bash
HEROPOST_ACCESS_TOKEN=<the token>
```

`HEROPOST_REFRESH_TOKEN` / `HEROPOST_REFRESH_TOKEN_FILE` are supported and will renew access
tokens on their own — but since Heropost holds tokens only in memory, there is no refresh token
to copy out of the browser. They're there for the day a proper token exchange becomes possible.

A leading `Bearer ` is stripped for you, so pasting the header value as-is is fine.

**Treat both tokens as passwords.** They grant full access to your Heropost account —
including billing, which lives behind the same login. Keep them out of shell history and
version control.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| — | — | **Nothing, if you ran `heropost-mcp auth`** — the credential store is found automatically. |
| `HEROPOST_CREDENTIALS_FILE` | no | Override the credential-store path (default `~/.config/heropost/credentials.json`). |
| `HEROPOST_ACCESS_TOKEN_FILE` | one of these | Path to a file holding an access token. Re-read on demand. |
| `HEROPOST_REFRESH_TOKEN_FILE` | one of these | Path to a file holding a refresh token. |
| `HEROPOST_REFRESH_TOKEN` | one of these | Refresh token; access tokens renew automatically. |
| `HEROPOST_ACCESS_TOKEN` | one of these | A token pasted from a browser session; expires. |
| `HEROPOST_WORKSPACE_ID` | no | Default workspace, so tools don't need it every call. |
| `HEROPOST_READ_ONLY` | no | `1` withholds every write tool. |
| `HEROPOST_MEDIA_ROOT` | no | Confine media uploads to this directory tree. Recommended — see below. |
| `HEROPOST_TIMEOUT_MS` | no | Per-request timeout; defaults to `30000`. |
| `HEROPOST_CLIENT_ID` | no | OIDC client id; defaults to the web app's. |
| `HEROPOST_MAIN_URL` etc. | no | Override a service endpoint (`MAIN`, `POSTING`, `LOGIN`, `NOTIFICATION`). |

## Connecting it

### Claude Code

```bash
claude mcp add heropost \
  --env HEROPOST_WORKSPACE_ID=123 \
  -- node /absolute/path/to/heropost-mcp/dist/index.js
```

No credential env var is needed once you've run `heropost-mcp auth`.

### Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "heropost": {
      "command": "node",
      "args": ["/absolute/path/to/heropost-mcp/dist/index.js"],
      "env": {
        "HEROPOST_WORKSPACE_ID": "123"
      }
    }
  }
}
```

Then try: *"What's scheduled in Heropost next week?"* or *"Which LinkedIn post got the most
engagement last month?"*

To run it without any ability to change anything, add `"HEROPOST_READ_ONLY": "1"`.

## Known limitations

- **Every operation is now validated against real introspected schemas**, including the
  `posting` service (which requires a token even to introspect). If Heropost still rejects a
  call for a field this server doesn't model, every authoring tool takes an `advancedInput`
  object that is merged into the GraphQL input, so you can work around it without a code
  change — and then please
  [file an issue](https://github.com/sudarkoff/heropost-mcp/issues).

  To refresh the schemas after an upstream change:

  ```bash
  npm run introspect                                    # main + login, no token needed
  npm run introspect -- posting --token "$TOKEN"        # auth-gated services
  npm test
  ```

- **Not covered (yet):** RSS automations, the caption and media libraries, watermarks,
  posting groups, team invites and roles, competitor research, and billing. The schemas are
  checked in, so these are mechanical to add — PRs welcome.
- `get_account_snapshots` ignores workspace; filter by `accountIds` or `socials`.
- Heropost's `setPrivateApiCreds` mutation stores raw third-party account passwords. It is
  intentionally **not** exposed as a tool.

## Development

```bash
npm run typecheck        # src and tests
npm test                 # offline: no network, no credentials
npm run build
node scripts/list-tools.mjs --read-only   # confirm writes are withheld
```

The test suite includes a **conformance check** that validates every GraphQL operation
against the checked-in SDL in `schema/`. Since Heropost publishes no schema, this is what
turns an upstream change from a mysterious runtime failure into a failing test. Refresh the
schemas with:

```bash
npm run introspect                                    # main and login (open introspection)
npm run introspect -- posting --token "$TOKEN"        # requires a valid token
```

`docs/api-notes.md` records everything known about the API: the four services and how
operations route between them, the auth flow, and the media-upload sequence. Read it before
adding tools.

## License

MIT — see [LICENSE](LICENSE).
