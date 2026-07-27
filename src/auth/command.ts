import { createInterface } from "node:readline/promises";
import { loadConfigForAuth, type Config } from "../config.js";
import { DEFAULT_CREDENTIALS_PATH, updateCredentials } from "./credentials.js";
import {
  accessTokenExpiry,
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  extractAuthorizationCode,
  REDIRECT_URI,
} from "./pkce.js";

/**
 * `heropost-mcp auth` — the one-time sign-in that ends the hourly token chore.
 *
 * Everything human-facing goes to stderr so the command stays usable in a pipeline; only the
 * final summary is on stdout.
 */
export async function runAuthCommand(argv: string[]): Promise<void> {
  const config: Config = loadConfigForAuth(process.env);
  const credentialsPath =
    valueOf(argv, "--credentials") ?? config.credentialsFile ?? DEFAULT_CREDENTIALS_PATH;

  const { verifier, challenge, state } = createPkcePair();
  const url = buildAuthorizeUrl({
    clientId: config.clientId,
    scopes: config.scopes,
    challenge,
    state,
  });

  const out = (line = "") => process.stderr.write(`${line}\n`);

  out();
  out("Heropost sign-in — one time only. Afterwards tokens renew by themselves.");
  out();
  out("Heropost's only registered redirect goes to their own app, whose JavaScript will spend");
  out("the authorization code within a fraction of a second. So before you continue:");
  out();
  out("  1. In Chrome, open Settings -> Privacy and security -> Site settings -> JavaScript");
  out("  2. Under \"Not allowed to use JavaScript\", add:  app.heropost.io");
  out("     (Undo this at the end — it only needs to hold for the next 30 seconds.)");
  out();
  out("  3. Then open this URL while signed in to Heropost:");
  out();
  out(`     ${url}`);
  out();
  out(`  4. You will land on a blank ${REDIRECT_URI} page. Copy the FULL URL from the`);
  out("     address bar — it contains ?code=… — and paste it below.");
  out();

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  let pasted: string;
  try {
    pasted = await rl.question("Paste the redirected URL (or just the code): ");
  } finally {
    rl.close();
  }

  const code = extractAuthorizationCode(pasted, state);
  out();
  out("Exchanging the code…");

  const tokens = await exchangeCode({
    code,
    verifier,
    clientId: config.clientId,
    ...(config.clientSecret ? { clientSecret: config.clientSecret } : {}),
    tokenEndpoint: config.tokenEndpoint,
    timeoutMs: config.timeoutMs,
  });

  const expiry = accessTokenExpiry(tokens.accessToken);
  const expiresAt = tokens.expiresIn
    ? Date.now() + tokens.expiresIn * 1000
    : expiry?.getTime();

  await updateCredentials(credentialsPath, {
    ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
    accessToken: tokens.accessToken,
    ...(expiresAt ? { expiresAt } : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {}),
    obtainedAt: Date.now(),
  });

  out();
  if (tokens.refreshToken) {
    out(`Done. Credentials stored at ${credentialsPath} (0600).`);
    out("The server picks this up automatically — no environment variables needed.");
    out("Rotated refresh tokens are written back here, so this should not need repeating.");
  } else {
    // Worth being blunt about: without a refresh token this solves nothing.
    out(`Stored an access token at ${credentialsPath}, but Heropost returned NO refresh token.`);
    out("That means the offline_access scope was not granted, and the credential will still");
    out(`expire${expiry ? ` (at ${expiry.toISOString()})` : ""}. Re-run with a scope override:`);
    out('  HEROPOST_SCOPES="openid profile email offline_access main_api.full posting_api.full" heropost-mcp auth');
  }
  out();

  const lifetime =
    tokens.expiresIn ??
    (expiry ? Math.round((expiry.getTime() - Date.now()) / 1000) : undefined);
  if (lifetime) {
    out(`Access-token lifetime: ${Math.round(lifetime / 60)} minutes.`);
  }
  if (tokens.scope) out(`Granted scopes: ${tokens.scope}`);

  process.stdout.write(
    `${JSON.stringify(
      {
        credentialsFile: credentialsPath,
        refreshToken: tokens.refreshToken ? "stored" : null,
        accessTokenExpiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        scope: tokens.scope ?? null,
      },
      null,
      2,
    )}\n`,
  );
}

function valueOf(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}
