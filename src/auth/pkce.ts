import { createHash, randomBytes } from "node:crypto";
import { HeropostAuthError } from "../errors.js";

/**
 * One-time authorization-code + PKCE sign-in, which is the only way to get a *persistable*
 * credential out of Heropost.
 *
 * Why this exists: Heropost keeps its tokens in an in-memory store, so there is nothing to
 * copy from the browser except a ~1h access token — and the device-code grant is disabled for
 * their client. But the web app requests `offline_access`, so the authorization-code flow does
 * issue refresh tokens. Running that flow ourselves gets us one we can keep, after which the
 * server renews access tokens on its own and the hourly copy-paste goes away.
 *
 * The catch, and the reason this is a two-step command: the only registered redirect URIs
 * belong to Heropost's own app, so the browser lands on `app.heropost.io/callback.html?code=…`
 * — whose JavaScript will exchange (and thereby burn) the code within a few hundred
 * milliseconds. Blocking JavaScript for that one host leaves the code sitting in the URL bar
 * for us. See the README.
 */

/** Registered on Heropost's OIDC client; a loopback URI cannot be used. */
export const REDIRECT_URI = "https://app.heropost.io/callback.html";
export const AUTHORIZE_ENDPOINT = "https://login.heropost.io/connect/authorize";

export interface PkcePair {
  verifier: string;
  challenge: string;
  state: string;
}

/** RFC 7636 S256. base64url, no padding. */
export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, state: base64Url(randomBytes(16)) };
}

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildAuthorizeUrl(args: {
  clientId: string;
  scopes: string;
  challenge: string;
  state: string;
  redirectUri?: string;
}): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri ?? REDIRECT_URI,
    response_type: "code",
    scope: args.scopes,
    code_challenge: args.challenge,
    code_challenge_method: "S256",
    state: args.state,
  }).toString();
  return url.toString();
}

/**
 * Pull the `code` out of whatever the user pastes back — the whole redirected URL, a bare
 * query string, or just the code. Verifies `state` when a URL was pasted, which is the only
 * place we can check it.
 */
export function extractAuthorizationCode(pasted: string, expectedState?: string): string {
  const trimmed = pasted.trim();
  if (!trimmed) throw new HeropostAuthError("Nothing pasted.");

  let params: URLSearchParams | undefined;
  if (trimmed.includes("?") || trimmed.includes("&") || trimmed.includes("=")) {
    const queryPart = trimmed.slice(trimmed.indexOf("?") + 1);
    params = new URLSearchParams(queryPart.replace(/^#/, ""));
  }

  if (params) {
    const error = params.get("error");
    if (error) {
      throw new HeropostAuthError(
        `Heropost returned an authorization error: ${error}` +
          `${params.get("error_description") ? ` — ${params.get("error_description")}` : ""}`,
      );
    }
    const code = params.get("code");
    if (code) {
      const state = params.get("state");
      if (expectedState && state && state !== expectedState) {
        throw new HeropostAuthError(
          "The state value does not match the one this command generated. Start over rather " +
            "than continuing — the redirect may not belong to this sign-in attempt.",
        );
      }
      return code;
    }
    throw new HeropostAuthError(
      "That URL has no `code` parameter. If the page finished loading, its JavaScript already " +
        "consumed the code — block JavaScript for app.heropost.io and try again.",
    );
  }

  // A bare code, pasted on its own.
  return trimmed;
}

export interface ExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
}

/** Exchange the authorization code for tokens. `redirect_uri` must match exactly. */
export async function exchangeCode(args: {
  code: string;
  verifier: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  redirectUri?: string;
  timeoutMs?: number;
}): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri ?? REDIRECT_URI,
    client_id: args.clientId,
    code_verifier: args.verifier,
  });
  if (args.clientSecret) body.set("client_secret", args.clientSecret);

  let res: Response;
  try {
    res = await fetch(args.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
    });
  } catch (err) {
    throw new HeropostAuthError(
      `Could not reach ${args.tokenEndpoint}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok || typeof payload.access_token !== "string") {
    const error = String(payload.error ?? `HTTP ${res.status}`);
    const description = payload.error_description ? ` — ${String(payload.error_description)}` : "";
    throw new HeropostAuthError(
      `Exchanging the authorization code failed: ${error}${description}. ` +
        (error === "invalid_grant"
          ? "Authorization codes are single-use and expire within a minute or two. The most " +
            "likely cause is that app.heropost.io's JavaScript already spent this code — " +
            "block JavaScript for that host and run the sign-in again."
          : ""),
    );
  }

  return {
    accessToken: payload.access_token,
    ...(typeof payload.refresh_token === "string" ? { refreshToken: payload.refresh_token } : {}),
    ...(typeof payload.expires_in === "number" ? { expiresIn: payload.expires_in } : {}),
    ...(typeof payload.scope === "string" ? { scope: payload.scope } : {}),
  };
}

/**
 * Decode a JWT's expiry without verifying it. Used only to report how long a token lasts —
 * we never make trust decisions on this, the API is the authority.
 */
export function accessTokenExpiry(token: string): Date | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof json.exp === "number" ? new Date(json.exp * 1000) : undefined;
  } catch {
    return undefined;
  }
}
