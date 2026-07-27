import type { ServiceName } from "../config.js";

export interface OperationDef {
  service: ServiceName;
  /** Must match the operation name inside `document` — the conformance test checks this. */
  operation: string;
  document: string;
}

/** Identity helper that keeps literal types while enforcing the shape. */
export function op<const T extends OperationDef>(def: T): T {
  return def;
}
