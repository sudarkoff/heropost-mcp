import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_TOOLS, selectTools } from "../src/tools/index.js";
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

function parseResult(result: { content: { text: string }[] }): unknown {
  return JSON.parse(result.content[0]!.text);
}

describe("tool registry", () => {
  it("names every tool with the heropost_ prefix", () => {
    for (const t of ALL_TOOLS) expect(t.name).toMatch(/^heropost_[a-z_]+$/);
  });

  it("has unique tool names", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every tool a description that a model can act on", () => {
    for (const t of ALL_TOOLS) {
      expect(t.description.length, `${t.name} description`).toBeGreaterThan(40);
      expect(t.title.length, `${t.name} title`).toBeGreaterThan(3);
    }
  });

  it("withholds every write tool in read-only mode", () => {
    const readOnly = selectTools({ readOnly: true });
    expect(readOnly.length).toBeGreaterThan(0);
    expect(readOnly.every((t) => !t.write)).toBe(true);
    expect(readOnly.map((t) => t.name)).not.toContain("heropost_create_post");
    expect(readOnly.map((t) => t.name)).not.toContain("heropost_schedule_post");
    expect(readOnly.map((t) => t.name)).not.toContain("heropost_reply_to_inbox_thread");
  });

  it("exposes writes when not read-only", () => {
    const all = selectTools({ readOnly: false });
    expect(all.length).toBe(ALL_TOOLS.length);
    expect(all.map((t) => t.name)).toContain("heropost_create_post");
  });

  it("warns in the description of every publicly-visible write tool", () => {
    // These are the tools that can put words in front of a real audience. Each must say so,
    // because the description is all a model sees before deciding to call it.
    for (const name of ["heropost_schedule_post", "heropost_reply_to_inbox_thread"]) {
      expect(tool(name).description).toMatch(/publish|publicly/i);
      expect(tool(name).destructive).toBe(true);
    }
  });

  it("marks create_post as a draft-only operation", () => {
    // The safety property that matters most: creating never publishes.
    expect(tool("heropost_create_post").description).toMatch(/ALWAYS CREATES A DRAFT/);
  });

  it("does not expose immediate publishing or third-party credential storage", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(names).not.toContain("heropost_publish_post");
    expect(names.some((n) => /private_api|creds|password/i.test(n))).toBe(false);
  });
});

describe("heropost_list_workspaces", () => {
  it("returns items with paging metadata", async () => {
    const h = harness();
    h.reply({
      data: {
        workspaces: {
          totalCount: 2,
          nodes: [
            { id: 7, name: "Unleash", timeZone: "America/Los_Angeles", notes: null },
            { id: 8, name: "Client A", timeZone: null, notes: null },
          ],
        },
      },
    });

    const out = parseResult(
      await tool("heropost_list_workspaces").handler({ take: 25, skip: 0 }, { client: h.client }),
    ) as { totalCount: number; items: { id: number }[] };

    expect(out.totalCount).toBe(2);
    expect(out.items.map((i) => i.id)).toEqual([7, 8]);
    // Nulls are pruned so the model isn't shown dozens of empty fields.
    expect(JSON.stringify(out)).not.toContain("null");
  });

  it("signals that more rows exist", async () => {
    const h = harness();
    h.reply({ data: { workspaces: { totalCount: 40, nodes: [{ id: 1, name: "A" }] } } });

    const out = parseResult(
      await tool("heropost_list_workspaces").handler({ take: 1, skip: 0 }, { client: h.client }),
    ) as { moreAvailable?: boolean; nextSkip?: number };

    expect(out.moreAvailable).toBe(true);
    expect(out.nextSkip).toBe(1);
  });
});

