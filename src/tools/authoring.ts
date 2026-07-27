import { z } from "zod";
import { jsonResult } from "../format.js";
import { uploadLocalFile } from "../media.js";
import { GET_POST, type ListPostsResult } from "../operations/posts.js";
import {
  CREATE_CUSTOM_POST,
  DELETE_CUSTOM_POST,
  SCHEDULE_CUSTOM_POST,
  SELECT_ACCOUNTS_FOR_CUSTOM_POST,
  SET_SCHEDULED_POST_TO_DRAFT,
  UPDATE_CUSTOM_POST,
  UPLOAD_POST_MEDIA,
  type IdResult,
} from "../operations/posting.js";
import {
  defineTool,
  isoDateSchema,
  sanitizeAdvancedInput,
  socialSchema,
  type AnyToolDef,
} from "./common.js";

/**
 * These tools drive the `posting` service, whose schema we cannot introspect without a
 * token (see operations/posting.ts). The input field names below come from the web app's
 * own call sites, so they are informed but not schema-verified — every tool therefore
 * takes an `advancedInput` escape hatch, letting a caller supply extra or corrected
 * fields without waiting on a code change. Run
 * `npm run introspect -- posting --token <token>` to replace guesswork with the real SDL.
 */
const advancedInputSchema = z
  .record(z.unknown())
  .optional()
  .describe(
    "Escape hatch: extra fields merged into the GraphQL input, for fields not yet modeled " +
      "here. Only needed if Heropost rejects a call for a missing field. Cannot set " +
      "workspaceId, customPostId, accountIds, postStatus, or any publish flag — use the " +
      "tool's own arguments for those.",
  );

/** Reads a post back through the schema-verified `main` service. */
async function readBack(
  client: Parameters<AnyToolDef["handler"]>[1]["client"],
  postId: number,
): Promise<unknown> {
  const data = await client.request<ListPostsResult>({
    ...GET_POST,
    variables: { filter: { id: { eq: postId } } },
  });
  return (data.customPosts?.nodes ?? []).find((n) => n !== null) ?? { id: postId };
}

const createPost = defineTool({
  name: "heropost_create_post",
  title: "Create a draft post",
  description:
    "Compose a new post in Heropost. ALWAYS CREATES A DRAFT — nothing is published or queued " +
    "by this tool. Provide the text and the account ids to target (from " +
    "heropost_list_accounts); attach media with heropost_upload_post_media, then queue it " +
    "with heropost_schedule_post. Setting scheduledDate here only fills in the intended time; " +
    "it does not schedule.",
  write: true,
  inputSchema: {
    workspaceId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Defaults to HEROPOST_WORKSPACE_ID."),
    text: z.string().min(1).describe("The post body, shared across networks."),
    title: z.string().optional().describe("Internal label for the calendar, not published."),
    accountIds: z
      .array(z.number().int().positive())
      .min(1)
      .describe("Accounts to post to, from heropost_list_accounts."),
    firstComment: z
      .string()
      .optional()
      .describe("Auto-posted first comment, where the network supports it."),
    scheduledDate: isoDateSchema
      .optional()
      .describe("Intended publish time (ISO-8601). Still a draft until you schedule it."),
    advancedInput: advancedInputSchema,
  },
  async handler(args, { client }) {
    const workspaceId = client.workspaceId(args.workspaceId);

    const created = await client.request<IdResult>({
      ...CREATE_CUSTOM_POST,
      variables: {
        customPost: {
          // advancedInput goes first so the vetted arguments always win.
          ...sanitizeAdvancedInput(args.advancedInput),
          workspaceId,
          ...(args.title ? { title: args.title } : {}),
          text: args.text,
        },
      },
    });
    const postId = created.createCustomPost?.id;
    if (!postId) {
      throw new Error(
        "Heropost created no post id. If this persists, refresh the posting schema: " +
          "npm run introspect -- posting --token <access token>",
      );
    }

    await client.request<IdResult>({
      ...SELECT_ACCOUNTS_FOR_CUSTOM_POST,
      variables: { customPost: { customPostId: postId, accountIds: args.accountIds } },
    });

    // Text and schedule land via update, mirroring the web app's own sequence.
    if (args.firstComment || args.scheduledDate || args.text) {
      await client.request<IdResult>({
        ...UPDATE_CUSTOM_POST,
        variables: {
          customPost: {
            customPostId: postId,
            text: args.text,
            ...(args.firstComment ? { firstComment: args.firstComment } : {}),
            ...(args.scheduledDate ? { scheduledDate: args.scheduledDate } : {}),
          },
        },
      });
    }

    return jsonResult({
      created: true,
      postId,
      status: "DRAFT",
      note:
        "This is a DRAFT and will not publish. Attach media with heropost_upload_post_media, " +
        "then call heropost_schedule_post to queue it.",
      post: await readBack(client, postId),
    });
  },
});

