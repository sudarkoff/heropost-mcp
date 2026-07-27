import { z } from "zod";
import { jsonResult, listResult } from "../format.js";
import {
  LIST_ACCOUNTS,
  LIST_WORKSPACE_ACCOUNTS,
  type ListAccountsResult,
  type ListWorkspaceAccountsResult,
} from "../operations/accounts.js";
import { LIST_WORKSPACES, type ListWorkspacesResult } from "../operations/workspaces.js";
import {
  defineTool,
  skipSchema,
  socialSchema,
  takeSchema,
  workspaceIdSchema,
  type AnyToolDef,
} from "./common.js";

const listWorkspaces = defineTool({
  name: "heropost_list_workspaces",
  title: "List Heropost workspaces",
  description:
    "List the Heropost workspaces you can access, with their ids and time zones. Start here: " +
    "almost every other tool needs a workspace id.",
  write: false,
  inputSchema: {
    take: takeSchema,
    skip: skipSchema,
  },
  async handler(args, { client }) {
    const data = await client.request<ListWorkspacesResult>({
      ...LIST_WORKSPACES,
      variables: { take: args.take, skip: args.skip },
    });
    return listResult(data.workspaces, { skip: args.skip, take: args.take });
  },
});

const listAccounts = defineTool({
  name: "heropost_list_accounts",
  title: "List connected social accounts",
  description:
    "List the social accounts connected to Heropost — the things a post can be sent to. " +
    "Returns each account's id, network, follower count, and whether it is paused or in a " +
    "failed state. Filter by workspace and/or network.",
  write: false,
  inputSchema: {
    workspaceId: workspaceIdSchema,
    social: socialSchema.optional().describe("Only return accounts on this network."),
    nameContains: z.string().optional().describe("Case-insensitive match on the account name."),
    take: takeSchema,
    skip: skipSchema,
  },
  async handler(args, { client }) {
    // Scoping by workspace has to go through workspace(id){accounts} — the top-level
    // `accounts` field has no workspace argument.
    if (args.workspaceId !== undefined || (!args.social && !args.nameContains)) {
      const workspaceId = client.workspaceId(args.workspaceId);
      const data = await client.request<ListWorkspaceAccountsResult>({
        ...LIST_WORKSPACE_ACCOUNTS,
        variables: { workspaceId },
      });
      let accounts = (data.workspace?.accounts ?? []).filter((a) => a !== null);
      if (args.social) accounts = accounts.filter((a) => a.social === args.social);
      if (args.nameContains) {
        const needle = args.nameContains.toLowerCase();
        accounts = accounts.filter((a) => a.name.toLowerCase().includes(needle));
      }
      return jsonResult({
        workspace: data.workspace ? { id: data.workspace.id, name: data.workspace.name } : null,
        totalCount: accounts.length,
        items: accounts,
      });
    }

    const data = await client.request<ListAccountsResult>({
      ...LIST_ACCOUNTS,
      variables: {
        filter: {
          ...(args.social ? { social: { eq: args.social } } : {}),
          ...(args.nameContains ? { name: { contains: args.nameContains } } : {}),
        },
        take: args.take,
        skip: args.skip,
      },
    });
    return listResult(data.accounts, { skip: args.skip, take: args.take });
  },
});

export const contextTools: AnyToolDef[] = [listWorkspaces, listAccounts];
