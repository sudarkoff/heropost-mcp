import { op } from "./types.js";

export const LIST_WORKSPACES = op({
  service: "main",
  operation: "ListWorkspaces",
  document: /* GraphQL */ `
    query ListWorkspaces($take: Int, $skip: Int) {
      workspaces(take: $take, skip: $skip, sortField: "name", sortDirection: ASC) {
        totalCount
        nodes {
          id
          name
          notes
          timeZone
          isCurrent
          approvalPolicy
          createdDate
        }
      }
    }
  `,
});

export interface WorkspaceSummary {
  id: number;
  name: string;
  notes?: string | null;
  timeZone?: string | null;
  isCurrent?: boolean | null;
  approvalPolicy?: string | null;
  createdDate: string;
}

export interface ListWorkspacesResult {
  workspaces: { totalCount?: number | null; nodes?: (WorkspaceSummary | null)[] | null } | null;
}
