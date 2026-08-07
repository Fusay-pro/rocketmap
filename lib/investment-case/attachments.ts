/**
 * Attachment access rules for the Investment Case module (spec §4.4).
 *
 * The bucket has no client-facing permissions, so every byte flows through an
 * API route. Two independent things must hold before a file is served:
 *
 *  1. The file is referenced by a row of the case (`findAttachmentSlot`).
 *  2. The blob itself was uploaded *for that case* (`isOwnedByCase`).
 *
 * Check 1 alone is not an ownership proof, and treating it as one was a real
 * vulnerability: `attachmentFileId` and `evidenceFileId` used to be writable
 * straight from the client, so anyone who learned another user's file id could
 * PATCH it onto a quote in their own case and then read or delete the file
 * through the case they legitimately owned. Linking is now server-only, and
 * check 2 exists so that a future edit re-opening a write path cannot silently
 * restore the bypass.
 */
import { serverStorage, CASE_ATTACHMENTS_BUCKET_ID } from "@/lib/appwrite";
import { listQuotesForCase, getDemandTestForCase } from "./db";

export interface AttachmentSlot {
  kind: "quote" | "demand-test";
  /** Row that holds the reference — the quote's `$id`, or the demand test's. */
  rowId: string;
  /** Column on that row holding the file id. */
  field: "attachmentFileId" | "evidenceFileId";
}

/** Separates the owning case id from the original filename in a stored blob's name. */
const OWNER_SEPARATOR = "__";

/**
 * Name a blob so it carries its owning case, server-side and unforgeable by a
 * client (the name is built here, never taken from the upload).
 */
export function buildStoredFilename(caseId: string, originalName: string): string {
  return `${caseId}${OWNER_SEPARATOR}${safeFilename(originalName)}`;
}

/**
 * Whether a stored blob was uploaded for this case.
 *
 * Independent of the reference fields, so it still holds if a row is edited to
 * point somewhere it shouldn't.
 */
export function isOwnedByCase(storedName: string, caseId: string): boolean {
  return storedName.startsWith(`${caseId}${OWNER_SEPARATOR}`);
}

/** Recover the display name, dropping the owner prefix. */
export function displayFilename(storedName: string): string {
  const at = storedName.indexOf(OWNER_SEPARATOR);
  return at === -1 ? storedName : storedName.slice(at + OWNER_SEPARATOR.length);
}

/**
 * Find which row of `caseId` references `fileId`, or null if none does.
 *
 * Necessary but NOT sufficient for access — pair it with `isOwnedByCase`.
 */
export async function findAttachmentSlot(
  caseId: string,
  fileId: string,
): Promise<AttachmentSlot | null> {
  const quotes = await listQuotesForCase(caseId);
  const quote = quotes.find((q) => q.attachmentFileId === fileId);
  if (quote) {
    return { kind: "quote", rowId: quote.$id, field: "attachmentFileId" };
  }

  const demandTest = await getDemandTestForCase(caseId);
  if (demandTest && demandTest.evidenceFileId === fileId) {
    return { kind: "demand-test", rowId: demandTest.$id, field: "evidenceFileId" };
  }

  return null;
}

/**
 * Whether a referenced blob is actually present AND belongs to this case.
 *
 * A reference is only a string in a row; it can outlive the file it names.
 * Anything that treats "the field is set" as "the evidence exists" — the
 * publish gate especially — needs this, or a case can be published on an
 * attachment that 404s the moment anyone opens it.
 */
export async function attachmentIsUsable(
  fileId: string | null | undefined,
  caseId: string,
): Promise<boolean> {
  if (!fileId || !isValidFileId(fileId)) return false;
  try {
    const metadata = await serverStorage.getFile({
      bucketId: CASE_ATTACHMENTS_BUCKET_ID,
      fileId,
    });
    return isOwnedByCase(metadata.name, caseId);
  } catch {
    return false;
  }
}

/**
 * Delete a blob, but only if it was uploaded for this case.
 *
 * Every cleanup path must go through here rather than calling `deleteFile`
 * directly. A reference is not proof of ownership — that is the whole lesson of
 * the earlier bypass — so a row pointing at a foreign blob (left by a stale
 * record or a manual console edit) would otherwise let a routine cleanup
 * destroy another case's file. Refusing is always safe: the cost of skipping is
 * an orphan, the cost of deleting is someone else's evidence.
 *
 * Best-effort by design. Callers use this for tidying after the authoritative
 * row change has already happened, so a storage failure must not fail their
 * request.
 */
export async function deleteBlobIfOwnedByCase(
  fileId: string | null | undefined,
  caseId: string,
): Promise<void> {
  if (!fileId) return;

  try {
    const metadata = await serverStorage.getFile({
      bucketId: CASE_ATTACHMENTS_BUCKET_ID,
      fileId,
    });
    if (!isOwnedByCase(metadata.name, caseId)) {
      console.warn(
        `[case-attachments] refused to delete ${fileId}: referenced by case ${caseId} but uploaded for another`,
      );
      return;
    }
    await serverStorage.deleteFile({ bucketId: CASE_ATTACHMENTS_BUCKET_ID, fileId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[case-attachments] blob ${fileId} not deleted: ${message}`);
  }
}

/**
 * File ids are echoed into response headers and error messages. Appwrite's own
 * ids are alphanumeric plus `._-`, so anything else is a caller error — and
 * rejecting early keeps unvalidated input out of header values.
 */
export function isValidFileId(fileId: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/.test(fileId);
}

/**
 * Build a `Content-Disposition` filename.
 *
 * Allowlist rather than denylist: a quote or backslash would break out of the
 * header's quoted-string and a control character would break the header frame,
 * and it is easier to be sure about what's permitted than to enumerate every
 * byte that isn't. Also strips the owner separator so a crafted upload name
 * cannot fake an owner prefix.
 */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9. -]/g, "-").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "attachment";
}
