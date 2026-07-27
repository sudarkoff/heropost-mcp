import { op } from "./types.js";

export const LIST_APPROVALS = op({
  service: "main",
  operation: "ListApprovals",
  document: /* GraphQL */ `
    query ListApprovals($workspaceId: Int!, $status: PostApprovalStatus) {
      teamApprovals(workspaceId: $workspaceId, status: $status) {
        id
        customPostId
        workspaceId
        status
        postTitle
        postCaption
        submittedByName
        submittedByUserId
        reviewComment
        reviewedDate
        createdDate
      }
    }
  `,
});

export const REVIEW_APPROVAL = op({
  service: "main",
  operation: "ReviewApproval",
  document: /* GraphQL */ `
    mutation ReviewApproval($review: ReviewApprovalInput!) {
      reviewPostApproval(review: $review) {
        id
        customPostId
        status
        reviewComment
        reviewedDate
      }
    }
  `,
});

export const LIST_POST_COMMENTS = op({
  service: "main",
  operation: "ListPostComments",
  document: /* GraphQL */ `
    query ListPostComments($workspaceId: Int!) {
      postComments(workspaceId: $workspaceId) {
        id
        customPostId
        workspaceId
        text
        authorName
        createdDate
      }
    }
  `,
});

export const ADD_POST_COMMENT = op({
  service: "main",
  operation: "AddPostComment",
  document: /* GraphQL */ `
    mutation AddPostComment($comment: CreatePostCommentInput!) {
      addPostComment(comment: $comment) {
        id
        customPostId
        text
        authorName
        createdDate
      }
    }
  `,
});

export interface ApprovalRow {
  id: number;
  customPostId: number;
  workspaceId: number;
  status?: string | null;
  postTitle?: string | null;
  postCaption?: string | null;
  submittedByName?: string | null;
  reviewComment?: string | null;
  reviewedDate?: string | null;
  createdDate: string;
}

export interface ListApprovalsResult {
  teamApprovals?: (ApprovalRow | null)[] | null;
}

export interface ReviewApprovalResult {
  reviewPostApproval: {
    id: number;
    customPostId: number;
    status?: string | null;
    reviewComment?: string | null;
    reviewedDate?: string | null;
  } | null;
}

export interface PostCommentRow {
  id: number;
  customPostId: number;
  workspaceId?: number;
  text: string;
  authorName?: string | null;
  createdDate: string;
}

export interface ListPostCommentsResult {
  postComments?: (PostCommentRow | null)[] | null;
}

export interface AddPostCommentResult {
  addPostComment: PostCommentRow | null;
}
