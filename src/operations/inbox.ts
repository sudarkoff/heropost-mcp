import { op } from "./types.js";

/** Threads are comments, DMs, and mentions across the connected accounts. */
const THREAD_SUMMARY_FIELDS = /* GraphQL */ `
  id
  threadType
  workspaceId
  accountId
  accountName
  socialId
  participantName
  participantPlatformId
  isRead
  isDone
  isBookmarked
  unreadCount
  lastActivityAt
  postCaption
  postPermalink
`;

export const LIST_INBOX_THREADS = op({
  service: "main",
  operation: "ListInboxThreads",
  document: /* GraphQL */ `
    query ListInboxThreads(
      $workspaceId: Int
      $filter: InboxThreadFilterInput
      $take: Int
      $skip: Int
    ) {
      inboxThreads(
        workspaceId: $workspaceId
        filter: $filter
        take: $take
        skip: $skip
        sortField: "lastActivityAt"
        sortDirection: DESC
      ) {
        totalCount
        nodes {
          ${THREAD_SUMMARY_FIELDS}
        }
      }
    }
  `,
});

export const GET_INBOX_THREAD = op({
  service: "main",
  operation: "GetInboxThread",
  document: /* GraphQL */ `
    query GetInboxThread($threadId: Int!) {
      inboxThread(threadId: $threadId) {
        ${THREAD_SUMMARY_FIELDS}
        createdDate
        platformThreadId
        postPlatformId
        postThumbnailUrl
        participantAvatarUrl
        messages {
          id
          text
          authorName
          authorPlatformId
          isFromMe
          mediaUrl
          platformTimestamp
          createdDate
        }
      }
    }
  `,
});

export const REPLY_TO_INBOX_THREAD = op({
  service: "main",
  operation: "ReplyToInboxThread",
  document: /* GraphQL */ `
    mutation ReplyToInboxThread($input: ReplyToInboxThreadInput!) {
      replyToInboxThread(input: $input) {
        id
        inboxThreadId
        text
        isFromMe
        createdDate
      }
    }
  `,
});

export const MARK_INBOX_THREAD_READ = op({
  service: "main",
  operation: "MarkInboxThreadRead",
  document: /* GraphQL */ `
    mutation MarkInboxThreadRead($threadId: Int!) {
      markInboxThreadRead(threadId: $threadId)
    }
  `,
});

export const MARK_INBOX_THREAD_DONE = op({
  service: "main",
  operation: "MarkInboxThreadDone",
  document: /* GraphQL */ `
    mutation MarkInboxThreadDone($threadId: Int!) {
      markInboxThreadDone(threadId: $threadId)
    }
  `,
});

export const TOGGLE_INBOX_BOOKMARK = op({
  service: "main",
  operation: "ToggleInboxBookmark",
  document: /* GraphQL */ `
    mutation ToggleInboxBookmark($threadId: Int!) {
      toggleInboxBookmark(threadId: $threadId)
    }
  `,
});

export interface InboxThreadSummary {
  id: number;
  threadType: string;
  workspaceId: number;
  accountId: number;
  accountName?: string | null;
  participantName?: string | null;
  isRead: boolean;
  isDone: boolean;
  isBookmarked: boolean;
  unreadCount: number;
  lastActivityAt: string;
}

export interface ListInboxThreadsResult {
  inboxThreads: {
    totalCount?: number | null;
    nodes?: (InboxThreadSummary | null)[] | null;
  } | null;
}

export interface GetInboxThreadResult {
  inboxThread: (InboxThreadSummary & { messages?: unknown[] | null }) | null;
}

export interface ReplyToInboxThreadResult {
  replyToInboxThread: {
    id: number;
    inboxThreadId: number;
    text?: string | null;
    isFromMe: boolean;
    createdDate: string;
  } | null;
}
