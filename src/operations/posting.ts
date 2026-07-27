import { op } from "./types.js";

/**
 * Operations on the `posting` service, validated against `schema/posting.graphql`.
 *
 * These were originally reconstructed from the minified web bundle, because the posting
 * service requires a token even to introspect. Once a token was available the real SDL was
 * checked in — and it corrected two things worth remembering, since both produced documents
 * that validated cleanly while still being wrong at runtime:
 *
 *  - `CreateCustomPostInput` is only `{workspaceId, options: {mode!, allOption, …}}`. It has
 *    **no text or title field** — content arrives via `updateCustomPost` — and `mode` is
 *    required.
 *  - `UploadPostMediaInput` requires `index`, which orders media on the post.
 *
 * Mutations here still select only `{ id }`, with reads going through `GetPost` on the `main`
 * service. That was a hedge while the schema was unknown; it stays because it keeps these
 * documents stable against response-shape changes in a private API.
 *
 * See docs/api-notes.md.
 */

export const CREATE_CUSTOM_POST = op({
  service: "posting",
  operation: "CreateCustomPost",
  document: /* GraphQL */ `
    mutation CreateCustomPost($customPost: CreateCustomPostInput!) {
      createCustomPost(customPost: $customPost) {
        id
      }
    }
  `,
});

export const UPDATE_CUSTOM_POST = op({
  service: "posting",
  operation: "UpdateCustomPost",
  document: /* GraphQL */ `
    mutation UpdateCustomPost($customPost: UpdateCustomPostInput!) {
      updateCustomPost(customPost: $customPost) {
        id
      }
    }
  `,
});

/** Targets a set of networks; the app calls this right after creating a post. */
export const SELECT_SOCIAL_NETWORKS = op({
  service: "posting",
  operation: "SelectSocialNetworks",
  document: /* GraphQL */ `
    mutation SelectSocialNetworks($customPost: SelectSocialNetworksInput!) {
      selectSocialNetworks(customPost: $customPost) {
        id
      }
    }
  `,
});

export const SELECT_ACCOUNTS_FOR_CUSTOM_POST = op({
  service: "posting",
  operation: "SelectAccountsForCustomPost",
  document: /* GraphQL */ `
    mutation SelectAccountsForCustomPost($customPost: SelectAccountsForCustomPostInput!) {
      selectAccountsForCustomPost(customPost: $customPost) {
        id
      }
    }
  `,
});

/** Moves a draft into the queue. Requires `scheduledDate` to already be set. */
export const SCHEDULE_CUSTOM_POST = op({
  service: "posting",
  operation: "ScheduleCustomPost",
  document: /* GraphQL */ `
    mutation ScheduleCustomPost($customPostId: Int!) {
      scheduleCustomPost(customPostId: $customPostId) {
        id
      }
    }
  `,
});

export const SET_SCHEDULED_POST_TO_DRAFT = op({
  service: "posting",
  operation: "SetScheduledPostToDraft",
  document: /* GraphQL */ `
    mutation SetScheduledPostToDraft($customPost: SetScheduledPostToDraftInput!) {
      setScheduledPostToDraft(customPost: $customPost) {
        id
      }
    }
  `,
});

export const DELETE_CUSTOM_POST = op({
  service: "posting",
  operation: "DeleteCustomPost",
  document: /* GraphQL */ `
    mutation DeleteCustomPost($customPostId: Int!) {
      deleteCustomPost(customPostId: $customPostId)
    }
  `,
});

/**
 * Step 1 of the media flow: ask for a presigned URL. `fetchPolicy: network-only` in the
 * app, because these URLs are single-use and time-limited.
 */
export const PRESIGNED_MEDIA_UPLOAD_URL = op({
  service: "posting",
  operation: "PreSignedMediaUploadUrl",
  document: /* GraphQL */ `
    query PreSignedMediaUploadUrl($media: GetPreSignedMediaUploadUrlInput!) {
      preSignedMediaUploadUrl(media: $media) {
        url
      }
    }
  `,
});

/** Step 3: register the uploaded object in the media library. */
export const UPLOAD_MEDIA = op({
  service: "posting",
  operation: "UploadMedia",
  document: /* GraphQL */ `
    mutation UploadMedia($media: UploadMediaInput!) {
      uploadMedia(media: $media) {
        id
        url
        mediaType
      }
    }
  `,
});

/** Step 4: attach a registered media object to a post. */
export const UPLOAD_POST_MEDIA = op({
  service: "posting",
  operation: "UploadPostMedia",
  document: /* GraphQL */ `
    mutation UploadPostMedia($customPost: UploadPostMediaInput!) {
      uploadPostMedia(customPost: $customPost) {
        id
      }
    }
  `,
});

export interface IdResult {
  [field: string]: { id: number } | null;
}

export interface PreSignedMediaUploadUrlResult {
  preSignedMediaUploadUrl: { url: string } | null;
}

export interface UploadMediaResult {
  uploadMedia: { id: number; url?: string | null; mediaType?: string | null } | null;
}
