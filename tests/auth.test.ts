import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileTokenProvider,
  RefreshTokenProvider,
  StaticTokenProvider,
  createTokenProvider,
} from "../src/auth/provider.js";
import { ConfigError, loadConfig } from "../src/config.js";
import { HeropostAuthError } from "../src/errors.js";

async function tokenFile(contents: string, name = "token"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "heropost-token-"));
  const path = join(dir, name);
  await writeFile(path, contents);
  await chmod(path, 0o600);
  return path;
}

describe("credential configuration", () => {
  it("accepts a token file as a credential", () => {
    const config = loadConfig({
      HEROPOST_ACCESS_TOKEN_FILE: "/tmp/whatever",
    } as NodeJS.ProcessEnv);
    expect(config.accessTokenFile).toBe("/tmp/whatever");
  });

  it("still refuses to start with no credential at all, naming the file option first", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/HEROPOST_ACCESS_TOKEN_FILE/);
  });

  it("resolves a relative token-file path to an absolute one", () => {
    const config = loadConfig({
      HEROPOST_ACCESS_TOKEN_FILE: "creds/token",
    } as NodeJS.ProcessEnv);
    expect(config.accessTokenFile?.startsWith("/")).toBe(true);
  });
});

describe("provider selection", () => {
  it("prefers a refresh token, which can renew indefinitely", async () => {
    const path = await tokenFile("refresh-abc");
    const provider = createTokenProvider(
      loadConfig({ HEROPOST_REFRESH_TOKEN_FILE: path } as NodeJS.ProcessEnv),
    );
    expect(provider).toBeInstanceOf(RefreshTokenProvider);
  });

  it("uses the token file over a pasted token, since it can pick up a replacement", async () => {
    const path = await tokenFile("file-token");
    const provider = createTokenProvider(
      loadConfig({
        HEROPOST_ACCESS_TOKEN: "env-token",
        HEROPOST_ACCESS_TOKEN_FILE: path,
      } as NodeJS.ProcessEnv),
    );
    expect(provider).toBeInstanceOf(FileTokenProvider);
    await expect(provider.getAccessToken()).resolves.toBe("file-token");
  });

  it("falls back to a pasted token", () => {
    const provider = createTokenProvider(
      loadConfig({ HEROPOST_ACCESS_TOKEN: "env-token" } as NodeJS.ProcessEnv),
    );
    expect(provider).toBeInstanceOf(StaticTokenProvider);
  });

  it("explains a missing refresh-token file rather than starting broken", () => {
    expect(() =>
      createTokenProvider(
        loadConfig({ HEROPOST_REFRESH_TOKEN_FILE: "/nope/missing" } as NodeJS.ProcessEnv),
      ),
    ).toThrow(/Cannot read the Heropost refresh-token file/);
  });

  it("never leaks the token in describe()", async () => {
    const path = await tokenFile("super-secret-value");
    const providers = [
      new FileTokenProvider(path),
      new StaticTokenProvider("super-secret-value"),
    ];
    for (const p of providers) {
      expect(p.describe()).not.toContain("super-secret-value");
    }
  });
});

describe("FileTokenProvider", () => {
  it("reads the token and tolerates a trailing newline", async () => {
    const provider = new FileTokenProvider(await tokenFile("abc123\n"));
    await expect(provider.getAccessToken()).resolves.toBe("abc123");
  });

  it("caches, then re-reads after invalidate — so a replaced token needs no restart", async () => {
    // This is the point of the file provider: paste a fresh token, keep working.
    const path = await tokenFile("old-token");
    const provider = new FileTokenProvider(path);

    await expect(provider.getAccessToken()).resolves.toBe("old-token");
    await writeFile(path, "new-token");
    // Still cached.
    await expect(provider.getAccessToken()).resolves.toBe("old-token");

    provider.invalidate();
    await expect(provider.getAccessToken()).resolves.toBe("new-token");
  });

  it("can renew, so an auth failure triggers a re-read", () => {
    expect(new FileTokenProvider("/tmp/x").canRenew).toBe(true);
    expect(new StaticTokenProvider("x").canRenew).toBe(false);
  });

  it("says how to create the file when it is missing", async () => {
    const provider = new FileTokenProvider("/nope/missing-token");
    await expect(provider.getAccessToken()).rejects.toThrow(HeropostAuthError);
    await expect(provider.getAccessToken()).rejects.toThrow(/not found/);
    await expect(provider.getAccessToken()).rejects.toThrow(/install -m 600/);
  });

  it("reports an empty file clearly", async () => {
    const provider = new FileTokenProvider(await tokenFile("   \n"));
    await expect(provider.getAccessToken()).rejects.toThrow(/is empty/);
  });

  it("catches the mistake of pasting the whole localStorage JSON", async () => {
    // Easy error to make, and the resulting auth failure would be baffling otherwise.
    const provider = new FileTokenProvider(
      await tokenFile('{"access_token": "abc", "refresh_token": "def"}'),
    );
    await expect(provider.getAccessToken()).rejects.toThrow(/contains whitespace/);
  });
});
