import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_ENDPOINTS, loadConfig } from "../src/config.js";
import { NO_CREDENTIALS_FILE } from "./helpers.js";

describe("loadConfig", () => {
  it("requires a credential and says which env vars to set", () => {
    expect(() => loadConfig({ HEROPOST_CREDENTIALS_FILE: NO_CREDENTIALS_FILE } as NodeJS.ProcessEnv)).toThrow(ConfigError);
    expect(() => loadConfig({ HEROPOST_CREDENTIALS_FILE: NO_CREDENTIALS_FILE } as NodeJS.ProcessEnv)).toThrow(/HEROPOST_ACCESS_TOKEN/);
    expect(() => loadConfig({ HEROPOST_CREDENTIALS_FILE: NO_CREDENTIALS_FILE } as NodeJS.ProcessEnv)).toThrow(/HEROPOST_REFRESH_TOKEN/);
  });

  it("accepts either credential on its own", () => {
    expect(
      loadConfig({ HEROPOST_ACCESS_TOKEN: "a", HEROPOST_CREDENTIALS_FILE: NO_CREDENTIALS_FILE } as NodeJS.ProcessEnv).accessToken,
    ).toBe("a");
    expect(
      loadConfig({ HEROPOST_REFRESH_TOKEN: "r", HEROPOST_CREDENTIALS_FILE: NO_CREDENTIALS_FILE } as NodeJS.ProcessEnv).refreshToken,
    ).toBe("r");
  });

  it("defaults to the four production endpoints", () => {
    const config = loadConfig({ HEROPOST_ACCESS_TOKEN: "a", HEROPOST_CREDENTIALS_FILE: NO_CREDENTIALS_FILE } as NodeJS.ProcessEnv);
    expect(config.endpoints).toEqual(DEFAULT_ENDPOINTS);
    expect(config.endpoints.posting).toContain("posting-api.heropost.io");
  });

  it("allows overriding a single service endpoint", () => {
    const config = loadConfig({
      HEROPOST_ACCESS_TOKEN: "a",
      HEROPOST_POSTING_URL: "https://example.test/graphql",
    } as NodeJS.ProcessEnv);
    expect(config.endpoints.posting).toBe("https://example.test/graphql");
    expect(config.endpoints.main).toBe(DEFAULT_ENDPOINTS.main);
  });

  it.each([
    ["1", true],
    ["true", true],
    ["TRUE", true],
    ["yes", true],
    ["on", true],
    ["0", false],
    ["false", false],
    ["", false],
  ])("reads HEROPOST_READ_ONLY=%s as %s", (value, expected) => {
    const config = loadConfig({
      HEROPOST_ACCESS_TOKEN: "a",
      HEROPOST_READ_ONLY: value,
    } as NodeJS.ProcessEnv);
    expect(config.readOnly).toBe(expected);
  });

  it("is not read-only by default", () => {
    expect(loadConfig({ HEROPOST_ACCESS_TOKEN: "a", HEROPOST_CREDENTIALS_FILE: NO_CREDENTIALS_FILE } as NodeJS.ProcessEnv).readOnly).toBe(false);
  });

  it("coerces the default workspace id and rejects nonsense", () => {
    expect(
      loadConfig({
        HEROPOST_ACCESS_TOKEN: "a",
        HEROPOST_WORKSPACE_ID: "42",
      } as NodeJS.ProcessEnv).defaultWorkspaceId,
    ).toBe(42);

    expect(() =>
      loadConfig({
        HEROPOST_ACCESS_TOKEN: "a",
        HEROPOST_WORKSPACE_ID: "not-a-number",
      } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);

    expect(() =>
      loadConfig({
        HEROPOST_ACCESS_TOKEN: "a",
        HEROPOST_WORKSPACE_ID: "-3",
      } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);
  });

  it("rejects a malformed endpoint override rather than falling back silently", () => {
    expect(() =>
      loadConfig({
        HEROPOST_ACCESS_TOKEN: "a",
        HEROPOST_MAIN_URL: "not-a-url",
      } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);
  });
});