describe("heropost_list_posts", () => {
  it("builds a status and date filter scoped to the workspace", async () => {
    const h = harness();
    h.reply({ data: { customPosts: { totalCount: 0, nodes: [] } } });

    await tool("heropost_list_posts").handler(
      {
        status: "SCHEDULED",
        scheduledFrom: "2026-07-27",
        scheduledTo: "2026-08-03",
        take: 25,
        skip: 0,
        sortBy: "scheduledDate",
        sortDirection: "ASC",
      },
      { client: h.client },
    );

    const body = h.calls[0]!.body as { variables: { filter: Record<string, unknown> } };
    expect(body.variables.filter).toMatchObject({
      workspaceId: { eq: 7 },
      postStatus: { eq: "SCHEDULED" },
      scheduledDate: { ge: "2026-07-27", le: "2026-08-03" },
    });
  });

  it("uses an `in` filter for several statuses", async () => {
    const h = harness();
    h.reply({ data: { customPosts: { totalCount: 0, nodes: [] } } });

    await tool("heropost_list_posts").handler(
      { status: ["DRAFT", "SCHEDULED"], take: 25, skip: 0, sortBy: "id", sortDirection: "DESC" },
      { client: h.client },
    );

    const body = h.calls[0]!.body as { variables: { filter: { postStatus: unknown } } };
    expect(body.variables.filter.postStatus).toEqual({ in: ["DRAFT", "SCHEDULED"] });
  });

  it("finds failed posts", async () => {
    const h = harness();
    h.reply({ data: { customPosts: { totalCount: 0, nodes: [] } } });

    await tool("heropost_list_posts").handler(
      { failedOnly: true, take: 25, skip: 0, sortBy: "id", sortDirection: "DESC" },
      { client: h.client },
    );

    const body = h.calls[0]!.body as { variables: { filter: { hasPostingFailure: unknown } } };
    expect(body.variables.filter.hasPostingFailure).toEqual({ eq: true });
  });
});

describe("heropost_get_post", () => {
  it("returns a clear error for an unknown id instead of an empty object", async () => {
    const h = harness();
    h.reply({ data: { customPosts: { totalCount: 0, nodes: [] } } });

    const result = await tool("heropost_get_post").handler(
      { postId: 12345 },
      { client: h.client },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("12345");
    expect(result.content[0]!.text).toMatch(/heropost_list_posts/);
  });
});

describe("heropost_list_accounts", () => {
  it("scopes to a workspace via workspace(id){accounts} and filters client-side", async () => {
    const h = harness();
    h.reply({
      data: {
        workspace: {
          id: 7,
          name: "Unleash",
          accounts: [
            { id: 1, name: "LinkedIn Page", social: "LINKED_IN" },
            { id: 2, name: "X Profile", social: "X" },
          ],
        },
      },
    });

    const out = parseResult(
      await tool("heropost_list_accounts").handler(
        { workspaceId: 7, social: "X", take: 25, skip: 0 },
        { client: h.client },
      ),
    ) as { items: { id: number }[] };

    expect(h.calls[0]!.body).toMatchObject({
      query: expect.stringContaining("ListWorkspaceAccounts"),
      variables: { workspaceId: 7 },
    });
    expect(out.items.map((a) => a.id)).toEqual([2]);
  });
});

describe("heropost_get_post_analytics", () => {
  it("passes the range, grouping, and time zone through", async () => {
    const h = harness();
    h.reply({ data: { postAnalytics: [{ date: "2026-07-01", reach: 100 }] } });

    await tool("heropost_get_post_analytics").handler(
      {
        from: "2026-07-01",
        to: "2026-07-26",
        groupBy: "POST",
        timeZone: "America/Los_Angeles",
      },
      { client: h.client },
    );

    const body = h.calls[0]!.body as { variables: { filter: Record<string, unknown> } };
    expect(body.variables.filter).toMatchObject({
      from: "2026-07-01",
      to: "2026-07-26",
      groupBy: "POST",
      timeZone: "America/Los_Angeles",
      workspaceIds: [7],
    });
  });
});

describe("heropost_update_inbox_thread", () => {
  it("picks the mutation matching the requested action", async () => {
    const cases = [
      ["MARK_READ", "MarkInboxThreadRead"],
      ["MARK_DONE", "MarkInboxThreadDone"],
      ["TOGGLE_BOOKMARK", "ToggleInboxBookmark"],
    ] as const;

    for (const [action, operation] of cases) {
      const h = harness();
      h.reply({ data: { result: true } });
      await tool("heropost_update_inbox_thread").handler(
        { threadId: 3, action },
        { client: h.client },
      );
      expect((h.calls[0]!.body as { query: string }).query).toContain(operation);
      vi.unstubAllGlobals();
    }
  });
});