const updatePost = defineTool({
  name: "heropost_update_post",
  title: "Edit a post",
  description:
    "Change the text, title, first comment, or intended time of an existing post. Editing a " +
    "post that is already SCHEDULED keeps it scheduled — use heropost_unschedule_post first " +
    "if you want it back in drafts.",
  write: true,
  inputSchema: {
    postId: z.number().int().positive(),
    text: z.string().optional(),
    title: z.string().optional(),
    firstComment: z.string().optional(),
    scheduledDate: isoDateSchema.optional(),
    advancedInput: advancedInputSchema,
  },
  async handler(args, { client }) {
    const { postId, advancedInput, ...fields } = args;
    const extra = sanitizeAdvancedInput(advancedInput);
    const changes = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(changes).length === 0 && Object.keys(extra).length === 0) {
      throw new Error("Nothing to update — pass at least one field to change.");
    }
    await client.request<IdResult>({
      ...UPDATE_CUSTOM_POST,
      variables: { customPost: { ...extra, customPostId: postId, ...changes } },
    });
    return jsonResult({ updated: true, postId, post: await readBack(client, postId) });
  },
});

const schedulePost = defineTool({
  name: "heropost_schedule_post",
  title: "Schedule a post to publish",
  description:
    "Queue a draft to publish at its scheduled time. THIS PUBLISHES PUBLICLY once the time " +
    "arrives, to every account the post targets. Verify the content and the targets with " +
    "heropost_get_post and confirm with the user before calling this.",
  write: true,
  destructive: true,
  inputSchema: {
    postId: z.number().int().positive(),
    scheduledDate: isoDateSchema
      .optional()
      .describe("Set or change the publish time before queueing. Required if none is set yet."),
  },
  async handler(args, { client }) {
    if (args.scheduledDate) {
      await client.request<IdResult>({
        ...UPDATE_CUSTOM_POST,
        variables: {
          customPost: { customPostId: args.postId, scheduledDate: args.scheduledDate },
        },
      });
    }
    await client.request<IdResult>({
      ...SCHEDULE_CUSTOM_POST,
      variables: { customPostId: args.postId },
    });
    return jsonResult({
      scheduled: true,
      postId: args.postId,
      post: await readBack(client, args.postId),
    });
  },
});

const unschedulePost = defineTool({
  name: "heropost_unschedule_post",
  title: "Return a scheduled post to drafts",
  description:
    "Pull a scheduled post out of the queue and back into drafts, so it will not publish. " +
    "The safe way to stop something that is queued.",
  write: true,
  inputSchema: {
    postId: z.number().int().positive(),
    advancedInput: advancedInputSchema,
  },
  async handler(args, { client }) {
    await client.request<IdResult>({
      ...SET_SCHEDULED_POST_TO_DRAFT,
      variables: {
        customPost: { ...sanitizeAdvancedInput(args.advancedInput), customPostId: args.postId },
      },
    });
    return jsonResult({
      unscheduled: true,
      postId: args.postId,
      post: await readBack(client, args.postId),
    });
  },
});

const deletePost = defineTool({
  name: "heropost_delete_post",
  title: "Delete a post",
  description:
    "Permanently delete a post from Heropost. Cannot be undone. Does not retract anything " +
    "already published to a social network — for a queued post, prefer " +
    "heropost_unschedule_post unless the user wants it gone.",
  write: true,
  destructive: true,
  inputSchema: {
    postId: z.number().int().positive(),
  },
  async handler(args, { client }) {
    const data = await client.request<Record<string, unknown>>({
      ...DELETE_CUSTOM_POST,
      variables: { customPostId: args.postId },
    });
    return jsonResult({ deleted: true, postId: args.postId, result: data });
  },
});

const uploadPostMedia = defineTool({
  name: "heropost_upload_post_media",
  title: "Attach an image or video to a post",
  description:
    "Upload a local image or video and attach it to a post. Runs Heropost's three-step flow " +
    "(request a signed URL, upload the bytes, register the media). Supported: jpg, png, gif, " +
    "webp, heic, mp4, mov, m4v, webm.",
  write: true,
  inputSchema: {
    postId: z.number().int().positive(),
    filePath: z.string().min(1).describe("Absolute path to the file on this machine."),
    workspaceId: z.number().int().positive().optional(),
    social: socialSchema
      .optional()
      .describe("Reserved for per-network media; omit to attach to the whole post."),
    advancedInput: advancedInputSchema,
  },
  async handler(args, { client }) {
    const workspaceId = client.workspaceId(args.workspaceId);
    const media = await uploadLocalFile(client, { workspaceId, filePath: args.filePath });

    await client.request<IdResult>({
      ...UPLOAD_POST_MEDIA,
      variables: {
        customPost: {
          ...sanitizeAdvancedInput(args.advancedInput),
          customPostId: args.postId,
          mediaId: media.mediaId,
          url: media.url,
          mediaType: media.mediaType,
        },
      },
    });

    return jsonResult({
      attached: true,
      postId: args.postId,
      media,
      post: await readBack(client, args.postId),
    });
  },
});

export const authoringTools: AnyToolDef[] = [
  createPost,
  updatePost,
  schedulePost,
  unschedulePost,
  deletePost,
  uploadPostMedia,
];
