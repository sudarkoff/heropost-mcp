import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentTypeFor, mediaTypeFor, uploadLocalFile } from "../src/media.js";
import { HeropostTransportError } from "../src/errors.js";
import { harness, type CapturedCall } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function tempFile(name: string, contents = "fake-bytes"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "heropost-media-"));
  const path = join(dir, name);
  await writeFile(path, contents);
  return path;
}

describe("contentTypeFor", () => {
  it.each([
    ["photo.jpg", "image/jpeg"],
    ["photo.JPEG", "image/jpeg"],
    ["art.png", "image/png"],
    ["loop.gif", "image/gif"],
    ["clip.mp4", "video/mp4"],
    ["clip.mov", "video/quicktime"],
  ])("maps %s to %s", (name, expected) => {
    expect(contentTypeFor(name)).toBe(expected);
  });

  it("refuses an unsupported type with a message listing what works", () => {
    expect(() => contentTypeFor("notes.pdf")).toThrow(HeropostTransportError);
    expect(() => contentTypeFor("notes.pdf")).toThrow(/\.mp4/);
  });

  it("refuses a file with no extension", () => {
    expect(() => contentTypeFor("README")).toThrow(HeropostTransportError);
  });
});

describe("mediaTypeFor", () => {
  it("classifies images and videos", () => {
    expect(mediaTypeFor("image/png")).toBe("PHOTO");
    expect(mediaTypeFor("video/mp4")).toBe("VIDEO");
  });
});

describe("uploadLocalFile", () => {
  it("runs sign -> PUT -> register, and strips the signature from the stored URL", async () => {
    const h = harness();
    const signedUrl =
      "https://heropost-images.s3.eu-west-1.amazonaws.com/uploads/abc.png?X-Amz-Signature=deadbeef&X-Amz-Expires=900";

    h.reply({ data: { preSignedMediaUploadUrl: { url: signedUrl } } });
    // The PUT to storage.
    h.reply({});
    h.reply({
      data: {
        uploadMedia: {
          id: 555,
          url: "https://heropost-images.s3.eu-west-1.amazonaws.com/uploads/abc.png",
          mediaType: "PHOTO",
        },
      },
    });

    const path = await tempFile("abc.png");
    const media = await uploadLocalFile(h.client, { workspaceId: 7, filePath: path });

    expect(media).toMatchObject({ mediaId: 555, mediaType: "PHOTO", fileName: "abc.png" });
    expect(h.calls).toHaveLength(3);

    const [sign, put, register] = h.calls as [CapturedCall, CapturedCall, CapturedCall];

    expect(sign.url).toBe("https://posting-api.heropost.io/graphql");
    expect(sign.body).toMatchObject({
      variables: { media: { fileName: "abc.png", contentType: "image/png" } },
    });

    // The bytes go straight to storage with the right content type and, critically, no
    // Authorization header — the presigned signature is the credential.
    expect(put.url).toBe(signedUrl);
    expect(put.method).toBe("PUT");
    expect(put.headers["content-type"]).toBe("image/png");
    expect(put.headers.authorization).toBeUndefined();

    // Registration receives the durable URL, with the signing query string removed.
    const registerBody = register.body as { variables: { media: { url: string } } };
    expect(registerBody.variables.media.url).toBe(
      "https://heropost-images.s3.eu-west-1.amazonaws.com/uploads/abc.png",
    );
    expect(registerBody.variables.media.url).not.toContain("X-Amz-Signature");
    expect(registerBody.variables.media).toMatchObject({
      workspaceId: 7,
      mediaType: "PHOTO",
      fileName: "abc.png",
    });
  });

  it("fails clearly when no signed URL comes back", async () => {
    const h = harness();
    h.reply({ data: { preSignedMediaUploadUrl: null } });

    const path = await tempFile("x.png");
    await expect(
      uploadLocalFile(h.client, { workspaceId: 7, filePath: path }),
    ).rejects.toThrow(/did not return an upload URL/);
  });

  it("surfaces a storage rejection with its status", async () => {
    const h = harness();
    h.reply({ data: { preSignedMediaUploadUrl: { url: "https://storage.test/put?sig=1" } } });
    h.reply(null, { status: 403, raw: "SignatureDoesNotMatch" });

    const path = await tempFile("y.png");
    await expect(
      uploadLocalFile(h.client, { workspaceId: 7, filePath: path }),
    ).rejects.toThrow(/HTTP 403/);
  });

  it("does not attempt an upload for an unsupported file type", async () => {
    const h = harness();
    const path = await tempFile("doc.pdf");
    await expect(
      uploadLocalFile(h.client, { workspaceId: 7, filePath: path }),
    ).rejects.toThrow(HeropostTransportError);
    expect(h.calls).toHaveLength(0);
  });
});
