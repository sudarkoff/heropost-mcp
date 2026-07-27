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

/**
 * Fields `advancedInput` must never set. The escape hatch exists to supply fields we haven't
 * modeled — not to rewrite the ones that decide *which* record is touched or *whether it
 * publishes*. Without this, a prompt-injected `advancedInput` could retarget a write to
 * another workspace or flip a draft into something that goes out, which would quietly defeat
 * the guarantees the tool descriptions make.
 */
const PROTECTED_INPUT_KEYS = [
  "workspaceid",
  "custompostid",
  "custompostitemid",
  "accountids",
  "accountid",
  "poststatus",
  "status",
  "mediaid",
] as const;

/** Anything that looks like it triggers publication, whatever it ends up being called. */
const PUBLISH_LIKE = /publish|postnow|sendnow/i;

export class ProtectedFieldError extends Error {
  override readonly name = "ProtectedFieldError";
}

/**
 * Validate an `advancedInput` payload. Rejects loudly rather than dropping keys silently, so
 * a caller learns the field is off-limits instead of wondering why it had no effect.
 */
export function sanitizeAdvancedInput(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!input) return {};
  const rejected = Object.keys(input).filter(
    (key) =>
      (PROTECTED_INPUT_KEYS as readonly string[]).includes(key.toLowerCase()) ||
      PUBLISH_LIKE.test(key),
  );
  if (rejected.length > 0) {
    throw new ProtectedFieldError(
      `advancedInput may not set ${rejected.join(", ")}. These fields determine which record ` +
        `is modified and whether it publishes, so they are only settable through the tool's ` +
        `own documented arguments.`,
    );
  }
  return { ...input };
}

/** Build a Heropost DateFilterInput from an optional from/to pair. */
export function dateRangeFilter(
  from?: string,
  to?: string,
): { ge?: string; le?: string } | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { ge: from } : {}), ...(to ? { le: to } : {}) };
}
