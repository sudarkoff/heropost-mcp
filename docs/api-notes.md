# Heropost API notes

Heropost publishes no API documentation, no developer portal, and no API keys. Everything
here was established by inspecting the public web app at `app.heropost.io` and by querying
the endpoints it uses. This file exists so the next person — including future you — doesn't
have to repeat that work.

Verified as of **July 2026**. Anything marked *unverified* is inference, flagged as such
deliberately.

## There are four GraphQL services, not one

The frontend uses a single Apollo client that routes by `clientName`. Reads and writes of the
same entity often live on **different services**, which is the single most surprising thing
about this API.

| Service | Endpoint | Introspection | What lives here |
| --- | --- | --- | --- |
| `main` | `https://api.heropost.io/graphql` | **open** | Workspaces, accounts, post *reads*, analytics, social inbox, team/approvals |
| `posting` | `https://posting-api.heropost.io/graphql` | auth-gated | Post *writes*, media upload, scheduling, publishing |
| `notification` | `https://notification-api.heropost.io/graphql` | auth-gated | Notifications |
| `login` | `https://login-api.heropost.io/graphql` | **open** | Users, billing, Stripe checkout |

`api.heropost.io/` serves a GraphQL Playground. The `main` schema has 178 types, 46 queries,
and 55 mutations; `login` has 54 types.

**This is why `main` has no create-post mutation.** `customPosts`, `duplicateCustomPost`, and
`bulkUploadCsv` are on `main`, while `createCustomPost`, `updateCustomPost`,
`deleteCustomPost`, `scheduleCustomPost`, `publishCustomPost`, `setScheduledPostToDraft`,
`selectSocialNetworks`, `selectAccountsForCustomPost`, `uploadPostMedia`, and
`preSignedMediaUploadUrl` are on `posting`.

`api-beta.heropost.io` appeared in older search results and no longer resolves — a reminder
that these endpoints are not stable contracts.

## Authentication

OpenID Connect (OpenIddict), discovery at
`https://login.heropost.io/.well-known/openid-configuration`.

- **Web app flow:** authorization_code + PKCE, `client_id=Heropost.WebFrontend`,
  `redirect_uri=https://app.heropost.io/callback.html`, silent renew via
  `refresh.html`.
- **Scopes requested:** `openid profile email offline_access posting_api.full main_api.full
  notification_api.full admin_api.current_user.read admin_api.current_user.write`. The APIs
  have first-class per-service scopes, so a token can be scoped to one service.
- **Transport:** `Authorization: Bearer <access_token>` on every HTTP GraphQL request; for
  subscriptions, the same value in the WebSocket `connectionParams`.
- **Endpoints:** `/connect/token`, `/connect/authorize`, `/connect/userinfo`,
  `/connect/revocation`, `/connect/introspect`, and `/connect/deviceauthorization`.
- **Advertised grants:** `authorization_code`, `client_credentials`, `refresh_token`,
  `implicit`, `password`, `urn:ietf:params:oauth:grant-type:device_code`.
- **Token storage in the browser:** `oidc-client-ts` `WebStorageStateStore`, under the
  localStorage key `oidc.user:https://login.heropost.io:Heropost.WebFrontend`. Its JSON
  value holds `access_token` and `refresh_token`. This is how you extract a credential by
  hand.

### Unverified, and worth knowing

OpenIddict permits grants **per client**. The grants above are what the *identity provider*
supports; which of them `Heropost.WebFrontend` is actually allowed to use is unknown. In
particular:

- Whether **device_code** works for this client — this determines if `heropost-mcp login`
  functions. One request to `/connect/deviceauthorization` answers it: a device code means
  yes, `unauthorized_client` means no.
- Whether the **password** grant (ROPC) is permitted. Even if it is, it means storing your
  actual Heropost password, which also controls billing through `login-api` — so this
  project does not implement it.
- Whether **client_credentials** can be issued to a third party. There is no
  `registration_endpoint` and no self-service client registration, so machine-to-machine
  access is "architecturally possible, requires talking to Heropost."

There is no cookie auth and no custom header.

## Errors

graphql-dotnet / HotChocolate style: **HTTP 200 with an `errors` array**, so status codes
tell you almost nothing. Classify on the payload. The authorization failure is exactly:

```json
{
  "errors": [
    {
      "message": "You are not authorized to run this query.\nThe current user must be authenticated.",
      "extensions": { "code": "authorization", "codes": ["authorization"], "number": "6.1.1" }
    }
  ]
}
```

`src/errors.ts` matches on `extensions.code === "authorization"` with a message-text
fallback, and `tests/client.test.ts` asserts against this exact payload.

## Data model

```
Profile
└── Workspace (id, name, timeZone, approvalPolicy)
    ├── Account          one connected social account: page / channel / profile / group / board
    └── CustomPost       the unit of composition
        ├── CustomPostItem   one per network; can override text and target specific accounts
        └── CustomPostMedia  shared media, ordered by index
```

- **Statuses:** `DRAFT`, `SCHEDULED`, `IN_PROGRESS`, `POSTED`, `PENDING_APPROVAL`.
- **Networks (`SocialEnum`):** `FACEBOOK`, `INSTAGRAM`, `X`, `LINKED_IN`, `PINTEREST`,
  `YOU_TUBE`, `TWITCH`, `GOOGLE_MY_BUSINESS`, `REDDIT`, `TUMBLR`, `TELEGRAM`, `TIK_TOK`,
  `THREADS`, `BLUESKY`.
- **Pagination:** `take` / `skip` / `sortField` / `sortDirection`, returning
  `{nodes, totalCount}`.
- **Filters:** typed per field — `StringFilterInput` (`eq`, `contains`, `startsWith`, `in`…),
  `DateFilterInput` (`ge`, `le`, `between`…), `IntFilterInput`, `BoolFilterInput`, and
  `EnumFilterInput<T>`.

