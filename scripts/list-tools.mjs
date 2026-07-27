#!/usr/bin/env node
/**
 * Start the built server over stdio and print the tools it advertises. A quick way to
 * confirm registration and, in particular, that `HEROPOST_READ_ONLY=1` withholds writes.
 *
 *   npm run build && node scripts/list-tools.mjs
 *   npm run build && node scripts/list-tools.mjs --read-only
 *
 * No real credential is needed: listing tools never calls Heropost.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const readOnly = process.argv.includes("--read-only");

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: {
    PATH: process.env.PATH ?? "",
    HEROPOST_ACCESS_TOKEN: process.env.HEROPOST_ACCESS_TOKEN ?? "placeholder-for-listing",
    ...(process.env.HEROPOST_WORKSPACE_ID
      ? { HEROPOST_WORKSPACE_ID: process.env.HEROPOST_WORKSPACE_ID }
      : {}),
    ...(readOnly ? { HEROPOST_READ_ONLY: "1" } : {}),
  },
  stderr: "pipe",
});

const client = new Client({ name: "heropost-mcp-list-tools", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`mode: ${readOnly ? "read-only" : "full"} — ${tools.length} tools\n`);

const width = Math.max(...tools.map((t) => t.name.length));
for (const t of tools) {
  const flags = [
    t.annotations?.readOnlyHint ? "read" : "WRITE",
    t.annotations?.destructiveHint ? "destructive" : "",
  ]
    .filter(Boolean)
    .join(", ");
  const args = Object.keys(t.inputSchema?.properties ?? {}).length;
  console.log(`  ${t.name.padEnd(width)}  ${args} args  [${flags}]`);
}

await client.close();
