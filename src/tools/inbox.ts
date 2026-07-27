import { z } from "zod";
import { errorResult, jsonResult, listResult } from "../format.js";
import {
  GET_INBOX_THREAD,
  LIST_INBOX_THREADS,
  MARK_INBOX_THREAD_DONE,
  MARK_INBOX_THREAD_READ,
  REPLY_TO_INBOX_THREAD,
  TOGGLE_INBOX_BOOKMARK,
  type GetInboxThreadResult,
  type ListInboxThreadsResult,
  type ReplyToInboxThreadResult,
} from "../operations/inbox.js";
import {
  defineTool,
  skipSchema,
  takeSchema,
  workspaceIdSchema,
  type AnyToolDef,
} from "./common.js";

const listInboxThreads = defineTool({
  name: "heropost_list_inbox_threads",
  title: "List social inbox threads",
  description:
    "List conversations from the Heropost social inbox — comments, direct messages, and " +
    "mentions across connected accounts. Filter to unread or bookmarked to triage. Most " +
    "recently active first.",
  write: false,
  inputSchema: {
    workspaceId: workspaceIdSchema,
    threadType: z
      .enum(["COMMENT", "DIRECT_MESSAGE", "MENTION"])
      .optional()
      .describe("Restrict to one kind of conversation."),
    isRead: z.boolean().optional().describe("false returns only unread threads."),
    isDone: z.boolean().optional().describe("false returns only threads not yet marked done."),
    isBookmarked: z.boolean().optional(),
    take: takeSchema,
    skip: skipSchema,
  },
  async handler(args, { client }) {
    const workspaceId = client.workspaceId(args.workspaceId);
    const data = await client.request<ListInboxThreadsResult>({
      ...LIST_INBOX_THREADS,
      variables: {
        workspaceId,
        filter: {
          ...(args.threadType ? { threadType: { eq: args.threadType } } : {}),
          ...(args.isRead !== undefined ? { isRead: { eq: args.isRead } } : {}),
          ...(args.isDone !== undefined ? { isDone: { eq: args.isDone } } : {}),
          ...(args.isBookmarked !== undefined
            ? { isBookmarked: { eq: args.isBookmarked } }
            : {}),
        },
        take: args.take,
        skip: args.skip,
      },
    });
    return listResult(data.inboxThreads, { skip: args.skip, take: args.take });
  },
});

const getInboxThread = defineTool({
  name: "heropost_get_inbox_thread",
  title: "Read an inbox thread",
  description:
    "The full message history of one inbox thread, including who wrote each message and " +
    "which post it is attached to. Read this before replying.",
  write: false,
  inputSchema: {
    threadId: z.number().int().positive(),
  },
  async handler(args, { client }) {
    const data = await client.request<GetInboxThreadResult>({
      ...GET_INBOX_THREAD,
      variables: { threadId: args.threadId },
    });
    if (!data.inboxThread) {
      return errorResult(`No inbox thread with id ${args.threadId} is visible to this account.`);
    }
    return jsonResult(data.inboxThread);
  },
});

const replyToInboxThread = defineTool({
  name: "heropost_reply_to_inbox_thread",
  title: "Reply in an inbox thread",
  description:
    "Send a reply in an inbox thread. THIS IS PUBLICLY VISIBLE: for a comment or mention the " +
    "reply appears publicly on the social network under your account, and it cannot be " +
    "unsent from here. Read the thread first and confirm the wording with the user.",
  write: true,
  destructive: true,
  inputSchema: {
    threadId: z.number().int().positive(),
    message: z.string().min(1).describe("The reply text, exactly as it should be published."),
  },
  async handler(args, { client }) {
    const data = await client.request<ReplyToInboxThreadResult>({
      ...REPLY_TO_INBOX_THREAD,
      variables: { input: { threadId: args.threadId, message: args.message } },
    });
    return jsonResult({ sent: true, reply: data.replyToInboxThread });
  },
});

const updateInboxThread = defineTool({
  name: "heropost_update_inbox_thread",
  title: "Mark an inbox thread read, done, or bookmarked",
  description:
    "Update triage state on an inbox thread. Only affects Heropost's own inbox — nothing is " +
    "published. Note bookmark is a toggle, not a set.",
  write: true,
  inputSchema: {
    threadId: z.number().int().positive(),
    action: z
      .enum(["MARK_READ", "MARK_DONE", "TOGGLE_BOOKMARK"])
      .describe("TOGGLE_BOOKMARK flips the current bookmark state."),
  },
  async handler(args, { client }) {
    const operation =
      args.action === "MARK_READ"
        ? MARK_INBOX_THREAD_READ
        : args.action === "MARK_DONE"
          ? MARK_INBOX_THREAD_DONE
          : TOGGLE_INBOX_BOOKMARK;

    const data = await client.request<Record<string, boolean | null>>({
      ...operation,
      variables: { threadId: args.threadId },
    });
    return jsonResult({ threadId: args.threadId, action: args.action, result: data });
  },
});

export const inboxTools: AnyToolDef[] = [
  listInboxThreads,
  getInboxThread,
  replyToInboxThread,
  updateInboxThread,
];
