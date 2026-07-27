import { op } from "./types.js";

/**
 * `AccountType` describes one connected social account (a page, channel, profile…).
 *
 * Note `MainQuery.accounts` has no workspace argument and `AccountFilterInput` has no
 * workspace field, so scoping to a workspace has to go the other way round — through
 * `workspace(id) { accounts }`. Hence two documents for one tool.
 */
const ACCOUNT_FIELDS = /* GraphQL */ `
  id
  name
  userName
  social
  accountCategory
  availabilityState
  publicationState
  isPaused
  pausedReason
  isDeleted
  url
  description
  accountDetails {
    numberOfFollowers
    numberOfPosts
    engagementRate
  }
`;

export const LIST_ACCOUNTS = op({
  service: "main",
  operation: "ListAccounts",
  document: /* GraphQL */ `
    query ListAccounts($filter: AccountFilterInput, $take: Int, $skip: Int) {
      accounts(filter: $filter, take: $take, skip: $skip, sortField: "name", sortDirection: ASC) {
        totalCount
        nodes {
          ${ACCOUNT_FIELDS}
          workspace {
            id
            name
          }
        }
      }
    }
  `,
});

export const LIST_WORKSPACE_ACCOUNTS = op({
  service: "main",
  operation: "ListWorkspaceAccounts",
  document: /* GraphQL */ `
    query ListWorkspaceAccounts($workspaceId: Int!) {
      workspace(id: $workspaceId) {
        id
        name
        accounts {
          ${ACCOUNT_FIELDS}
        }
      }
    }
  `,
});

export interface AccountSummary {
  id: number;
  name: string;
  userName?: string | null;
  social?: string | null;
  accountCategory?: string | null;
  availabilityState: string;
  publicationState: string;
  isPaused: boolean;
  pausedReason?: string | null;
  isDeleted: boolean;
  url?: string | null;
  description?: string | null;
  accountDetails?: {
    numberOfFollowers?: number | null;
    numberOfPosts?: number | null;
    engagementRate?: number | null;
  } | null;
  workspace?: { id: number; name: string } | null;
}

export interface ListAccountsResult {
  accounts: { totalCount?: number | null; nodes?: (AccountSummary | null)[] | null } | null;
}

export interface ListWorkspaceAccountsResult {
  workspace: { id: number; name: string; accounts?: (AccountSummary | null)[] | null } | null;
}
