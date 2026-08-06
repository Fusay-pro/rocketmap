import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Encryption at rest for user-supplied provider API keys.
 *
 * These keys are stored in Appwrite user prefs, which the Appwrite API key can
 * read in bulk. Holding them in plaintext meant any read of the prefs store — a
 * console session, a backup, an over-broad server key, a support export —
 * yielded live third-party credentials that bill to the user. Encrypting means
 * that reading the store is not by itself enough to use them.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt rather
 * than silently yielding garbage that we'd then send to the provider.
 *
 * Format: `v1.<iv>.<authTag>.<ciphertext>`, each part base64url. The version
 * prefix is what lets a value written before this existed be recognised as
 * legacy plaintext and migrated on next write instead of throwing.
 */

const VERSION = "v1";
const IV_BYTES = 12; // GCM standard
const KEY_BYTES = 32; // AES-256

export class MissingEncryptionSecretError extends Error {
  constructor() {
    super(
      "AI_KEY_ENCRYPTION_SECRET is not set. Generate one with " +
        "`openssl rand -base64 32` and add it to .env.local before saving provider keys.",
    );
    this.name = "MissingEncryptionSecretError";
  }
}

function derivedKey(): Buffer {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new MissingEncryptionSecretError();
  }
  // HKDF with a fixed info label: binds the derived key to this purpose, so the
  // same secret used elsewhere wouldn't produce an interchangeable key.
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), "rocketmap:ai-api-key:v1", KEY_BYTES),
  );
}

export function hasEncryptionSecret(): boolean {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET;
  return Boolean(secret && secret.trim().length > 0);
}

/** True if the stored value is in the encrypted envelope format. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}.`) && value.split(".").length === 4;
}

export function encryptApiKey(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt a stored value.
 *
 * Values written before encryption existed are returned as-is so that existing
 * users keep working; callers use {@link isEncrypted} to decide whether to
 * re-write them. Returns null when a ciphertext fails authentication — a wrong
 * or rotated secret — rather than throwing, so one bad row can't break an
 * unrelated AI request.
 */
export function decryptApiKey(stored: string): string | null {
  if (!isEncrypted(stored)) {
    return stored; // legacy plaintext
  }

  const [, ivPart, tagPart, dataPart] = stored.split(".");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      derivedKey(),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    console.error(
      "[ai-key] stored key failed to decrypt — AI_KEY_ENCRYPTION_SECRET may have changed",
    );
    return null;
  }
}

/** Constant-time compare, for tests and any future key-rotation checks. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
