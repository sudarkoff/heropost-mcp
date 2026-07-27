import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { HeropostClient } from "./client.js";
import { HeropostTransportError } from "./errors.js";
import {
  PRESIGNED_MEDIA_UPLOAD_URL,
  UPLOAD_MEDIA,
  type PreSignedMediaUploadUrlResult,
  type UploadMediaResult,
} from "./operations/posting.js";

/**
 * Heropost uploads media by presigned PUT, not GraphQL multipart:
 *
 *   1. `preSignedMediaUploadUrl({fileName, contentType})` -> a signed, single-use URL
 *   2. `PUT <url>` with the raw bytes and a matching Content-Type, and **no auth header**
 *      (the signature is the credential — sending a Bearer token can invalidate it)
 *   3. `uploadMedia({workspaceId, url, ...})` to register the stored object
 *
 * Step 2's URL is stripped of its query string before step 3, because the signature is
 * only needed for the write; the durable object URL is origin + path.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
};

export function contentTypeFor(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  const mime = MIME_BY_EXTENSION[ext];
  if (!mime) {
    throw new HeropostTransportError(
      `Unsupported media type "${ext || fileName}". Heropost accepts images ` +
        `(${Object.keys(MIME_BY_EXTENSION).filter((e) => MIME_BY_EXTENSION[e]?.startsWith("image")).join(", ")}) ` +
        `and videos (.mp4, .mov, .m4v, .webm).`,
    );
  }
  return mime;
}

export function mediaTypeFor(contentType: string): "PHOTO" | "VIDEO" {
  return contentType.startsWith("video/") ? "VIDEO" : "PHOTO";
}

export interface UploadedMedia {
  mediaId: number;
  url: string;
  mediaType: "PHOTO" | "VIDEO";
  fileName: string;
}

/** Steps 1–3 for a local file. Returns the registered media, ready to attach to a post. */
export async function uploadLocalFile(
  client: HeropostClient,
  args: { workspaceId: number; filePath: string; timeoutMs?: number },
): Promise<UploadedMedia> {
  const fileName = basename(args.filePath);
  const contentType = contentTypeFor(fileName);
  const bytes = await readFile(args.filePath);

  const signed = await client.request<PreSignedMediaUploadUrlResult>({
    ...PRESIGNED_MEDIA_UPLOAD_URL,
    variables: { media: { fileName, contentType } },
  });
  const signedUrl = signed.preSignedMediaUploadUrl?.url;
  if (!signedUrl) {
    throw new HeropostTransportError(
      `Heropost did not return an upload URL for ${fileName}.`,
    );
  }

  await putBytes(signedUrl, bytes, contentType, args.timeoutMs ?? 120_000);

  const parsed = new URL(signedUrl);
  const storedUrl = `${parsed.origin}${parsed.pathname}`;
  const mediaType = mediaTypeFor(contentType);

  const registered = await client.request<UploadMediaResult>({
    ...UPLOAD_MEDIA,
    variables: {
      media: {
        workspaceId: args.workspaceId,
        url: storedUrl,
        mediaType,
        fileName,
        source: "DIRECT_UPLOAD",
        purpose: "POSTING",
        isInLibrary: true,
        throwIfDuplicate: false,
      },
    },
  });

  const media = registered.uploadMedia;
  if (!media?.id) {
    throw new HeropostTransportError(`Heropost did not register the upload for ${fileName}.`);
  }
  return { mediaId: media.id, url: media.url ?? storedUrl, mediaType, fileName };
}

async function putBytes(
  url: string,
  bytes: Uint8Array,
  contentType: string,
  timeoutMs: number,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      // Deliberately no Authorization header — the presigned signature is the credential.
      headers: { "content-type": contentType },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new HeropostTransportError(
      `Uploading media to storage failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new HeropostTransportError(
      `Storage rejected the media upload (HTTP ${res.status}). ${detail}`,
    );
  }
}
