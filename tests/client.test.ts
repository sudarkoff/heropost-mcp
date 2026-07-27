import { afterEach, describe, expect, it, vi } from "vitest";
import { HeropostClient } from "../src/client.js";
import { RefreshTokenProvider, StaticTokenProvider } from "../src/auth/provider.js";
import { loadConfig } from "../src/config.js";
import {
  HeropostAuthError,
  HeropostRequestError,
  HeropostTransportError,
} from "../src/errors.js";
import { LIST_WORKSPACES } from "../src/operations/workspaces.js";
import { AUTH_ERROR_PAYLOAD, harness } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HeropostClient", () => {
  it("posts to the endpoint for the operation's service with a bearer token", async () => {
    const h = harness();
    h.reply({ data: { workspaces: { totalCount: 0, nodes: [] } } });

    await h.client.request({ ...LIST_WORKSPACES, variables: { take: 5, skip: 0 } });

    expect(h.calls).toHaveLength(1);
    const call = h.calls[0]!;
    expect(call.url).toBe("https://api.heropost.io/graphql");
    expect(call.method).toBe("POST");
    expect(call.headers.authorization).toBe("Bearer test-token");
    expect(call.body).toMatchObject({
      query: expect.stringContaining("ListWorkspaces"),
      variables: { take: 5, skip: 0 },
    });
  });

  it("routes posting operations to the posting service", async () => {
    const h = harness();
    h.reply({ data: { createCustomPost: { id: 1 } } });

    await h.client.request({
      service: "posting",
      operation: "CreateCustomPost",
      document: "mutation CreateCustomPost { createCustomPost { id } }",
    });

    expect(h.calls[0]!.url).toBe("https://posting-api.heropost.io/graphql");
  });

  it("classifies the real authorization payload as an auth error", async () => {
    const h = harness();
    h.reply(AUTH_ERROR_PAYLOAD);

    await expect(h.client.request({ ...LIST_WORKSPACES })).rejects.toBeInstanceOf(
      HeropostAuthError,
    );
  });

  it("explains how to fix an expired pasted token", async () => {
    const h = harness();
    h.reply(AUTH_ERROR_PAYLOAD);

    await expect(h.client.request({ ...LIST_WORKSPACES })).rejects.toThrow(
      /HEROPOST_REFRESH_TOKEN/,
    );
  });

  it("treats other GraphQL errors as request errors, not auth failures", async () => {
    const h = harness();
    h.reply({ errors: [{ message: "Workspace 99 not found" }] });

    const error = await h.client.request({ ...LIST_WORKSPACES }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HeropostRequestError);
    expect((error as Error).message).toContain("Workspace 99 not found");
  });

  it("reports a non-JSON body instead of throwing a parse error", async () => {
    const h = harness();
    h.reply(null, { raw: "<html>gateway timeout</html>", status: 504 });

    await expect(h.client.request({ ...LIST_WORKSPACES })).rejects.toBeInstanceOf(
      HeropostTransportError,
    );
  });

  it("retries once with a fresh token when the access token has expired", async () => {
    // A refresh-token provider can recover from an expired access token; the client should
    // invalidate and retry exactly once rather than surfacing the failure.
    const config = loadConfig({
      HEROPOST_REFRESH_TOKEN: "refresh-1",
      HEROPOST_WORKSPACE_ID: "7",
    } as NodeJS.ProcessEnv);

    let tokenRequests = 0;
    let graphqlRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/connect/token")) {
          tokenRequests++;
          return new Response(
            JSON.stringify({
              access_token: `access-${tokenRequests}`,
              refresh_token: `refresh-${tokenRequests + 1}`,
              expires_in: 3600,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        graphqlRequests++;
        const payload =
          graphqlRequests === 1
            ? AUTH_ERROR_PAYLOAD
            : { data: { workspaces: { totalCount: 1, nodes: [{ id: 7, name: "Unleash" }] } } };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const client = new HeropostClient(
      config,
      new RefreshTokenProvider(config, "refresh-1"),
    );
    const data = await client.request<{ workspaces: { totalCount: number } }>({
      ...LIST_WORKSPACES,
    });

    expect(data.workspaces.totalCount).toBe(1);
    expect(graphqlRequests).toBe(2);
    expect(tokenRequests).toBe(2);
  });

  it("does not retry a pasted token, since there is nothing to renew", async () => {
    const config = loadConfig({ HEROPOST_ACCESS_TOKEN: "bad" } as NodeJS.ProcessEnv);
    let graphqlRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        graphqlRequests++;
        return new Response(JSON.stringify(AUTH_ERROR_PAYLOAD), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const client = new HeropostClient(config, new StaticTokenProvider("bad"));
    await expect(client.request({ ...LIST_WORKSPACES })).rejects.toBeInstanceOf(
      HeropostAuthError,
    );
    expect(graphqlRequests).toBe(1);
  });
});

describe("workspace resolution", () => {
  it("falls back to HEROPOST_WORKSPACE_ID", () => {
    expect(harness().client.workspaceId()).toBe(7);
  });

  it("prefers an explicit id", () => {
    expect(harness().client.workspaceId(99)).toBe(99);
  });

  it("says what to do when no workspace is available", () => {
    const h = harness({ HEROPOST_WORKSPACE_ID: "" });
    expect(() => h.client.workspaceId()).toThrow(/heropost_list_workspaces/);
  });
});
