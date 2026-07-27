import { HeropostAuthError } from "../errors.js";
import {
  DEFAULT_CLIENT_ID,
  DEFAULT_DEVICE_ENDPOINT,
  DEFAULT_SCOPES,
  DEFAULT_TOKEN_ENDPOINT,
} from "../config.js";

/**
 * Device-code login: the only OIDC flow that works for a CLI without a registered
 * loopback redirect URI. Heropost's identity provider advertises the grant and
 * `offline_access`, which together give us a self-renewing credential with no password
 * stored anywhere.
 *
 * Whether Heropost's public web client is *permitted* to use this grant is unverified —
 * OpenIddict allows grants per client. If it isn't, the IdP answers `unauthorized_client`
 * and we say so plainly rather than failing obscurely.
 */

export interface DeviceLoginOptions {
  clientId?: string;
  clientSecret?: string;
  deviceEndpoint?: string;
  tokenEndpoint?: string;
  scopes?: string;
  /** Where progress is reported. stderr by default — stdout is the MCP transport. */
  log?: (message: string) => void;
  /** Overall deadline; the IdP's own expiry still applies. */
  timeoutMs?: number;
}

export interface DeviceLoginResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
}

interface DeviceAuthResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  interval?: number;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export async function deviceLogin(
  options: DeviceLoginOptions = {},
): Promise<DeviceLoginResult> {
  const clientId = options.clientId ?? DEFAULT_CLIENT_ID;
  const deviceEndpoint = options.deviceEndpoint ?? DEFAULT_DEVICE_ENDPOINT;
  const tokenEndpoint = options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;
  const scopes = options.scopes ?? DEFAULT_SCOPES;
  const log = options.log ?? ((m: string) => process.stderr.write(`${m}\n`));
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);

  const startBody = new URLSearchParams({ client_id: clientId, scope: scopes });
  if (options.clientSecret) startBody.set("client_secret", options.clientSecret);

  const start = (await postForm(deviceEndpoint, startBody)) as DeviceAuthResponse;

  if (start.error || !start.device_code || !start.user_code) {
    const reason = start.error_description ?? start.error ?? "no device code returned";
    throw new HeropostAuthError(
      `Heropost's identity provider refused to start a device login: ${reason}. ` +
        (start.error === "unauthorized_client"
          ? `The "${clientId}" client is not allowed to use the device-code grant, so this ` +
            `login method is unavailable. Use HEROPOST_ACCESS_TOKEN (copied from a signed-in ` +
            `browser session) or HEROPOST_REFRESH_TOKEN instead — see the README.`
          : ""),
    );
  }

  const verifyUrl = start.verification_uri_complete ?? start.verification_uri;
  log("");
  log("To authorize heropost-mcp, open this URL and enter the code:");
  log(`  URL:  ${verifyUrl ?? "(none returned)"}`);
  log(`  Code: ${start.user_code}`);
  log("");
  log("Waiting for you to approve…");

  let intervalMs = (start.interval ?? 5) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);

    const body = new URLSearchParams({
      grant_type: DEVICE_CODE_GRANT,
      device_code: start.device_code,
      client_id: clientId,
    });
    if (options.clientSecret) body.set("client_secret", options.clientSecret);

    const res = (await postForm(tokenEndpoint, body)) as TokenResponse;

    if (res.access_token) {
      log("Authorized.");
      return {
        accessToken: res.access_token,
        ...(res.refresh_token ? { refreshToken: res.refresh_token } : {}),
        ...(res.expires_in ? { expiresIn: res.expires_in } : {}),
        ...(res.scope ? { scope: res.scope } : {}),
      };
    }

    switch (res.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        // RFC 8628: back off by 5s and keep going.
        intervalMs += 5000;
        continue;
      case "expired_token":
        throw new HeropostAuthError(
          "The device login expired before it was approved. Run the login again.",
        );
      case "access_denied":
        throw new HeropostAuthError("The device login was denied.");
      default:
        throw new HeropostAuthError(
          `Device login failed: ${res.error_description ?? res.error ?? "unknown error"}`,
        );
    }
  }

  throw new HeropostAuthError("Timed out waiting for the device login to be approved.");
}

async function postForm(url: string, body: URLSearchParams): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new HeropostAuthError(
      `Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // OAuth error responses are 4xx with a JSON body we still need to read.
  return (await res.json().catch(() => ({}))) as unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
