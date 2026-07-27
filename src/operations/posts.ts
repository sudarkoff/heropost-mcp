import { op } from "./types.js";

/**
 * A "custom post" is Heropost's unit of composition: shared text and media, plus one
 * `postItem` per social network that can override the text and target specific accounts.
 * Reads live on the `main` service; writes live on `posting` (see operations/posting.ts).
 */

/** Enough to render a calendar row without pulling every per-network variant. */
const POST_SUMMARY_FIELDS = /* GraphQL */ `
  id
  number
  title
  text
  postStatus
  scheduledDate
  postedDate
  updatedDate
  workspaceId
  url
  hasPostingFailure
  userShouldAcceptPostingError
`;

export const LIST_POSTS = op({
  service: "main",
  operation: "ListPosts",
  document: /* GraphQL */ `
    query ListPosts(
      $filter: CustomPostFilterInput
      $take: Int
      $skip: Int
      $sortField: String
      $sortDirection: SortDirectionEnum
    ) {
      customPosts(
        filter: $filter
        take: $take
        skip: $skip
        sortField: $sortField
        sortDirection: $sortDirection
      ) {
        totalCount
        nodes {
          ${POST_SUMMARY_FIELDS}
          postItems {
            id
            social
            enabled
            publishingStatus
            accounts {
              id
              name
              social
            }
          }
          media {
            id
            mediaType
            url
            thumbUrl
            index
          }
        }
      }
    }
  `,
});

/**
 * Full detail for one post. There is no `customPost(id:)` field on `main`, so we filter
 * the list by id — which is what the web app does too.
 */
export const GET_POST = op({
  service: "main",
  operation: "GetPost",
  document: /* GraphQL */ `
    query GetPost($filter: CustomPostFilterInput) {
      customPosts(filter: $filter, take: 1) {
        totalCount
        nodes {
          ${POST_SUMMARY_FIELDS}
          firstComment
          showAllTab
          linkInfo {
            url
            title
            description
            imageUrl
          }
          media {
            id
            mediaType
            url
            previewUrl
            thumbnailUrl
            thumbUrl
            index
            name
            width
            height
            duration
            fileSize
            isExpired
          }
          postItems {
            id
            social
            text
            text2
            firstComment
            location
            kind
            url
            enabled
            useCommonProperties
            publishingStatus
            updatedDate
            extraProperties
            accounts {
              id
              name
              userName
              social
              accountCategory
              publicationState
              availabilityState
              exceptionMessage
              exceptionCode
              linkToPost
            }
            media {
              id
              mediaType
              url
              thumbUrl
              index
              name
            }
            linkInfo {
              url
              title
              description
              imageUrl
            }
          }
        }
      }
    }
  `,
});

export const DUPLICATE_POST = op({
  service: "main",
  operation: "DuplicatePost",
  document: /* GraphQL */ `
    mutation DuplicatePost($customPost: DuplicateCustomPostInput!) {
      duplicateCustomPost(customPost: $customPost) {
        id
        number
        title
        postStatus
        scheduledDate
        workspaceId
      }
    }
  `,
});

export interface PostSummary {
  id: number;
  number: number;
  title?: string | null;
  text?: string | null;
  postStatus: string;
  scheduledDate?: string | null;
  postedDate?: string | null;
  updatedDate: string;
  workspaceId: number;
  url?: string | null;
  hasPostingFailure: boolean;
  userShouldAcceptPostingError: boolean;
  postItems?: unknown[] | null;
  media?: unknown[] | null;
}

export interface ListPostsResult {
  customPosts: { totalCount?: number | null; nodes?: (PostSummary | null)[] | null } | null;
}

export interface DuplicatePostResult {
  duplicateCustomPost: {
    id: number;
    number: number;
    title?: string | null;
    postStatus: string;
    scheduledDate?: string | null;
    workspaceId: number;
  } | null;
}
