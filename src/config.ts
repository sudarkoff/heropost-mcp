import { resolve } from "node:path";
import { z } from "zod";
import { DEFAULT_CREDENTIALS_PATH, readCredentialsSync } from "./auth/credentials.js";

/**
 * Heropost is four separate GraphQL services. The frontend picks between them per
 * operation (via Apollo `clientName`), and so do we — reads of a post live on `main`
 * while writes live on `posting`. See docs/api-notes.md.
 */
export const SERVICE_NAMES = ["main", "posting", "login", "notification"] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export const DEFAULT_ENDPOINTS: Record<ServiceName, string> = {
  main: "https://api.heropost.io/graphql",
  posting: "https://posting-api.heropost.io/graphql",
  login: "https://login-api.heropost.io/graphql",
  notification: "https://notification-api.heropost.io/graphql",
};

export const DEFAULT_TOKEN_ENDPOINT = "https://login.heropost.io/connect/token";
export const DEFAULT_DEVICE_ENDPOINT = "https://login.heropost.io/connect/deviceauthorization";

/** The public SPA client the Heropost web app itself uses. */
export const DEFAULT_CLIENT_ID = "Heropost.WebFrontend";

/** Scopes the web app requests. `offline_access` is what yields a refresh token. */
export const DEFAULT_SCOPES =
  "openid profile email offline_access posting_api.full main_api.full notification_api.full";

/** Accepts the usual truthy spellings so `HEROPOST_READ_ONLY=true` and `=1` both work. */
const boolish = z
  .string()
  .transform((v) => ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()));

const envSchema = z.object({
  HEROPOST_ACCESS_TOKEN: z.string().min(1).optional(),
  HEROPOST_REFRESH_TOKEN: z.string().min(1).optional(),
  /**
   * Read the credential from a file instead of an environment variable. Preferred: env vars
   * are visible in process listings and tend to get committed inside MCP client configs.
   * The access-token file is re-read on demand, so replacing an expired token takes effect
   * without restarting the server.
   */
  HEROPOST_ACCESS_TOKEN_FILE: z.string().min(1).optional(),
  HEROPOST_REFRESH_TOKEN_FILE: z.string().min(1).optional(),
  /**
   * JSON credential store written by `heropost-mcp auth`. Preferred over everything else:
   * rotated refresh tokens are persisted here, so sign-in is a one-time event.
   */
  HEROPOST_CREDENTIALS_FILE: z.string().min(1).optional(),
  HEROPOST_CLIENT_ID: z.string().min(1).optional(),
  HEROPOST_CLIENT_SECRET: z.string().min(1).optional(),
  HEROPOST_TOKEN_ENDPOINT: z.string().url().optional(),
  HEROPOST_DEVICE_ENDPOINT: z.string().url().optional(),
  HEROPOST_SCOPES: z.string().min(1).optional(),
  HEROPOST_MAIN_URL: z.string().url().optional(),
  HEROPOST_POSTING_URL: z.string().url().optional(),
  HEROPOST_LOGIN_URL: z.string().url().optional(),
  HEROPOST_NOTIFICATION_URL: z.string().url().optional(),
  /** Used as the default `workspaceId` so callers don't have to pass it every time. */
  HEROPOST_WORKSPACE_ID: z.coerce.number().int().positive().optional(),
  HEROPOST_READ_ONLY: boolish.optional(),
  HEROPOST_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  /** Confines media uploads to one directory tree. See `mediaRoot` below. */
  HEROPOST_MEDIA_ROOT: z.string().min(1).optional(),
});

export interface Config {
  accessToken?: string;
  refreshToken?: string;
  /** Absolute path to a file containing only the access token. Re-read on demand. */
  accessTokenFile?: string;
  refreshTokenFile?: string;
  /** Absolute path to the JSON credential store; rotated tokens are written back to it. */
  credentialsFile?: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  deviceEndpoint: string;
  scopes: string;
  endpoints: Record<ServiceName, string>;
  defaultWorkspaceId?: number;
  readOnly: boolean;
  timeoutMs: number;
  /**
   * If set, media uploads are restricted to files under this directory. Worth setting:
   * uploaded bytes go to a third party and can end up on a public timeline, so an
   * unrestricted file path is an exfiltration route for anything image-shaped on disk.
   */
  mediaRoot?: string;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/**
 * MCP client configs routinely pass empty strings for unset variables (`"HEROPOST_X": ""`).
 * Treat blank as absent so a default applies, instead of failing validation.
 */
function withoutBlanks(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([, v]) => typeof v !== "string" || v.trim() !== ""),
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parseConfig(env, { requireCredential: true });
}

