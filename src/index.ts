#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { deviceLogin } from "./auth/device.js";
import { createTokenProvider } from "./auth/provider.js";
import { ConfigError } from "./config.js";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${SERVER_NAME} ${SERVER_VERSION}\n`);
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }

  if (argv[0] === "login") {
    const result = await deviceLogin();
    process.stdout.write(
      "\nAdd this to your MCP client config (it renews itself):\n\n" +
        `  HEROPOST_REFRESH_TOKEN=${result.refreshToken ?? "(none returned — see README)"}\n\n`,
    );
    if (!result.refreshToken) {
      process.stderr.write(
        "The identity provider returned no refresh token, so this credential will expire. " +
          "Ensure the offline_access scope is granted.\n",
      );
    }
    return;
  }

  const { server, config, toolNames } = buildServer();

  // stdout is the MCP transport — every human-facing line must go to stderr.
  process.stderr.write(
    `${SERVER_NAME} ${SERVER_VERSION} ready — ${toolNames.length} tools` +
      `${config.readOnly ? " (read-only: write tools withheld)" : ""}, ` +
      `auth via ${createTokenProvider(config).describe()}\n`,
  );

  await server.connect(new StdioServerTransport());
}

const USAGE = `${SERVER_NAME} ${SERVER_VERSION} — unofficial MCP server for Heropost

Usage:
  heropost-mcp                 Run the MCP server over stdio (how MCP clients start it).
  heropost-mcp login           Device-code sign-in. Heropost does not currently permit this
                               grant, so expect unauthorized_client; use a token instead.
  heropost-mcp --version
  heropost-mcp --help

Authentication (set one):
  HEROPOST_ACCESS_TOKEN_FILE   Preferred — a chmod-600 file holding an access token, re-read
                               on demand so you can replace an expired one without a restart.
  HEROPOST_REFRESH_TOKEN_FILE  Same, for a refresh token (renews on its own).
  HEROPOST_REFRESH_TOKEN       Refresh token as an environment variable.
  HEROPOST_ACCESS_TOKEN        Access token as an environment variable; expires hourly.

Optional:
  HEROPOST_WORKSPACE_ID        Default workspace, so tools don't need it every call.
  HEROPOST_READ_ONLY=1         Withhold every write tool (nothing can be posted or edited).
  HEROPOST_MEDIA_ROOT          Confine media uploads to one directory tree.
  HEROPOST_TIMEOUT_MS          Per-request timeout; defaults to 30000.

Heropost publishes no API. This project talks to the same private GraphQL services its web
app uses, and is not affiliated with or endorsed by Heropost. See the README.
`;

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
  process.stderr.write(
    `${SERVER_NAME} failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
