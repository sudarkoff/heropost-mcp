import { z } from "zod";
import { jsonResult } from "../format.js";
import {
  GET_ACCOUNT_SNAPSHOTS,
  GET_POST_ANALYTICS,
  GET_POST_ANALYTICS_RAW,
  type GetAccountSnapshotsResult,
  type GetPostAnalyticsRawResult,
  type GetPostAnalyticsResult,
} from "../operations/analytics.js";
import {
  defineTool,
  isoDateSchema,
  socialSchema,
  timeZoneSchema,
  workspaceIdSchema,
  type AnyToolDef,
} from "./common.js";

const accountIdsSchema = z
  .array(z.number().int().positive())
  .optional()
  .describe("Restrict to these account ids (from heropost_list_accounts).");

const socialsSchema = z
  .array(socialSchema)
  .optional()
  .describe("Restrict to these networks.");

const getPostAnalytics = defineTool({
  name: "heropost_get_post_analytics",
  title: "Get aggregated post analytics",
  description:
    "Engagement totals (reach, views, reactions, comments, shares) over a date range, bucketed " +
    "by day, hour, month, year, or post. Use groupBy=POST to compare individual posts, or " +
    "groupBy=DAILY to see a trend.",
  write: false,
  inputSchema: {
    from: isoDateSchema.describe("Start of the range, inclusive."),
    to: isoDateSchema.describe("End of the range, inclusive."),
    groupBy: z.enum(["DAILY", "HOURLY", "MONTHLY", "YEARLY", "POST"]).default("DAILY"),
    workspaceId: workspaceIdSchema,
    accountIds: accountIdsSchema,
    socials: socialsSchema,
    timeZone: timeZoneSchema,
  },
  async handler(args, { client }) {
    const workspaceId = client.workspaceId(args.workspaceId);
    const data = await client.request<GetPostAnalyticsResult>({
      ...GET_POST_ANALYTICS,
      variables: {
        filter: {
          from: args.from,
          to: args.to,
          timeZone: args.timeZone,
          groupBy: args.groupBy,
          workspaceIds: [workspaceId],
          ...(args.accountIds ? { accountIds: args.accountIds } : {}),
          ...(args.socials ? { socials: args.socials } : {}),
        },
      },
    });
    const rows = (data.postAnalytics ?? []).filter((r) => r !== null);
    return jsonResult({
      range: { from: args.from, to: args.to, timeZone: args.timeZone },
      groupBy: args.groupBy,
      totalCount: rows.length,
      items: rows,
    });
  },
});

const getPostAnalyticsRaw = defineTool({
  name: "heropost_get_post_analytics_raw",
  title: "Get per-post, per-account analytics",
  description:
    "One row per post per account, with the network, account name, posted date, and engagement " +
    "metrics. Use this to rank actual posts — which one performed best on which network — " +
    "rather than a time-bucketed aggregate.",
  write: false,
  inputSchema: {
    from: isoDateSchema,
    to: isoDateSchema,
    workspaceId: workspaceIdSchema,
    accountIds: accountIdsSchema,
    socials: socialsSchema,
    timeZone: timeZoneSchema,
  },
  async handler(args, { client }) {
    const workspaceId = client.workspaceId(args.workspaceId);
    const data = await client.request<GetPostAnalyticsRawResult>({
      ...GET_POST_ANALYTICS_RAW,
      variables: {
        filter: {
          from: args.from,
          to: args.to,
          timeZone: args.timeZone,
          workspaceIds: [workspaceId],
          ...(args.accountIds ? { accountIds: args.accountIds } : {}),
          ...(args.socials ? { socials: args.socials } : {}),
        },
      },
    });
    const rows = (data.postAnalyticsRaw ?? []).filter((r) => r !== null);
    return jsonResult({
      range: { from: args.from, to: args.to, timeZone: args.timeZone },
      totalCount: rows.length,
      items: rows,
    });
  },
});

const getAccountSnapshots = defineTool({
  name: "heropost_get_account_snapshots",
  title: "Get follower history",
  description:
    "Follower counts per account over time — the audience-growth series behind the Insights " +
    "page. Note this ignores workspace: pass accountIds or socials to narrow it.",
  write: false,
  inputSchema: {
    from: isoDateSchema,
    to: isoDateSchema,
    accountIds: accountIdsSchema,
    socials: socialsSchema,
  },
  async handler(args, { client }) {
    const data = await client.request<GetAccountSnapshotsResult>({
      ...GET_ACCOUNT_SNAPSHOTS,
      variables: {
        filter: {
          from: args.from,
          to: args.to,
          ...(args.accountIds ? { accountIds: args.accountIds } : {}),
          ...(args.socials ? { socials: args.socials } : {}),
        },
      },
    });
    const rows = (data.accountSnapshots ?? []).filter((r) => r !== null);
    return jsonResult({
      range: { from: args.from, to: args.to },
      totalCount: rows.length,
      items: rows,
    });
  },
});

export const analyticsTools: AnyToolDef[] = [
  getPostAnalytics,
  getPostAnalyticsRaw,
  getAccountSnapshots,
];
