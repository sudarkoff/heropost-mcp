/**
 * Heropost's GraphQL responses are wide and mostly null — a CustomPost carries dozens of
 * fields a caller rarely needs. Trimming them keeps tool output readable and cheap.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Recursively drop nulls, undefined, empty objects, and empty arrays. */
export function prune<T>(value: T): Json {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((v) => v !== null);
    return items as Json[];
  }
  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const pruned = prune(v);
      if (pruned === null) continue;
      if (Array.isArray(pruned) && pruned.length === 0) continue;
      if (
        typeof pruned === "object" &&
        !Array.isArray(pruned) &&
        Object.keys(pruned).length === 0
      ) {
        continue;
      }
      out[k] = pruned;
    }
    return out;
  }
  return value as Json;
}

export interface ToolTextResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function jsonResult(data: unknown): ToolTextResult {
  return { content: [{ type: "text", text: JSON.stringify(prune(data), null, 2) }] };
}

export function textResult(text: string): ToolTextResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): ToolTextResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Heropost paginates with `{nodes, totalCount}`. Surface both, plus an explicit hint when
 * more rows exist, so an agent knows to page rather than assuming it saw everything.
 */
export function listResult<T>(
  list: { nodes?: (T | null)[] | null; totalCount?: number | null } | null | undefined,
  page: { skip: number; take: number },
): ToolTextResult {
  const items = (list?.nodes ?? []).filter((n): n is T => n !== null);
  const totalCount = list?.totalCount ?? items.length;
  const shownThrough = page.skip + items.length;
  return jsonResult({
    totalCount,
    returned: items.length,
    ...(shownThrough < totalCount
      ? { moreAvailable: true, nextSkip: shownThrough }
      : {}),
    items,
  });
}
