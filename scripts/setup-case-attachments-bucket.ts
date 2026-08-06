/**
 * Create the storage bucket backing Investment Case attachments (spec §4.4).
 *
 * `case_quotes.attachmentFileId` and `case_demand_tests.evidenceFileId` hold
 * ids of files in this bucket. Publish is gated on the primary quote having an
 * attachment, so without this bucket a case can never leave draft.
 *
 * Usage:
 *   node --env-file=.env.local scripts/setup-case-attachments-bucket.ts
 *
 * Idempotent: a 409 (already exists) is reported and skipped.
 */
import { Client, Storage, Compression } from "node-appwrite";

const BUCKET_ID = "case_attachments";

/** Keep in sync with MAX_UPLOAD_BYTES in the attachments route. */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

async function main() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);
  const storage = new Storage(client);

  try {
    await storage.createBucket({
      bucketId: BUCKET_ID,
      name: "Investment Case Attachments",
      // Server-only, same reasoning as the tables: uploads and downloads both
      // go through API routes holding an API key, and those routes verify the
      // file belongs to a case the caller owns. Any client-facing grant here
      // would let one signed-in user fetch another's supplier quotes by id.
      permissions: [],
      // fileSecurity would let per-file permissions widen access beyond the
      // bucket's. With no bucket grants and no per-file grants set at upload,
      // leaving it off keeps "API key only" the single rule.
      fileSecurity: false,
      enabled: true,
      maximumFileSize: MAX_FILE_SIZE,
      allowedFileExtensions: ["pdf", "png", "jpg", "jpeg", "webp", "csv", "xlsx", "docx"],
      compression: Compression.None,
      encryption: true,
      antivirus: true,
    });
    console.log(`Created bucket: ${BUCKET_ID}`);
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && (e as { code?: number }).code === 409) {
      console.log(`Bucket "${BUCKET_ID}" already exists — skipping.`);
    } else {
      throw e;
    }
  }

  const bucket = await storage.getBucket({ bucketId: BUCKET_ID });
  console.log(
    `\n${bucket.$id}: max ${Math.round((bucket.maximumFileSize ?? 0) / 1024 / 1024)}MB, ` +
      `${(bucket.$permissions ?? []).length} client permission(s), ` +
      `extensions: ${(bucket.allowedFileExtensions ?? []).join(", ") || "any"}`,
  );
  if ((bucket.$permissions ?? []).length > 0) {
    console.warn("WARNING: bucket has client-facing permissions; expected none.");
  }
}

main().catch((e) => {
  console.error("\nFailed:", e);
  process.exit(1);
});
