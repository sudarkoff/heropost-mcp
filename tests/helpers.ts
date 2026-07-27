import { vi, type MockInstance } from "vitest";
import { HeropostClient } from "../src/client.js";
import { StaticTokenProvider } from "../src/auth/provider.js";
import { loadConfig, type Config } from "../src/config.js";

/**
 * A path that does not exist, used to keep credential discovery out of the developer's real
 * ~/.config/heropost/credentials.json. Without this the suite passes or fails depending on
 * whose machine it runs on.
 */
export const NO_CREDENTIALS_FILE = "/nonexistent-heropost-test/credentials.json";

export interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface Harness {
  client: HeropostClient;
  config: Config;
  calls: CapturedCall[];
  /** Queue a response for the next call, in order. */
  reply: (payload: unknown, init?: { status?: number; raw?: string }) => void;
  fetchMock: MockInstance;
}

/**
 * A client wired to a fake `fetch`. Every test in this suite runs offline: no network, no
 * credentials, and no dependence on Heropost being up.
 */
export function harness(env: Record<string, string> = {}): Harness {
  const config = loadConfig({
    HEROPOST_ACCESS_TOKEN: "test-token",
    HEROPOST_WORKSPACE_ID: "7",
    HEROPOST_CREDENTIALS_FILE: NO_CREDENTIALS_FILE,
    ...env,
  } as NodeJS.ProcessEnv);

  const calls: CapturedCall[] = [];
  const queue: { payload: unknown; status: number; raw?: string }[] = [];

  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    let body: unknown = init?.body;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        /* leave as string */
      }
    }
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body,
    });

    const next = queue.shift() ?? { payload: { data: {} }, status: 200 };
    const text = next.raw ?? JSON.stringify(next.payload);
    return new Response(text, {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    config,
    client: new HeropostClient(config, new StaticTokenProvider("test-token")),
    calls,
    reply(payload, init) {
      queue.push({
        payload,
        status: init?.status ?? 200,
        ...(init?.raw !== undefined ? { raw: init.raw } : {}),
      });
    },
    fetchMock,
  };
}

/** The exact authorization-error payload the live API returns for an unauthenticated call. */
export const AUTH_ERROR_PAYLOAD = {
  errors: [
    {
      message:
        "You are not authorized to run this query.\nThe current user must be authenticated.",
      locations: [{ line: 1, column: 3 }],
      extensions: { code: "authorization", codes: ["authorization"], number: "6.1.1" },
    },
  ],
};
