import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProtectedFieldError, sanitizeAdvancedInput } from "../src/tools/common.js";
import { resolveMediaPath, uploadLocalFile } from "../src/media.js";
import { HeropostTransportError } from "../src/errors.js";
import { ALL_TOOLS } from "../src/tools/index.js";
import { harness } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function tool(name: string) {
  const found = ALL_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`No such tool: ${name}`);
  return found;
}

/**
 * `advancedInput` exists to supply fields we haven't modeled. It must not be usable to
 * retarget a write or to make something publish — otherwise a prompt injection could defeat
 * the guarantees the tool descriptions make.
 */
describe("sanitizeAdvancedInput", () => {
  it("passes through fields that are genuinely unmodeled", () => {
    expect(sanitizeAdvancedInput({ postType: "IMAGE", location: "Portland" })).toEqual({
      postType: "IMAGE",
      location: "Portland",
    });
  });

  it("treats no input as an empty object", () => {
    expect(sanitizeAdvancedInput(undefined)).toEqual({});
  });

  it.each([
    "workspaceId",
    "customPostId",
    "customPostItemId",
    "accountIds",
    "postStatus",
    "status",
    "mediaId",
  ])("rejects the protected field %s", (key) => {
    expect(() => sanitizeAdvancedInput({ [key]: 1 })).toThrow(ProtectedFieldError);
  });

  it("rejects protected fields whatever the casing", () => {
    expect(() => sanitizeAdvancedInput({ WORKSPACEID: 9 })).toThrow(ProtectedFieldError);
    expect(() => sanitizeAdvancedInput({ CustomPostId: 9 })).toThrow(ProtectedFieldError);
  });

  it("rejects anything that looks like it triggers publication", () => {
    for (const key of ["publish", "publishNow", "shouldPublish", "postNow", "sendNow"]) {
      expect(() => sanitizeAdvancedInput({ [key]: true }), key).toThrow(ProtectedFieldError);
    }
  });

  it("names the offending fields so the caller can correct the call", () => {
    expect(() => sanitizeAdvancedInput({ workspaceId: 2, publishNow: true })).toThrow(
      /workspaceId, publishNow/,
    );
  });
});

describe("advancedInput cannot subvert a write", () => {
  it("cannot retarget create_post to another workspace", async () => {
    const h = harness();
    await expect(
      tool("heropost_create_post").handler(
        { text: "hi", accountIds: [1], advancedInput: { workspaceId: 999 } },
        { client: h.client },
      ),
    ).rejects.toThrow(ProtectedFieldError);
    // Rejected before any request left the process.
    expect(h.calls).toHaveLength(0);
  });

  it("cannot smuggle a publish flag into create_post", async () => {
    const h = harness();
    await expect(
      tool("heropost_create_post").handler(
        { text: "hi", accountIds: [1], advancedInput: { publishImmediately: true } },
        { client: h.client },
      ),
    ).rejects.toThrow(ProtectedFieldError);
    expect(h.calls).toHaveLength(0);
  });

  it("cannot override the vetted text, even with an allowed key", async () => {
    const h = harness();
    h.reply({ data: { createCustomPost: { id: 1 } } });
    h.reply({ data: { selectAccountsForCustomPost: { id: 1 } } });
    h.reply({ data: { updateCustomPost: { id: 1 } } });
    h.reply({ data: { customPosts: { totalCount: 1, nodes: [{ id: 1 }] } } });

    await tool("heropost_create_post").handler(
      { text: "the approved copy", accountIds: [1], advancedInput: { text: "hijacked" } },
      { client: h.client },
    );

    const sent = (h.calls[0]!.body as { variables: { customPost: { text: string } } }).variables
      .customPost;
    expect(sent.text).toBe("the approved copy");
  });

  it("cannot retarget update_post to a different post", async () => {
    const h = harness();
    await expect(
      tool("heropost_update_post").handler(
        { postId: 5, text: "x", advancedInput: { customPostId: 6 } },
        { client: h.client },
      ),
    ).rejects.toThrow(ProtectedFieldError);
    expect(h.calls).toHaveLength(0);
  });

  it("still treats advancedInput alone as a real update", async () => {
    const h = harness();
    h.reply({ data: { updateCustomPost: { id: 5 } } });
    h.reply({ data: { customPosts: { totalCount: 1, nodes: [{ id: 5 }] } } });

    await tool("heropost_update_post").handler(
      { postId: 5, advancedInput: { location: "Portland" } },
      { client: h.client },
    );

    expect(
      (h.calls[0]!.body as { variables: { customPost: Record<string, unknown> } }).variables
        .customPost,
    ).toEqual({ location: "Portland", customPostId: 5 });
  });
});

/**
 * Uploaded bytes go to a third party and can end up on a public timeline, so an unrestricted
 * file path is an exfiltration route for anything image-shaped on disk.
 */
describe("media path confinement", () => {
  async function fixture(): Promise<{ root: string; inside: string; outside: string }> {
    const base = await mkdtemp(join(tmpdir(), "heropost-confine-"));
    const root = join(base, "allowed");
    const other = join(base, "secrets");
    await mkdtemp(root).catch(() => undefined);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(root, { recursive: true });
    await mkdir(other, { recursive: true });
    const inside = join(root, "ok.png");
    const outside = join(other, "private.png");
    await writeFile(inside, "bytes");
    await writeFile(outside, "bytes");
    return { root, inside, outside };
  }

  it("allows a file inside the root", async () => {
    const { root, inside } = await fixture();
    await expect(resolveMediaPath(inside, root)).resolves.toContain("ok.png");
  });

  it("refuses a file outside the root", async () => {
    const { root, outside } = await fixture();
    await expect(resolveMediaPath(outside, root)).rejects.toThrow(/outside HEROPOST_MEDIA_ROOT/);
  });

  it("refuses traversal out of the root", async () => {
    const { root } = await fixture();
    await expect(resolveMediaPath(join(root, "..", "secrets", "private.png"), root)).rejects.toThrow(
      /outside HEROPOST_MEDIA_ROOT/,
    );
  });

  it("refuses a symlink inside the root that points outside it", async () => {
    // Resolving symlinks before the check is the whole point: a link is otherwise a trivial
    // bypass of a path-prefix test.
    const { root, outside } = await fixture();
    const link = join(root, "innocent.png");
    await symlink(outside, link);
    await expect(resolveMediaPath(link, root)).rejects.toThrow(/outside HEROPOST_MEDIA_ROOT/);
  });

  it("allows any path when no root is configured", async () => {
    const { outside } = await fixture();
    await expect(resolveMediaPath(outside, undefined)).resolves.toContain("private.png");
  });

  it("reports a missing file clearly", async () => {
    await expect(resolveMediaPath("/nope/missing.png", undefined)).rejects.toThrow(
      HeropostTransportError,
    );
  });

  it("does not read or upload a confined-out file", async () => {
    const { root, outside } = await fixture();
    const h = harness({ HEROPOST_MEDIA_ROOT: root });
    await expect(
      uploadLocalFile(h.client, { workspaceId: 7, filePath: outside }),
    ).rejects.toThrow(/outside HEROPOST_MEDIA_ROOT/);
    expect(h.calls).toHaveLength(0);
  });
});
