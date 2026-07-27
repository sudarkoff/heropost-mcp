import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_TOOLS } from "../src/tools/index.js";
import { harness } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function tool(name: string) {
  const found = ALL_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`No such tool: ${name}`);
  return found;
}

function operationsIn(calls: { body: unknown }[]): string[] {
  return calls.map((c) => {
    const query = (c.body as { query?: string }).query ?? "";
    return /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "unknown";
  });
}

describe("heropost_create_post", () => {
  it("creates, targets accounts, sets text — and never schedules or publishes", async () => {
    const h = harness();
    h.reply({ data: { createCustomPost: { id: 900 } } });
    h.reply({ data: { selectAccountsForCustomPost: { id: 900 } } });
    h.reply({ data: { updateCustomPost: { id: 900 } } });
    h.reply({ data: { customPosts: { totalCount: 1, nodes: [{ id: 900, postStatus: "DRAFT" }] } } });

    const result = await tool("heropost_create_post").handler(
      { text: "Hello world", accountIds: [11, 12], scheduledDate: "2026-08-01T09:00:00Z" },
      { client: h.client },
    );

    const ops = operationsIn(h.calls);
    expect(ops).toEqual([
      "CreateCustomPost",
      "SelectAccountsForCustomPost",
      "UpdateCustomPost",
      "GetPost",
    ]);
    // The safety property that matters: creating a post must never queue or publish it.
    expect(ops).not.toContain("ScheduleCustomPost");
    expect(ops).not.toContain("PublishCustomPost");

    const out = JSON.parse(result.content[0]!.text) as { postId: number; status: string };
    expect(out).toMatchObject({ postId: 900, status: "DRAFT" });
  });

  it("sends the default workspace and the requested accounts", async () => {
    const h = harness();
    h.reply({ data: { createCustomPost: { id: 901 } } });
    h.reply({ data: { selectAccountsForCustomPost: { id: 901 } } });
    h.reply({ data: { updateCustomPost: { id: 901 } } });
    h.reply({ data: { customPosts: { totalCount: 1, nodes: [{ id: 901 }] } } });

    await tool("heropost_create_post").handler(
      { text: "Body", accountIds: [11], title: "Internal label" },
      { client: h.client },
    );

    // Create carries only workspaceId + options; text and title arrive via update. That split
    // is the schema's, not ours — CreateCustomPostInput has no content fields.
    expect((h.calls[0]!.body as { variables: unknown }).variables).toMatchObject({
      customPost: { workspaceId: 7, options: { mode: "TO_ALL", allOption: "TEXT" } },
    });
    expect((h.calls[1]!.body as { variables: unknown }).variables).toMatchObject({
      customPost: { customPostId: 901, accountIds: [11] },
    });
    expect((h.calls[2]!.body as { variables: unknown }).variables).toMatchObject({
      customPost: { customPostId: 901, text: "Body", title: "Internal label" },
    });
  });

  it("merges advancedInput, the escape hatch for unmodeled fields", async () => {
    const h = harness();
    h.reply({ data: { createCustomPost: { id: 902 } } });
    h.reply({ data: { selectAccountsForCustomPost: { id: 902 } } });
    h.reply({ data: { updateCustomPost: { id: 902 } } });
    h.reply({ data: { customPosts: { totalCount: 1, nodes: [{ id: 902 }] } } });

    await tool("heropost_create_post").handler(
      { text: "Body", accountIds: [11], advancedInput: { postType: "IMAGE" } },
      { client: h.client },
    );

    // advancedInput lands on UpdateCustomPost, which is where content fields live —
    // CreateCustomPostInput accepts only {workspaceId, options}.
    const update = h.calls.find((c) =>
      String((c.body as { query?: string }).query ?? "").includes("UpdateCustomPost"),
    );
    expect(
      (update!.body as { variables: { customPost: Record<string, unknown> } }).variables.customPost,
    ).toMatchObject({ customPostId: 902, postType: "IMAGE" });
  });

  it("reports a missing id with the command that fixes the schema", async () => {
    const h = harness();
    h.reply({ data: { createCustomPost: null } });

    await expect(
      tool("heropost_create_post").handler(
        { text: "Body", accountIds: [11] },
        { client: h.client },
      ),
    ).rejects.toThrow(/npm run introspect/);
  });
});

describe("heropost_schedule_post", () => {
  it("sets the time then queues it", async () => {
    const h = harness();
    h.reply({ data: { updateCustomPost: { id: 5 } } });
    h.reply({ data: { scheduleCustomPost: { id: 5 } } });
    h.reply({ data: { customPosts: { totalCount: 1, nodes: [{ id: 5, postStatus: "SCHEDULED" }] } } });

    await tool("heropost_schedule_post").handler(
      { postId: 5, scheduledDate: "2026-08-01T09:00:00Z" },
      { client: h.client },
    );

    expect(operationsIn(h.calls)).toEqual([
      "UpdateCustomPost",
      "ScheduleCustomPost",
      "GetPost",
    ]);
  });

  it("queues without touching the time when none is given", async () => {
    const h = harness();
    h.reply({ data: { scheduleCustomPost: { id: 5 } } });
    h.reply({ data: { customPosts: { totalCount: 1, nodes: [{ id: 5 }] } } });

    await tool("heropost_schedule_post").handler({ postId: 5 }, { client: h.client });

    expect(operationsIn(h.calls)).toEqual(["ScheduleCustomPost", "GetPost"]);
  });
});

describe("heropost_update_post", () => {
  it("refuses a no-op instead of sending an empty mutation", async () => {
    const h = harness();
    await expect(
      tool("heropost_update_post").handler({ postId: 5 }, { client: h.client }),
    ).rejects.toThrow(/Nothing to update/);
    expect(h.calls).toHaveLength(0);
  });

  it("sends only the fields that were provided", async () => {
    const h = harness();
    h.reply({ data: { updateCustomPost: { id: 5 } } });
    h.reply({ data: { customPosts: { totalCount: 1, nodes: [{ id: 5 }] } } });

    await tool("heropost_update_post").handler(
      { postId: 5, text: "Revised" },
      { client: h.client },
    );

    const vars = (h.calls[0]!.body as { variables: { customPost: Record<string, unknown> } })
      .variables.customPost;
    expect(vars).toEqual({ customPostId: 5, text: "Revised" });
  });
});

describe("heropost_duplicate_post", () => {
  it("can copy only the failed networks, for retrying a partial failure", async () => {
    const h = harness();
    h.reply({ data: { duplicateCustomPost: { id: 10, number: 3, postStatus: "DRAFT" } } });

    const result = await tool("heropost_duplicate_post").handler(
      { postId: 4, failedOnly: true },
      { client: h.client },
    );

    expect((h.calls[0]!.body as { variables: unknown }).variables).toEqual({
      customPost: { customPostId: 4, failedOnly: true },
    });
    expect(result.content[0]!.text).toMatch(/DRAFT/);
  });
});
