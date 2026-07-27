import { z } from "zod";
import { jsonResult } from "../format.js";
import {
  ADD_POST_COMMENT,
  LIST_APPROVALS,
  LIST_POST_COMMENTS,
  REVIEW_APPROVAL,
  type AddPostCommentResult,
  type ListApprovalsResult,
  type ListPostCommentsResult,
  type ReviewApprovalResult,
} from "../operations/approvals.js";
import { defineTool, workspaceIdSchema, type AnyToolDef } from "./common.js";

const listApprovals = defineTool({
  name: "heropost_list_approvals",
  title: "List posts awaiting approval",
  description:
    "List post-approval requests in a workspace — who submitted what, and whether it is still " +
    "pending. Use status=PENDING to see the review queue.",
  write: false,
  inputSchema: {
    workspaceId: workspaceIdSchema,
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  },
  async handler(args, { client }) {
    const workspaceId = client.workspaceId(args.workspaceId);
    const data = await client.request<ListApprovalsResult>({
      ...LIST_APPROVALS,
      variables: { workspaceId, ...(args.status ? { status: args.status } : {}) },
    });
    const rows = (data.teamApprovals ?? []).filter((r) => r !== null);
    return jsonResult({ workspaceId, totalCount: rows.length, items: rows });
  },
});

const reviewApproval = defineTool({
  name: "heropost_review_approval",
  title: "Approve or reject a post",
  description:
    "Approve or reject a post that was submitted for approval. Approving clears the post to " +
    "publish on its schedule, so treat this as consequential: check the post with " +
    "heropost_get_post first and confirm the decision with the user.",
  write: true,
  destructive: true,
  inputSchema: {
    approvalId: z
      .number()
      .int()
      .positive()
      .describe("The approval id from heropost_list_approvals (not the post id)."),
    approved: z.boolean().describe("true approves, false rejects."),
    comment: z.string().optional().describe("Review note shown to the submitter."),
  },
  async handler(args, { client }) {
    const data = await client.request<ReviewApprovalResult>({
      ...REVIEW_APPROVAL,
      variables: {
        review: {
          approvalId: args.approvalId,
          approved: args.approved,
          ...(args.comment ? { comment: args.comment } : {}),
        },
      },
    });
    return jsonResult({
      decision: args.approved ? "APPROVED" : "REJECTED",
      approval: data.reviewPostApproval,
    });
  },
});

const listPostComments = defineTool({
  name: "heropost_list_post_comments",
  title: "List internal post comments",
  description:
    "Internal team comments on posts in a workspace. These are private collaboration notes " +
    "inside Heropost, not comments from a social network — for those use the inbox tools.",
  write: false,
  inputSchema: {
    workspaceId: workspaceIdSchema,
    postId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Filter to a single post; Heropost returns the whole workspace otherwise."),
  },
  async handler(args, { client }) {
    const workspaceId = client.workspaceId(args.workspaceId);
    const data = await client.request<ListPostCommentsResult>({
      ...LIST_POST_COMMENTS,
      variables: { workspaceId },
    });
    let rows = (data.postComments ?? []).filter((r) => r !== null);
    // The API has no per-post filter, so narrow client-side.
    if (args.postId !== undefined) rows = rows.filter((r) => r.customPostId === args.postId);
    return jsonResult({ workspaceId, totalCount: rows.length, items: rows });
  },
});

const addPostComment = defineTool({
  name: "heropost_add_post_comment",
  title: "Comment on a post internally",
  description:
    "Add an internal team comment to a post. Private to the Heropost workspace — nothing is " +
    "published to any social network.",
  write: true,
  inputSchema: {
    postId: z.number().int().positive(),
    text: z.string().min(1),
  },
  async handler(args, { client }) {
    const data = await client.request<AddPostCommentResult>({
      ...ADD_POST_COMMENT,
      variables: { comment: { customPostId: args.postId, text: args.text } },
    });
    return jsonResult({ added: true, comment: data.addPostComment });
  },
});

export const collaborationTools: AnyToolDef[] = [
  listApprovals,
  reviewApproval,
  listPostComments,
  addPostComment,
];
