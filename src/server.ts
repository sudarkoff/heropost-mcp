import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HeropostClient } from "./client.js";
import { createTokenProvider } from "./auth/provider.js";
import { loadConfig, type Config } from "./config.js";
import { errorResult } from "./format.js";
import { toMessage } from "./errors.js";
import { selectTools } from "./tools/index.js";

export const SERVER_NAME = "heropost-mcp";
export const SERVER_VERSION = "0.1.0";

export interface BuiltServer {
  server: McpServer;
  config: Config;
  toolNames: string[];
}

export function buildServer(env: NodeJS.ProcessEnv = process.env): BuiltServer {
  const config = loadConfig(env);
  const client = new HeropostClient(config, createTokenProvider(config));
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const tools = selectTools({ readOnly: config.readOnly });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: !tool.write,
          destructiveHint: tool.destructive ?? false,
          // Everything here touches a live third-party service.
          openWorldHint: true,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: any) => {
        try {
          return await tool.handler(args, { client });
        } catch (err) {
          // Surface failures as tool errors rather than transport faults, so the model can
          // read the message and correct itself instead of the call just vanishing.
          return errorResult(toMessage(err));
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
  }

  return { server, config, toolNames: tools.map((t) => t.name) };
}
