import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema, parse, validate, type GraphQLSchema, type OperationDefinitionNode } from "graphql";
import { describe, expect, it } from "vitest";
import { ALL_OPERATIONS } from "../src/operations/index.js";
import type { ServiceName } from "../src/config.js";

/**
 * Heropost publishes no schema and no docs, so the checked-in SDL is the only contract we
 * have. Validating every operation against it offline is what turns a silent upstream
 * change into a failing test — no network and no credentials required.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaCache = new Map<string, GraphQLSchema | null>();

function schemaFor(service: ServiceName): GraphQLSchema | null {
  if (!schemaCache.has(service)) {
    const path = join(ROOT, "schema", `${service}.graphql`);
    schemaCache.set(service, existsSync(path) ? buildSchema(readFileSync(path, "utf8")) : null);
  }
  return schemaCache.get(service) ?? null;
}

describe("operation documents", () => {
  it("has operations to check", () => {
    expect(ALL_OPERATIONS.length).toBeGreaterThan(0);
  });

  // Syntax and naming are checkable without a schema, so even the services whose
  // introspection is auth-gated get this much coverage.
  for (const op of ALL_OPERATIONS) {
    it(`${op.service}/${op.operation} parses and is named consistently`, () => {
      const doc = parse(op.document);
      const definitions = doc.definitions.filter(
        (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
      );
      expect(definitions).toHaveLength(1);
      expect(definitions[0]?.name?.value).toBe(op.operation);
    });
  }

  it("has no duplicate operation names within a service", () => {
    const seen = new Map<string, string[]>();
    for (const op of ALL_OPERATIONS) {
      const key = `${op.service}/${op.operation}`;
      seen.set(key, [...(seen.get(key) ?? []), op.operation]);
    }
    const duplicates = [...seen.entries()].filter(([, v]) => v.length > 1).map(([k]) => k);
    expect(duplicates).toEqual([]);
  });
});

describe("schema conformance", () => {
  for (const op of ALL_OPERATIONS) {
    const schema = schemaFor(op.service);
    const title = `${op.service}/${op.operation} validates against schema/${op.service}.graphql`;

    if (!schema) {
      // Deliberately visible as a skip rather than a pass: this operation is unverified
      // because that service gates introspection behind auth.
      it.skip(`${title} — SDL not checked in; run: npm run introspect -- ${op.service} --token <token>`, () => {});
      continue;
    }

    it(title, () => {
      const errors = validate(schema, parse(op.document));
      expect(
        errors.map((e) => e.message),
        `${op.operation} does not match the checked-in ${op.service} schema`,
      ).toEqual([]);
    });
  }
});
