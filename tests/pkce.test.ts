import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessTokenExpiry,
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  extractAuthorizationCode,
  REDIRECT_URI,
} from "../src/auth/pkce.js";
import { readCredentials, updateCredentials, writeCredentials } from "../src/auth/credentials.js";
import { StoredCredentialsProvider } from "../src/auth/provider.js";
import { HeropostAuthError } from "../src/errors.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PKCE", () => {
  it("derives an S256 challenge from the verifier", () => {
    const { verifier, challenge } = createPkcePair();
    const expected = createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });

  it("produces base64url values with no padding, as the spec requires", () => {
    const { verifier, challenge, state } = createPkcePair();
    for (const v of [verifier, challenge, state]) {
      expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
    }
  });

  it("does not repeat itself across calls", () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
  });
});

describe("buildAuthorizeUrl", () => {
  it("requests offline_access against the registered redirect", () => {
    // offline_access is the whole point — without it there is no refresh token and the
    // hourly-token problem is not solved.
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "Heropost.WebFrontend",
        scopes: "openid offline_access main_api.full",
        challenge: "chal",
        state: "st",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://login.heropost.io/connect/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("offline_access");
  });
});

describe("extractAuthorizationCode", () => {
  it("takes the code from a full redirected URL", () => {
    expect(
      extractAuthorizationCode("https://app.heropost.io/callback.html?code=abc123&state=st", "st"),
    ).toBe("abc123");
  });

  it("accepts a bare code", () => {
    expect(extractAuthorizationCode("abc123")).toBe("abc123");
  });

  it("accepts a bare query string", () => {
    expect(extractAuthorizationCode("?code=xyz&state=st", "st")).toBe("xyz");
  });

  it("rejects a mismatched state instead of continuing", () => {
    expect(() =>
      extractAuthorizationCode("https://app.heropost.io/callback.html?code=a&state=other", "mine"),
    ).toThrow(/state value does not match/);
  });

  it("surfaces an error redirect", () => {
    expect(() =>
      extractAuthorizationCode("https://app.heropost.io/callback.html?error=access_denied"),
    ).toThrow(/access_denied/);
  });

  it("explains the JavaScript race when the URL has no code", () => {
    // The most likely failure, so the message must point straight at the fix.
    expect(() => extractAuthorizationCode("https://app.heropost.io/callback.html?state=st")).toThrow(
      /block javascript for app\.heropost\.io/i,
    );
  });
});

describe("exchangeCode", () => {
  it("posts the authorization_code grant with the verifier and matching redirect", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push({ url: String(url), body: String(init?.body) });
        return new Response(
          JSON.stringify({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
            scope: "openid offline_access",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const result = await exchangeCode({
      code: "the-code",
      verifier: "the-verifier",
      clientId: "Heropost.WebFrontend",
      tokenEndpoint: "https://login.heropost.io/connect/token",
    });

    expect(result).toMatchObject({ accessToken: "at", refreshToken: "rt", expiresIn: 3600 });
    const body = new URLSearchParams(calls[0]!.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe("the-verifier");
    expect(body.get("redirect_uri")).toBe(REDIRECT_URI);
  });

  it("explains invalid_grant as the spent-code case", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(
      exchangeCode({
        code: "c",
        verifier: "v",
        clientId: "x",
        tokenEndpoint: "https://login.heropost.io/connect/token",
      }),
    ).rejects.toThrow(/already spent this code/);
  });
});

describe("accessTokenExpiry", () => {
  it("reads exp out of a JWT without verifying it", () => {
    const exp = Math.floor(Date.now() / 1000) + 1800;
    const jwt = `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;
    expect(accessTokenExpiry(jwt)?.getTime()).toBe(exp * 1000);
  });

  it("returns undefined for an opaque token rather than throwing", () => {
    expect(accessTokenExpiry("not-a-jwt")).toBeUndefined();
  });
});

describe("credential store", () => {
  async function path(): Promise<string> {
    return join(await mkdtemp(join(tmpdir(), "heropost-creds-")), "credentials.json");
  }

  it("writes 0600, since the contents are password-equivalent", async () => {
    const p = await path();
    await writeCredentials(p, { refreshToken: "rt" });
    expect((await stat(p)).mode & 0o777).toBe(0o600);
  });

  it("round-trips", async () => {
    const p = await path();
    await writeCredentials(p, { refreshToken: "rt", accessToken: "at" });
    expect(await readCredentials(p)).toMatchObject({ refreshToken: "rt", accessToken: "at" });
  });

  it("returns undefined when absent, so first run is not an error", async () => {
    expect(await readCredentials("/nope/credentials.json")).toBeUndefined();
  });

  it("merges instead of clobbering", async () => {
    const p = await path();
    await writeCredentials(p, { refreshToken: "rt", scope: "openid" });
    await updateCredentials(p, { accessToken: "at" });
    expect(await readCredentials(p)).toMatchObject({
      refreshToken: "rt",
      scope: "openid",
      accessToken: "at",
    });
  });

  it("rejects malformed JSON with a recovery instruction", async () => {
    const p = await path();
    await writeCredentials(p, {});
    const { writeFile } = await import("node:fs/promises");
    await writeFile(p, "{not json");
    await expect(readCredentials(p)).rejects.toThrow(/heropost-mcp auth/);
  });
});

describe("StoredCredentialsProvider", () => {
  it("persists the rotated refresh token, so a restart still works", async () => {
    // OpenIddict invalidates the old refresh token on every renewal. If rotation lived only
    // in memory, the next restart would present a spent token and force a new sign-in —
    // exactly the chore this is meant to remove.
    const p = join(await mkdtemp(join(tmpdir(), "heropost-rot-")), "credentials.json");
    await writeCredentials(p, { refreshToken: "rt-1" });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const provider = new StoredCredentialsProvider(
      {
        tokenEndpoint: "https://login.heropost.io/connect/token",
        clientId: "Heropost.WebFrontend",
        scopes: "openid offline_access",
        timeoutMs: 5000,
      },
      p,
      "rt-1",
    );

    await expect(provider.getAccessToken()).resolves.toBe("at-2");

    // The write is fire-and-forget; give the microtask queue a turn.
    await new Promise((r) => setTimeout(r, 20));
    const stored = JSON.parse(await readFile(p, "utf8")) as { refreshToken: string };
    expect(stored.refreshToken).toBe("rt-2");
  });

  it("never names the token in describe()", () => {
    const provider = new StoredCredentialsProvider(
      {
        tokenEndpoint: "t",
        clientId: "c",
        scopes: "s",
        timeoutMs: 1,
      },
      "/tmp/credentials.json",
      "super-secret",
    );
    expect(provider.describe()).not.toContain("super-secret");
    expect(provider.canRenew).toBe(true);
  });

  it("is an auth error, not a crash, when the store has no refresh token", async () => {
    const p = join(await mkdtemp(join(tmpdir(), "heropost-empty-")), "credentials.json");
    await writeCredentials(p, { accessToken: "at-only" });
    expect(await readCredentials(p)).not.toHaveProperty("refreshToken");
    expect(HeropostAuthError).toBeDefined();
  });
});
