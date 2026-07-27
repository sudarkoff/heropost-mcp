import { op } from "./types.js";

/**
 * ⚠️ PROVISIONAL — the posting service gates introspection behind auth.
 *
 * Every document below was lifted verbatim from the Heropost web bundle, so the operation
 * names, argument names, and argument *types* are accurate. What is NOT yet verified is
 * the field-level shape of the input objects (`CreateCustomPostInput` and friends), which
 * was reconstructed from minified call sites and is certainly missing optional and
 * per-network fields.
 *
 * Two deliberate consequences:
 *
 *  1. Mutations here select only `{ id }`. Reading a post back goes through the
 *     schema-verified `GetPost` on the `main` service instead. That keeps the unverified
 *     surface as small as it can be, so a wrong guess about a *response* field can't
 *     break a write that already succeeded.
 *  2. `npm run introspect -- posting --token <token>` writes `schema/posting.graphql`,
 *     after which the conformance test validates all of this automatically. Until then
 *     the test reports these as unverified rather than silently passing.
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
