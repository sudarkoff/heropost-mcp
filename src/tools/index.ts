import { analyticsTools } from "./analytics.js";
import { authoringTools } from "./authoring.js";
import { collaborationTools } from "./collaboration.js";
import { contextTools } from "./context.js";
import { inboxTools } from "./inbox.js";
import { postTools } from "./posts.js";
import type { AnyToolDef } from "./common.js";

export * from "./common.js";

/** Every tool the server knows how to expose, in a sensible discovery order. */
export const ALL_TOOLS: readonly AnyToolDef[] = Object.freeze([
  ...contextTools,
  ...postTools,
  ...authoringTools,
  ...analyticsTools,
  ...inboxTools,
  ...collaborationTools,
]);

/**
 * Tools to actually register. In read-only mode the write tools are not merely refused at
 * call time — they are never advertised, so a model cannot decide to try one.
 */
export function selectTools(options: { readOnly: boolean }): AnyToolDef[] {
  return ALL_TOOLS.filter((tool) => !(options.readOnly && tool.write));
}