/**
 * Same configuration, minus the credential requirement — `heropost-mcp auth` runs precisely
 * when there is no credential yet, and still needs the client id, scopes, and endpoints.
 */
export function loadConfigForAuth(env: NodeJS.ProcessEnv = process.env): Config {
  return parseConfig(env, { requireCredential: false });
}

function parseConfig(
  env: NodeJS.ProcessEnv,
  options: { requireCredential: boolean },
): Config {
  const parsed = envSchema.safeParse(withoutBlanks(env));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ConfigError(`Invalid Heropost configuration — ${detail}`);
  }
  const e = parsed.data;

  // The credential store is consulted by default, so a plain `heropost-mcp auth` is enough to
  // configure the server — no env vars to add afterwards.
  const credentialsFile = resolve(e.HEROPOST_CREDENTIALS_FILE ?? DEFAULT_CREDENTIALS_PATH);
  const storedRefreshToken = readCredentialsSync(credentialsFile)?.refreshToken;

  const hasCredential =
    storedRefreshToken ??
    e.HEROPOST_ACCESS_TOKEN ??
    e.HEROPOST_REFRESH_TOKEN ??
    e.HEROPOST_ACCESS_TOKEN_FILE ??
    e.HEROPOST_REFRESH_TOKEN_FILE;

  if (options.requireCredential && !hasCredential) {
    throw new ConfigError(
      "No Heropost credential found. Run `heropost-mcp auth` once — it signs you in and " +
        `stores a self-renewing refresh token at ${credentialsFile}, after which this server ` +
        "needs no further attention. Alternatively set HEROPOST_ACCESS_TOKEN_FILE, " +
        "HEROPOST_ACCESS_TOKEN, HEROPOST_REFRESH_TOKEN_FILE, or HEROPOST_REFRESH_TOKEN. " +
        "See the Authentication section of the README.",
    );
  }

  return {
    ...(e.HEROPOST_ACCESS_TOKEN ? { accessToken: e.HEROPOST_ACCESS_TOKEN } : {}),
    ...(e.HEROPOST_REFRESH_TOKEN ? { refreshToken: e.HEROPOST_REFRESH_TOKEN } : {}),
    ...(e.HEROPOST_ACCESS_TOKEN_FILE
      ? { accessTokenFile: resolve(e.HEROPOST_ACCESS_TOKEN_FILE) }
      : {}),
    ...(e.HEROPOST_REFRESH_TOKEN_FILE
      ? { refreshTokenFile: resolve(e.HEROPOST_REFRESH_TOKEN_FILE) }
      : {}),
    credentialsFile,
    clientId: e.HEROPOST_CLIENT_ID ?? DEFAULT_CLIENT_ID,
    ...(e.HEROPOST_CLIENT_SECRET ? { clientSecret: e.HEROPOST_CLIENT_SECRET } : {}),
    tokenEndpoint: e.HEROPOST_TOKEN_ENDPOINT ?? DEFAULT_TOKEN_ENDPOINT,
    deviceEndpoint: e.HEROPOST_DEVICE_ENDPOINT ?? DEFAULT_DEVICE_ENDPOINT,
    scopes: e.HEROPOST_SCOPES ?? DEFAULT_SCOPES,
    endpoints: {
      main: e.HEROPOST_MAIN_URL ?? DEFAULT_ENDPOINTS.main,
      posting: e.HEROPOST_POSTING_URL ?? DEFAULT_ENDPOINTS.posting,
      login: e.HEROPOST_LOGIN_URL ?? DEFAULT_ENDPOINTS.login,
      notification: e.HEROPOST_NOTIFICATION_URL ?? DEFAULT_ENDPOINTS.notification,
    },
    ...(e.HEROPOST_WORKSPACE_ID ? { defaultWorkspaceId: e.HEROPOST_WORKSPACE_ID } : {}),
    readOnly: e.HEROPOST_READ_ONLY ?? false,
    timeoutMs: e.HEROPOST_TIMEOUT_MS ?? 30_000,
    ...(e.HEROPOST_MEDIA_ROOT ? { mediaRoot: resolve(e.HEROPOST_MEDIA_ROOT) } : {}),
  };
}
