#!/usr/bin/env node
/**
 * Refresh a checked-in SDL file by introspecting a live Heropost GraphQL service.
 *
 * Heropost publishes no schema, so `schema/*.graphql` is our only contract. The
 * conformance test validates every operation document against these files, which is
 * what catches upstream drift in a private API. Re-run this when something breaks.
 *
 *   node scripts/introspect.mjs main                  # open introspection, no token needed
 *   node scripts/introspect.mjs posting --token "$HEROPOST_ACCESS_TOKEN"
 *
 * With no service argument, refreshes every service it can reach.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildClientSchema,
  getIntrospectionQuery,
  lexicographicSortSchema,
  printSchema,
} from "graphql";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Introspection is open on `main` and `login`; `posting` and `notification` require a token. */
const SERVICES = {
  main: "https://api.heropost.io/graphql",
  posting: "https://posting-api.heropost.io/graphql",
  notification: "https://notification-api.heropost.io/graphql",
  login: "https://login-api.heropost.io/graphql",
};

async function introspect(endpoint, token) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query: getIntrospectionQuery({ descriptions: true }) }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const body = await res.json();
  if (body.errors?.length) {
    const messages = body.errors.map((e) => e.message).join("; ");
    // The posting/notification services gate introspection behind auth.
    throw new Error(
      /not authorized|authenticated/i.test(messages)
        ? `${messages}\n  -> this service needs a valid token: pass --token <access token>`
        : messages,
    );
  }
  return printSchema(lexicographicSortSchema(buildClientSchema(body.data)));
}

const args = process.argv.slice(2);
const tokenIdx = args.findIndex((a) => a === "--token");
const token = tokenIdx === -1 ? process.env.HEROPOST_ACCESS_TOKEN : args[tokenIdx + 1];
const names = args.filter((a) => a in SERVICES);
const targets = names.length > 0 ? names : Object.keys(SERVICES);

let failed = 0;
for (const name of targets) {
  const out = join(ROOT, "schema", `${name}.graphql`);
  try {
    const sdl = await introspect(SERVICES[name], token);
    writeFileSync(out, sdl);
    console.log(`✓ ${name}: wrote schema/${name}.graphql (${sdl.length} bytes)`);
  } catch (err) {
    failed++;
    console.error(`✗ ${name}: ${err.message}`);
  }
}
process.exit(failed > 0 && names.length > 0 ? 1 : 0);
