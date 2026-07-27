import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSchema,
  coerceInputValue,
  isInputType,
  parse,
  typeFromAST,
  type GraphQLSchema,
  type OperationDefinitionNode,
} from "graphql";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_TOOLS } from "../src/tools/index.js";
import type { ServiceName } from "../src/config.js";
import { ALL_OPERATIONS } from "../src/operations/index.js";
import { harness } from "./helpers.js";

/**
 * The conformance test proves our operation *documents* are valid. It cannot catch a wrong
 * variable payload, because GraphQL validation never inspects runtime values — which is
 * exactly where the interesting bugs were: `createCustomPost` was being sent `text` and
 * `title` (not fields on CreateCustomPostInput) while omitting the required `options.mode`,
 * and `uploadPostMedia` omitted the required `index`. Both documents validated cleanly and
 * both calls would have failed against the live API.
 *
 * So this suite runs the tools against a stubbed transport, captures what they actually put
 * on the wire, and coerces each variable against its declared input type from the checked-in
 * SDL. Offline, no credentials, and it fails on a missing required field or an unknown one.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaCache = new Map<string, GraphQLSchema | null>();

function schemaFor(service: ServiceName): GraphQLSchema | null {
  if (!schemaCache.has(service)) {
    const path = join(ROOT, "schema", `${service}.graphql`);
    schemaCache.set(service, existsSync(path) ? buildSchema(readFileSync(path, "utf8")) : null);
  }
  return schemaCache.get(service) ?? null;
}

function documentFor(query: string): { operation: string; service: ServiceName } | undefined {
  const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
  const match = ALL_OPERATIONS.find((o) => o.operation === name);
  return match ? { operation: match.operation, service: match.service } : undefined;
}

/** Coerce every variable of a captured request against its declared type. */
function validatePayload(body: { query: string; variables?: Record<string, unknown> }): string[] {
  const meta = documentFor(body.query);
  if (!meta) return [`could not match "${body.query.slice(0, 40)}" to a known operation`];
  const schema = schemaFor(meta.service);
  if (!schema) return [];

  const doc = parse(body.query);
  const op = doc.definitions.find(
    (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
  );
  const errors: string[] = [];

  for (const def of op?.variableDefinitions ?? []) {
    const name = def.variable.name.value;
    const type = typeFromAST(schema, def.type);
    if (!type || !isInputType(type)) {
      errors.push(`${meta.operation}: variable $${name} is not a valid input type`);
      continue;
    }
    const value = body.variables?.[name];
    if (value === undefined) continue; // Optional variables may legitimately be omitted.
    coerceInputValue(value, type, (path, _invalid, error) => {
      const where = path.length > 0 ? ` at ${path.join(".")}` : "";
      errors.push(`${meta.operation}: $${name}${where} — ${error.message}`);
    });
  }
  return errors;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function tool(name: string) {
  const found = ALL_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`No such tool: ${name}`);
  return found;
}

/** Enough canned responses for any tool's multi-step sequence. */
function primed() {
  const h = harness({ HEROPOST_WORKSPACE_ID: "18251" });
  for (let i = 0; i < 8; i++) {
    h.reply({
      data: {
        createCustomPost: { id: 900 },
        updateCustomPost: { id: 900 },
        selectAccountsForCustomPost: { id: 900 },
        selectSocialNetworks: { id: 900 },
        scheduleCustomPost: { id: 900 },
        setScheduledPostToDraft: { id: 900 },
        uploadPostMedia: { id: 900 },
        uploadMedia: { id: 5, url: "https://x.test/a.png", mediaType: "PHOTO" },
        preSignedMediaUploadUrl: { url: "https://storage.test/a.png?sig=1" },
        deleteCustomPost: 1,
        duplicateCustomPost: { id: 901, number: 2, postStatus: "DRAFT", workspaceId: 18251 },
        customPosts: { totalCount: 1, nodes: [{ id: 900, media: [], postStatus: "DRAFT" }] },
        workspaces: { totalCount: 0, nodes: [] },
        accounts: { totalCount: 0, nodes: [] },
        workspace: { id: 18251, name: "W", accounts: [] },
        inboxThreads: { totalCount: 0, nodes: [] },
        inboxThread: { id: 1 },
        replyToInboxThread: { id: 1, inboxThreadId: 1, isFromMe: true, createdDate: "x" },
        teamApprovals: [],
        reviewPostApproval: { id: 1, customPostId: 2 },
        postComments: [],
        addPostComment: { id: 1, customPostId: 2, text: "t", createdDate: "x" },
        postAnalytics: [],
        postAnalyticsRaw: [],
        accountSnapshots: [],
        markInboxThreadRead: true,
      },
    });
  }
  return h;
}

/** One representative valid invocation per tool that talks to the API. */
const INVOCATIONS: { tool: string; args: Record<string, unknown> }[] = [
  { tool: "heropost_list_workspaces", args: { take: 25, skip: 0 } },
  { tool: "heropost_list_accounts", args: { take: 25, skip: 0, social: "LINKED_IN" } },
  {
    tool: "heropost_list_posts",
    args: {
      take: 25,
      skip: 0,
      sortBy: "scheduledDate",
      sortDirection: "ASC",
      status: ["DRAFT", "SCHEDULED"],
      scheduledFrom: "2026-07-01",
      scheduledTo: "2026-08-01",
      failedOnly: false,
      titleContains: "x",
    },
  },
  { tool: "heropost_get_post", args: { postId: 900 } },
  { tool: "heropost_duplicate_post", args: { postId: 900, failedOnly: true } },
  {
    tool: "heropost_create_post",
    args: {
      text: "hello",
      title: "internal",
      accountIds: [99319],
      firstComment: "more",
      scheduledDate: "2026-08-01T09:00:00Z",
      postType: "TEXT",
    },
  },
  { tool: "heropost_update_post", args: { postId: 900, text: "new", title: "t" } },
  { tool: "heropost_schedule_post", args: { postId: 900, scheduledDate: "2026-08-01T09:00:00Z" } },
  { tool: "heropost_unschedule_post", args: { postId: 900 } },
  { tool: "heropost_delete_post", args: { postId: 900 } },
  {
    tool: "heropost_get_post_analytics",
    args: {
      from: "2026-07-01",
      to: "2026-07-26",
      groupBy: "DAILY",
      timeZone: "America/Los_Angeles",
      accountIds: [99319],
      socials: ["LINKED_IN"],
    },
  },
  {
    tool: "heropost_get_post_analytics_raw",
    args: { from: "2026-07-01", to: "2026-07-26", timeZone: "UTC" },
  },
  { tool: "heropost_get_account_snapshots", args: { from: "2026-07-01", to: "2026-07-26" } },
  {
    tool: "heropost_list_inbox_threads",
    args: { take: 25, skip: 0, threadType: "COMMENT", isRead: false },
  },
  { tool: "heropost_get_inbox_thread", args: { threadId: 3 } },
  { tool: "heropost_reply_to_inbox_thread", args: { threadId: 3, message: "hi" } },
  { tool: "heropost_update_inbox_thread", args: { threadId: 3, action: "MARK_READ" } },
  { tool: "heropost_list_approvals", args: { status: "PENDING" } },
  { tool: "heropost_review_approval", args: { approvalId: 5, approved: true, comment: "ok" } },
  { tool: "heropost_list_post_comments", args: {} },
  { tool: "heropost_add_post_comment", args: { postId: 900, text: "note" } },
];

/**
 * Prove the checker has teeth before trusting what it says. These are the two exact shapes of
 * the bugs it exists to catch — reproduced against the real SDL rather than a fixture.
 */
describe("the payload checker itself", () => {
  const createDoc = ALL_OPERATIONS.find((o) => o.operation === "CreateCustomPost")!.document;
  const attachDoc = ALL_OPERATIONS.find((o) => o.operation === "UploadPostMedia")!.document;

  it("rejects a field that is not on the input type", () => {
    // What create_post used to send: text/title are on UpdateCustomPostInput, not Create.
    const errors = validatePayload({
      query: createDoc,
      variables: { customPost: { workspaceId: 1, text: "hi", title: "t" } },
    });
    expect(errors.join("; ")).toMatch(/text/);
  });

  it("rejects a missing required field", () => {
    // `options.mode` is required; omitting the whole options object must fail.
    const errors = validatePayload({
      query: createDoc,
      variables: { customPost: { workspaceId: 1, options: {} } },
    });
    expect(errors.join("; ")).toMatch(/mode/);
  });

  it("rejects the missing required index on media attachment", () => {
    const errors = validatePayload({
      query: attachDoc,
      variables: { customPost: { customPostId: 1, mediaId: 2, url: "u", mediaType: "PHOTO" } },
    });
    expect(errors.join("; ")).toMatch(/index/);
  });

  it("accepts a correct payload", () => {
    expect(
      validatePayload({
        query: createDoc,
        variables: { customPost: { workspaceId: 1, options: { mode: "TO_ALL", allOption: "TEXT" } } },
      }),
    ).toEqual([]);
  });
});

describe("every tool sends payloads the real schema accepts", () => {
  it("covers every tool that talks to the API", () => {
    const covered = new Set(INVOCATIONS.map((i) => i.tool));
    const uncovered = ALL_TOOLS.map((t) => t.name)
      // Media upload needs a real file, so it gets its own test below.
      .filter((n) => n !== "heropost_upload_post_media")
      .filter((n) => !covered.has(n));
    expect(uncovered).toEqual([]);
  });

  for (const { tool: name, args } of INVOCATIONS) {
    it(`${name} sends valid variables`, async () => {
      const h = primed();
      await tool(name).handler(args, { client: h.client });

      expect(h.calls.length).toBeGreaterThan(0);
      const errors = h.calls
        .filter((c) => c.url.includes("/graphql"))
        .flatMap((c) => validatePayload(c.body as { query: string; variables?: Record<string, unknown> }));
      expect(errors).toEqual([]);
    });
  }
});

describe("media attachment", () => {
  it("sends a valid uploadPostMedia payload, including the required index", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "heropost-payload-"));
    const file = join(dir, "a.png");
    await writeFile(file, "bytes");

    const h = primed();
    await tool("heropost_upload_post_media").handler(
      { postId: 900, filePath: file },
      { client: h.client },
    );

    const errors = h.calls
      .filter((c) => c.url.includes("/graphql"))
      .flatMap((c) => validatePayload(c.body as { query: string; variables?: Record<string, unknown> }));
    expect(errors).toEqual([]);

    const attach = h.calls.find((c) =>
      String((c.body as { query?: string }).query ?? "").includes("UploadPostMedia"),
    );
    const vars = (attach?.body as { variables: { customPost: Record<string, unknown> } }).variables;
    expect(vars.customPost.index).toBe(0);
  });
});
