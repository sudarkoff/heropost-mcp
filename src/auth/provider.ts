import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Config } from "../config.js";
import { HeropostAuthError } from "../errors.js";

/**
 * The rest of the server asks for a bearer token and never learns where it came from.
 * That matters here because Heropost has no API keys: how you get a token is the least
 * settled part of this integration, so it needs to be swappable.
 */
export interface TokenProvider {
  getAccessToken(): Promise<string>;
  /** Called after a 401-equivalent so the next call re-fetches instead of reusing a dead token. */
  invalidate(): void;
  /**
   * Whether a fresh token can be obtained. False for a pasted token, where retrying an
   * auth failure would only repeat it — so the client doesn't waste the request.
   */
  readonly canRenew: boolean;
  /** Human-readable, for startup logging. Must never include the token itself. */
  describe(): string;
}

/** A token pasted from a signed-in browser session. Works today; expires within the hour. */
export class StaticTokenProvider implements TokenProvider {
  readonly canRenew = false;

  constructor(private readonly token: string) {}

  async getAccessToken(): Promise<string> {
    return this.token;
  }

  invalidate(): void {
    // Nothing to do — there is no way to renew a pasted token.
  }

  describe(): string {
    return "static access token (HEROPOST_ACCESS_TOKEN; will expire and cannot self-renew)";
  }
}

/**
 * Reads the access token from a file each time it's needed.
 *
 * Preferred over an env var: the secret stays out of process listings and out of MCP client
 * config files. It also fixes the main annoyance of a pasted token — because the file is
 * re-read on demand, replacing an expired token takes effect on the next call instead of
 * requiring a server restart. `canRenew` is true for exactly that reason: an auth failure
 * makes the client drop its cache and look at the file again.
 */
export class FileTokenProvider implements TokenProvider {
  readonly canRenew = true;
  private cached?: string;

  constructor(private readonly path: string) {}

  async getAccessToken(): Promise<string> {
    if (this.cached) return this.cached;

    let contents: string;
    try {
      contents = await readFile(this.path, "utf8");
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code === "ENOENT" ? "not found" : String(err);
      throw new HeropostAuthError(
        `Cannot read the Heropost token file at ${this.path} (${reason}). Create it with your ` +
          `access token as its only contents, readable only by you:\n` +
          `  install -m 600 /dev/null ${this.path} && pbpaste > ${this.path}`,
      );
    }

    // Tolerate a trailing newline and stray whitespace from an editor or a shell redirect.
    // Also strip a leading "Bearer ", since the documented way to obtain a token is to copy
    // an Authorization header off a live request and the prefix comes along easily.
    const token = contents.trim().replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      throw new HeropostAuthError(
        `The Heropost token file at ${this.path} is empty. Paste an access token into it — ` +
          `see the Authentication section of the README for where to find one.`,
      );
    }
    if (/\s/.test(token)) {
      throw new HeropostAuthError(
        `The Heropost token file at ${this.path} contains whitespace, so it does not look ` +
          `like a bare token. It should hold only the token itself — not a whole ` +
          `Authorization header, JSON object, or curl command. Copy just the value after ` +
          `"Bearer " from a graphql request in the Network tab.`,
      );
    }

    this.cached = token;
    return token;
  }

  invalidate(): void {
    // Drop the cache so the next call picks up a token that was just replaced on disk.
    this.cached = undefined;
  }

  describe(): string {
    return `access token file ${this.path} (re-read on demand; replace it in place when it expires)`;
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Renew tokens this many ms before they actually expire, to avoid racing the clock. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Exchanges a refresh token for access tokens against the OIDC token endpoint, caching
 * until just before expiry. This is the path that makes the server usable day to day.
 */
export class RefreshTokenProvider implements TokenProvider {
  readonly canRenew = true;
  private accessToken?: string;
  private expiresAt = 0;
  private refreshToken: string;
  /** De-duplicates concurrent refreshes so parallel tool calls make one token request. */
  private inFlight?: Promise<string>;

  constructor(
    private readonly config: Pick<
      Config,
      "tokenEndpoint" | "clientId" | "clientSecret" | "scopes" | "timeoutMs"
    >,
    refreshToken: string,
    seedAccessToken?: string,
  ) {
    this.refreshToken = refreshToken;
    if (seedAccessToken) {
      this.accessToken = seedAccessToken;
      // We can't know a pasted token's expiry, so treat it as good for one short window
      // and let the first auth failure force a refresh.
      this.expiresAt = Date.now() + 5 * 60_000;
    }
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - EXPIRY_SKEW_MS) {
      return this.accessToken;
    }
    this.inFlight ??= this.refresh().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  invalidate(): void {
    this.accessToken = undefined;
    this.expiresAt = 0;
  }

  describe(): string {
    return "refresh token (HEROPOST_REFRESH_TOKEN; access tokens renew automatically)";
  }

  private async refresh(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.config.clientId,
      scope: this.config.scopes,
    });
    if (this.config.clientSecret) body.set("client_secret", this.config.clientSecret);

    let res: Response;
    try {
      res = await fetch(this.config.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      throw new HeropostAuthError(
        `Could not reach the Heropost token endpoint (${this.config.tokenEndpoint}): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const payload = (await res.json().catch(() => ({}))) as TokenResponse;

    if (!res.ok || !payload.access_token) {
      const reason = payload.error_description ?? payload.error ?? `HTTP ${res.status}`;
      throw new HeropostAuthError(
        `Refreshing the Heropost access token failed: ${reason}. Refresh tokens are ` +
          `single-use and rotate on every renewal, so a stored one goes stale if another ` +
          `client used it — sign in again to get a fresh HEROPOST_REFRESH_TOKEN.`,
      );
    }

    // OpenIddict rotates refresh tokens: the response carries the one to use next time.
    if (payload.refresh_token) this.refreshToken = payload.refresh_token;

    this.accessToken = payload.access_token;
    this.expiresAt = Date.now() + (payload.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  /**
   * The current refresh token, which may differ from the one supplied at construction
   * because the IdP rotates them. Persist this to avoid re-authenticating.
   */
  currentRefreshToken(): string {
    return this.refreshToken;
  }
}

/**
 * Picks a provider, most capable first: a refresh token can renew indefinitely, a token file
 * can at least pick up a replacement, and a pasted token can do neither.
 */
export function createTokenProvider(config: Config): TokenProvider {
  const refreshToken = config.refreshToken ?? readFileSyncTrimmed(config.refreshTokenFile);
  if (refreshToken) {
    return new RefreshTokenProvider(config, refreshToken, config.accessToken);
  }
  if (config.accessTokenFile) return new FileTokenProvider(config.accessTokenFile);
  if (config.accessToken) return new StaticTokenProvider(config.accessToken);
  // loadConfig already guarantees a credential, so reaching here is a programming error.
  throw new HeropostAuthError("No Heropost credential configured.");
}

/**
 * Refresh tokens are read once at startup, since the provider rotates them in memory from
 * then on. Read synchronously so provider selection stays a plain function.
 */
function readFileSyncTrimmed(path?: string): string | undefined {
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf8").trim() || undefined;
  } catch {
    throw new HeropostAuthError(
      `Cannot read the Heropost refresh-token file at ${path}. Create it containing only the ` +
        `refresh token, readable only by you.`,
    );
  }
}
