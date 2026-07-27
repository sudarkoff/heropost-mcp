import { op } from "./types.js";

export const GET_POST_ANALYTICS = op({
  service: "main",
  operation: "GetPostAnalytics",
  document: /* GraphQL */ `
    query GetPostAnalytics($filter: GetPostAnalyticsInput) {
      postAnalytics(filter: $filter) {
        date
        customPostId
        title
        reach
        views
        reactions
        comments
        shares
      }
    }
  `,
});

export const GET_POST_ANALYTICS_RAW = op({
  service: "main",
  operation: "GetPostAnalyticsRaw",
  document: /* GraphQL */ `
    query GetPostAnalyticsRaw($filter: GetPostAnalyticsRawInput) {
      postAnalyticsRaw(filter: $filter) {
        customPostId
        title
        social
        accountId
        accountName
        workspaceId
        workspaceName
        postedDate
        localPostedDate
        reach
        views
        reactions
        comments
        shares
      }
    }
  `,
});

export const GET_ACCOUNT_SNAPSHOTS = op({
  service: "main",
  operation: "GetAccountSnapshots",
  document: /* GraphQL */ `
    query GetAccountSnapshots($filter: GetAccountSnapshotsInput!) {
      accountSnapshots(filter: $filter) {
        accountId
        social
        date
        followers
      }
    }
  `,
});

export interface PostAnalyticsRow {
  date: string;
  customPostId?: number | null;
  title?: string | null;
  reach?: number | null;
  views?: number | null;
  reactions?: number | null;
  comments?: number | null;
  shares?: number | null;
}

export interface GetPostAnalyticsResult {
  postAnalytics?: (PostAnalyticsRow | null)[] | null;
}

export interface PostAnalyticsRawRow extends PostAnalyticsRow {
  social: string;
  accountId: number;
  accountName: string;
  workspaceId: number;
  workspaceName: string;
  postedDate: string;
  localPostedDate: string;
}

export interface GetPostAnalyticsRawResult {
  postAnalyticsRaw?: (PostAnalyticsRawRow | null)[] | null;
}

export interface AccountSnapshotRow {
  accountId: number;
  social: string;
  date: string;
  followers?: number | null;
}

export interface GetAccountSnapshotsResult {
  accountSnapshots?: (AccountSnapshotRow | null)[] | null;
}
