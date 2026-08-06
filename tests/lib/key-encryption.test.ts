import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  encryptApiKey,
  decryptApiKey,
  isEncrypted,
  hasEncryptionSecret,
  MissingEncryptionSecretError,
} from "@/lib/ai/key-encryption";

const SECRET = "test-secret-do-not-use-in-production-0000";
const PLAINTEXT = "sk-abcdef0123456789abcdef0123456789";

describe("key-encryption", () => {
  beforeEach(() => {
    process.env.AI_KEY_ENCRYPTION_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.AI_KEY_ENCRYPTION_SECRET;
    vi.restoreAllMocks();
  });

  it("round-trips a key", () => {
    expect(decryptApiKey(encryptApiKey(PLAINTEXT))).toBe(PLAINTEXT);
  });

  it("produces a versioned envelope, not the raw key", () => {
    const stored = encryptApiKey(PLAINTEXT);
    expect(stored).not.toContain(PLAINTEXT);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(isEncrypted(stored)).toBe(true);
  });

  it("uses a fresh IV so the same key encrypts differently each time", () => {
    // Otherwise identical keys would be linkable across users.
    expect(encryptApiKey(PLAINTEXT)).not.toBe(encryptApiKey(PLAINTEXT));
  });

  it("passes legacy plaintext through unchanged", () => {
    expect(isEncrypted(PLAINTEXT)).toBe(false);
    expect(decryptApiKey(PLAINTEXT)).toBe(PLAINTEXT);
  });

  it("returns null when the secret has changed, instead of garbage", () => {
    const stored = encryptApiKey(PLAINTEXT);
    process.env.AI_KEY_ENCRYPTION_SECRET = "a-completely-different-secret-value-11";
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(decryptApiKey(stored)).toBeNull();
  });

  it("rejects a tampered ciphertext rather than decrypting it", () => {
    const stored = encryptApiKey(PLAINTEXT);
    const parts = stored.split(".");
    // Flip a bit in the decoded bytes, not a base64 character. The trailing
    // character of a base64url string can carry unused bits, so several
    // characters decode to the same bytes — editing text sometimes left the
    // ciphertext unchanged and the value decrypted correctly.
    const raw = Buffer.from(parts[3], "base64url");
    raw[0] ^= 0xff;
    parts[3] = raw.toString("base64url");

    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(decryptApiKey(parts.join("."))).toBeNull();
  });

  it("rejects a tampered auth tag", () => {
    const stored = encryptApiKey(PLAINTEXT);
    const parts = stored.split(".");
    const tag = Buffer.from(parts[2], "base64url");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64url");

    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(decryptApiKey(parts.join("."))).toBeNull();
  });

  it("refuses to encrypt with no secret configured", () => {
    delete process.env.AI_KEY_ENCRYPTION_SECRET;
    expect(hasEncryptionSecret()).toBe(false);
    expect(() => encryptApiKey(PLAINTEXT)).toThrow(MissingEncryptionSecretError);
  });
});
