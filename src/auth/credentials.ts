import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { HeropostAuthError } from "../errors.js";

/**
 * On-disk credential store.
 *
 * This exists because OpenIddict **rotates refresh tokens**: each renewal returns a new one
 * and invalidates the old. Keeping the rotation only in memory would work until the next
 * restart, at which point the stored token would already be spent and sign-in would be
 * required again — which is exactly the babysitting this is meant to end. So every rotation is
 * written back here.
 */

export const DEFAULT_CREDENTIALS_PATH = join(
  homedir(),
  ".config",
  "heropost",
  "credentials.json",
);

export interface StoredCredentials {
  refreshToken?: string;
  accessToken?: string;
  /** Epoch millis. Advisory only — the API decides whether a token is still good. */
  expiresAt?: number;
  scope?: string;
  obtainedAt?: number;
}

/** Synchronous variant, so provider selection can stay a plain function. */
export function readCredentialsSync(path: string): StoredCredentials | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new HeropostAuthError(
      `Cannot read the Heropost credentials file at ${path}: ${String(err)}`,
    );
  }
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    throw new HeropostAuthError(
      `The Heropost credentials file at ${path} is not valid JSON. Delete it and run ` +
        `\`heropost-mcp auth\` again.`,
    );
  }
}

export async function readCredentials(path: string): Promise<StoredCredentials | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new HeropostAuthError(`Cannot read the Heropost credentials file at ${path}: ${String(err)}`);
  }
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    throw new HeropostAuthError(
      `The Heropost credentials file at ${path} is not valid JSON. Delete it and run ` +
        `\`heropost-mcp auth\` again.`,
    );
  }
}

/**
 * Write atomically and 0600. Atomic because a torn write here would lose the only refresh
 * token; 0600 because the contents are equivalent to a password.
 */
export async function writeCredentials(
  path: string,
  credentials: StoredCredentials,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

/** Merge an update in without dropping fields the caller didn't mention. */
export async function updateCredentials(
  path: string,
  patch: StoredCredentials,
): Promise<StoredCredentials> {
  const existing = (await readCredentials(path).catch(() => undefined)) ?? {};
  const merged = { ...existing, ...patch };
  await writeCredentials(path, merged);
  return merged;
}
