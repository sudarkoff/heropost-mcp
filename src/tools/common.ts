import { z } from "zod";
import type { HeropostClient } from "../client.js";
import type { ToolTextResult } from "../format.js";

export interface ToolContext {
  client: HeropostClient;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  /** Write tools mutate Heropost state and are omitted entirely when read-only. */
  write: boolean;
  /** Set for tools whose effect cannot be undone, so clients can warn. */
  destructive?: boolean;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<ToolTextResult>;
}

/** Preserves the input-shape type through to the handler's `args`. */
export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDef = ToolDef<any>;

export const SOCIAL_NETWORKS = [
  "FACEBOOK",
  "INSTAGRAM",
  "X",
  "LINKED_IN",
  "PINTEREST",
  "YOU_TUBE",
  "TWITCH",
  "GOOGLE_MY_BUSINESS",
  "REDDIT",
  "TUMBLR",
  "TELEGRAM",
  "TIK_TOK",
  "THREADS",
  "BLUESKY",
] as const;

export const POST_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "IN_PROGRESS",
  "POSTED",
  "PENDING_APPROVAL",
] as const;

export const socialSchema = z.enum(SOCIAL_NETWORKS);
export const postStatusSchema = z.enum(POST_STATUSES);

export const workspaceIdSchema = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    "Workspace id. Defaults to HEROPOST_WORKSPACE_ID when set; use heropost_list_workspaces to find ids.",
  );

export const takeSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(25)
  .describe("Maximum rows to return (1-100).");

export const skipSchema = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe("Rows to skip, for paging through results.");

/**
 * Heropost's analytics inputs require an IANA time zone, and results shift with it, so
 * make it explicit rather than silently assuming the host's zone.
 */
export const timeZoneSchema = z
  .string()
  .default("UTC")
  .describe('IANA time zone for bucketing dates, e.g. "America/Los_Angeles". Defaults to UTC.');

/** Accepts a date or a full timestamp; Heropost's DateTime scalar takes ISO-8601. */
export const isoDateSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    "Expected an ISO-8601 date (2026-07-26) or timestamp (2026-07-26T09:00:00Z).",
  );

/** Build a Heropost DateFilterInput from an optional from/to pair. */
export function dateRangeFilter(
  from?: string,
  to?: string,
): { ge?: string; le?: string } | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { ge: from } : {}), ...(to ? { le: to } : {}) };
}