### Two asymmetries that shape the tool design

- **`MainQuery.accounts` has no workspace argument** and `AccountFilterInput` has no
  workspace field. To scope accounts to a workspace you must go the other way:
  `workspace(id) { accounts { … } }`. `heropost_list_accounts` uses both documents.
- **There is no `customPost(id:)` field.** Fetching one post means filtering the list by
  `id: {eq: …}` — which is what the web app does.

## Composing a post

The web app's own sequence, not a single call:

1. `createCustomPost(customPost: CreateCustomPostInput!)` → the new post's id
2. `selectSocialNetworks(...)` and/or `selectAccountsForCustomPost(...)` to choose targets
3. media upload (below)
4. `updateCustomPost(...)` for text, first comment, and `scheduledDate`
5. `scheduleCustomPost(customPostId: Int!)` to queue it

`publishCustomPost(customPostId)` and `publishCustomPostItem(customPostItemId)` publish
immediately. **This project deliberately does not expose them.**

Other posting operations seen in the bundle: `setScheduledPostToDraft`,
`upsertCustomPostRepeatSettings`, `acceptPostingErrorInCustomPost`, `updateCustomPostItem`,
`scheduleCustomPostItem`, `unselectSocialNetworks`, `unselectAccountForCustomPost`, and an
`onCustomPostUpdated` subscription.

### The input shapes are the weak point

`CreateCustomPostInput`, `UpdateCustomPostInput`, `UploadMediaInput`, `UploadPostMediaInput`,
`GetPreSignedMediaUploadUrlInput`, `SelectAccountsForCustomPostInput`, and
`SetScheduledPostToDraftInput` **do not exist in the `main` schema** and cannot be
introspected without a token. What `src/operations/posting.ts` encodes was reconstructed from
minified call sites: the operation names, argument names, and argument *types* are right; the
input *fields* are informed guesses and certainly incomplete.

Two mitigations, both deliberate:

1. Posting mutations select only `{ id }`, and results are read back through the verified
   `GetPost` on `main`. A wrong guess about a response field cannot break a write that
   already succeeded.
2. Every authoring tool accepts `advancedInput`, merged into the GraphQL input, so a missing
   field can be supplied at call time without a code change.

**To fix it properly, with any valid token:**

```bash
npm run introspect -- posting --token "$HEROPOST_ACCESS_TOKEN"
npm test
```

That writes `schema/posting.graphql`, and the conformance test immediately starts validating
all ten authoring operations instead of skipping them.

## Media upload: presigned PUT, not GraphQL multipart

```
1. POST posting-api/graphql   query PreSignedMediaUploadUrl($media: {fileName, contentType})
                              -> { url }   (single-use, time-limited)
2. PUT  <that url>            Content-Type: <mime>, body = raw bytes, NO Authorization header
                              (the signature in the query string IS the credential)
3. POST posting-api/graphql   mutation UploadMedia($media: {workspaceId, url, mediaType, …})
                              -> { id }    url = origin + pathname, signature stripped
4. POST posting-api/graphql   mutation UploadPostMedia($customPost: {customPostId, mediaId, …})
```

Bucket seen in the bundle: `heropost-images.s3.eu-west-1.amazonaws.com`, though the presigned
host is server-chosen. Implemented in `src/media.ts`; `tests/media.test.ts` asserts the
no-auth-header and signature-stripping behavior, both of which are easy to get wrong.

There is a per-item variant, `preSignedUrlForPostItemMedia`, and import-by-URL alternatives
(`mediaFromUrl`, `fileInfo`).

**GraphQL multipart does exist** on `main` (it's wired with `apollo-upload-client` and has an
`Upload` scalar) but only for two mutations: `uploadProfileAvatar` and `uploadWorkspaceLogo`.
Post media does not use it.

## Odds and ends

- **Exactly one REST endpoint** exists in the whole app:
  `POST api.heropost.io/ai/generate-text`, a streaming AI text generator that returns HTTP
  402 when AI credits run out. Its request body schema is unverified. Not used here.
- **`publicCreateToken` / `publicCreateAccount` / `publicSocialAccounts` are not a partner
  API.** Their `accessToken: {token, workspaceId}` argument is a per-invite share token
  backing the unauthenticated route `/invite/workspace/:id/social-accounts` — the
  agency-onboards-a-client flow, where the client connects their own social accounts without
  a Heropost login. Presumably minted by `createWorkspaceAccessToken({email, workspaceId,
  fullName})`, which appears to email the link, though no call site confirms this.
- **Bulk creation:** `bulkUploadCsv({csvFileUrl, workspaceId, postingGroupId})` →
  `createDraftPostsFromBulkUpload({bulkUploadId})`, polled via `bulkUploadStatus`. The CSV is
  uploaded through the same presigned mechanism. This is the closest thing to a batch API.
- **`setPrivateApiCreds({accountId, nickname, password})`** stores raw credentials for
  third-party accounts on some networks. Not exposed by this project, and worth knowing about.
- **Automations are RSS-driven:** `createAutomation({workspaceId, type, url, frequency})`,
  then `updateAutomation` sets filtering, target accounts, and caption behavior.
- Other hosts: `admin.heropost.io`, `monolink.heropost.io` (a link-in-bio product with its
  own `monolink_api.full` scope), `hp.heropost.io` (a GTM proxy).

## Refreshing the schemas

```bash
npm run introspect                              # main + login; no token needed
npm run introspect -- posting --token "$TOKEN"  # auth-gated services
```

`schema/*.graphql` is generated with `buildClientSchema` + `printSchema` and sorted, so diffs
between refreshes are readable — which is how you spot an upstream change.
