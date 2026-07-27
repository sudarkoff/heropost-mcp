import { z } from "zod";
import { errorResult, jsonResult, listResult } from "../format.js";
import {
  DUPLICATE_POST,
  GET_POST,
  LIST_POSTS,
  type DuplicatePostResult,
  type ListPostsResult,
} from "../operations/posts.js";
import {
  dateRangeFilter,
  defineTool,
  isoDateSchema,
  postStatusSchema,
  skipSchema,
  takeSchema,
  workspaceIdSchema,
  type AnyToolDef,
} from "./common.js";

const listPosts = defineTool({
  name: "heropost_list_posts",
  title: "List posts on the calendar",
  description:
    "Browse the Heropost content calendar: drafts, scheduled, in-progress, and already-posted " +
    "posts. Filter by status, workspace, and date range, or set failedOnly to find posts that " +
    "failed to publish. Sorted by scheduled date, soonest first.",
  write: false,
  inputSchema: {
    workspaceId: workspaceIdSchema,
    status: postStatusSchema
      .or(z.array(postStatusSchema))
      .optional()
      .describe("Restrict to one status or several, e.g. SCHEDULED or [DRAFT, SCHEDULED]."),
    scheduledFrom: isoDateSchema.optional().describe("Earliest scheduled date, inclusive."),
    scheduledTo: isoDateSchema.optional().describe("Latest scheduled date, inclusive."),
    postedFrom: isoDateSchema.optional().describe("Earliest actual posted date, inclusive."),
    postedTo: isoDateSchema.optional().describe("Latest actual posted date, inclusive."),
    failedOnly: z
      .boolean()
      .optional()
      .describe("Only posts that hit a publishing failure on at least one network."),
    titleContains: z.string().optional(),
    sortBy: z
      .enum(["scheduledDate", "postedDate", "updatedDate", "id"])
      .default("scheduledDate"),
    sortDirection: z.enum(["ASC", "DESC"]).default("ASC"),
    take: takeSchema,
    skip: skipSchema,
  },
  async handler(args, { client }) {
    const workspaceId = client.workspaceId(args.workspaceId);
    const scheduled = dateRangeFilter(args.scheduledFrom, args.scheduledTo);
    const posted = dateRangeFilter(args.postedFrom, args.postedTo);
    const statuses = args.status
      ? Array.isArray(args.status)
        ? args.status
        : [args.status]
      : undefined;

    const data = await client.request<ListPostsResult>({
      ...LIST_POSTS,
      variables: {
        filter: {
          workspaceId: { eq: workspaceId },
          ...(statuses
            ? { postStatus: statuses.length === 1 ? { eq: statuses[0] } : { in: statuses } }
            : {}),
          ...(scheduled ? { scheduledDate: scheduled } : {}),
          ...(posted ? { postedDate: posted } : {}),
          ...(args.failedOnly !== undefined
            ? { hasPostingFailure: { eq: args.failedOnly } }
            : {}),
          ...(args.titleContains ? { title: { contains: args.titleContains } } : {}),
        },
        take: args.take,
        skip: args.skip,
        sortField: args.sortBy,
        sortDirection: args.sortDirection,
      },
    });
    return listResult(data.customPosts, { skip: args.skip, take: args.take });
  },
});

const getPost = defineTool({
  name: "heropost_get_post",
  title: "Get one post in full",
  description:
    "Full detail for a single post: the shared text and media, every per-network variant, the " +
    "accounts it targets, and per-account publishing state including failure messages. Use " +
    "this to diagnose why a post did not go out.",
  write: false,
  inputSchema: {
    postId: z.number().int().positive().describe("The post id (from heropost_list_posts)."),
  },
  async handler(args, { client }) {
    const data = await client.request<ListPostsResult>({
      ...GET_POST,
      variables: { filter: { id: { eq: args.postId } } },
    });
    const post = (data.customPosts?.nodes ?? []).find((n) => n !== null);
    if (!post) {
      return errorResult(
        `No Heropost post with id ${args.postId} is visible to this account. ` +
          `Check the id with heropost_list_posts.`,
      );
    }
    return jsonResult(post);
  },
});

const duplicatePost = defineTool({
  name: "heropost_duplicate_post",
  title: "Duplicate a post",
  description:
    "Copy an existing post into a new draft. Set failedOnly to rebuild a post containing only " +
    "the networks that failed last time — the standard way to retry a partial failure. The " +
    "copy is a draft: it will not go out until you schedule it.",
  write: true,
  inputSchema: {
    postId: z.number().int().positive(),
    failedOnly: z
      .boolean()
      .default(false)
      .describe("Copy only the networks whose publishing failed."),
  },
  async handler(args, { client }) {
    const data = await client.request<DuplicatePostResult>({
      ...DUPLICATE_POST,
      variables: { customPost: { customPostId: args.postId, failedOnly: args.failedOnly } },
    });
    return jsonResult({
      duplicatedFrom: args.postId,
      post: data.duplicateCustomPost,
      note: "The copy is a DRAFT. Schedule it with heropost_schedule_post when ready.",
    });
  },
});

export const postTools: AnyToolDef[] = [listPosts, getPost, duplicatePost];
