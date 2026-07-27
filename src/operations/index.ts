import type { OperationDef } from "./types.js";
import * as accounts from "./accounts.js";
import * as analytics from "./analytics.js";
import * as approvals from "./approvals.js";
import * as inbox from "./inbox.js";
import * as posting from "./posting.js";
import * as posts from "./posts.js";
import * as workspaces from "./workspaces.js";

export * from "./types.js";
export { accounts, analytics, approvals, inbox, posting, posts, workspaces };

function isOperationDef(value: unknown): value is OperationDef {
  return (
    typeof value === "object" &&
    value !== null &&
    "service" in value &&
    "operation" in value &&
    "document" in value &&
    typeof (value as OperationDef).document === "string"
  );
}

/**
 * Every operation the server can issue, collected by reflection over the modules above.
 * The conformance test walks this list and validates each document against the checked-in
 * SDL — so a new operation is covered the moment it's exported, with nothing to remember.
 */
export const ALL_OPERATIONS: readonly OperationDef[] = Object.freeze(
  [accounts, analytics, approvals, inbox, posting, posts, workspaces].flatMap((mod) =>
    Object.values(mod).filter(isOperationDef),
  ),
);
