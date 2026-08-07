/**
 * Create — or reconcile — the storage bucket backing Investment Case
 * attachments (spec §4.4).
 *
 * `case_quotes.attachmentFileId` and `case_demand_tests.evidenceFileId` hold
 * ids of files in this bucket. Publish is gated on the primary quote having an
 * attachment, so without this bucket a case can never leave draft.
 *
 * This script does NOT stop at "already exists". A bucket created by hand, by
 * an older version of this script, or by another environment can carry
 * `Role.users()` grants or `fileSecurity: true`, either of which lets a signed-in
 * user pull another user's supplier quotes straight from Appwrite Storage,
 * bypassing the attachment routes entirely — the routes are the only thing that
 * checks the file belongs to a case you own. Reporting that and exiting 0 would
 * leave the hole open with a clean-looking run, so a drifted bucket is a
 * non-zero exit unless you fix it.
 *
 * Usage:
 *   # create if missing; report drift on an existing bucket (default)
 *   node --env-file=.env.local scripts/setup-case-attachments-bucket.ts
 *
 *   # additionally correct a drifted bucket
 *   CONFIRM_BUCKET=case_attachments node --env-file=.env.local scripts/setup-case-attachments-bucket.ts --apply
 *
 * Idempotent: a bucket already matching the desired config is reported and left
 * alone.
 */
import { Client, Storage, Compression, type Models } from "node-appwrite";

const BUCKET_ID = "case_attachments";
const APPLY = process.argv.includes("--apply");

/** Keep in sync with MAX_UPLOAD_BYTES in the attachments route. */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "csv", "xlsx", "docx"];

/**
 * The security-relevant settings. Cosmetics (name, compression) are not checked
 * — drift there is harmless and flagging it would train people to ignore output.
 */
const DESIRED = {
  name: "Investment Case Attachments",
  // Server-only, same reasoning as the tables: uploads and downloads both go
  // through API routes holding an API key, and those routes verify the file
  // belongs to a case the caller owns.
  permissions: [] as string[],
  // fileSecurity would let per-file permissions widen access beyond the
  // bucket's. With no bucket grants and no per-file grants set at upload,
  // leaving it off keeps "API key only" the single rule.
  fileSecurity: false,
  enabled: true,
  maximumFileSize: MAX_FILE_SIZE,
  allowedFileExtensions: ALLOWED_EXTENSIONS,
  encryption: true,
  antivirus: true,
};

function driftOf(bucket: Models.Bucket): string[] {
  const drift: string[] = [];
  const perms = bucket.$permissions ?? [];
  if (perms.length > 0) {
    drift.push(`permissions: ${perms.join(", ")} (want none — client-reachable storage)`);
  }
  if (bucket.fileSecurity) {
    drift.push("fileSecurity: true (want false — per-file grants can widen access)");
  }
  if (!bucket.enabled) drift.push("enabled: false (want true)");
  if (bucket.encryption === false) drift.push("encryption: false (want true)");
  if (bucket.antivirus === false) drift.push("antivirus: false (want true)");
  if ((bucket.maximumFileSize ?? 0) > MAX_FILE_SIZE) {
    drift.push(`maximumFileSize: ${bucket.maximumFileSize} (want <= ${MAX_FILE_SIZE})`);
  }
  const ext = bucket.allowedFileExtensions ?? [];
  if (ext.length === 0) {
    drift.push("allowedFileExtensions: any (want the explicit allowlist)");
  } else {
    const extra = ext.filter((e) => !ALLOWED_EXTENSIONS.includes(e));
    if (extra.length > 0) drift.push(`allowedFileExtensions includes ${extra.join(", ")}`);
  }
  return drift;
}

function describe(bucket: Models.Bucket): void {
  console.log(
    `\n${bucket.$id}: ${(bucket.$permissions ?? []).length} client permission(s), ` +
      `fileSecurity=${bucket.fileSecurity}, encryption=${bucket.encryption}, ` +
      `antivirus=${bucket.antivirus}, max ${Math.round((bucket.maximumFileSize ?? 0) / 1024 / 1024)}MB, ` +
      `ext: ${(bucket.allowedFileExtensions ?? []).join(", ") || "any"}`,
  );
}

async function main() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!);
  const storage = new Storage(client);

  console.log(`Bucket: ${BUCKET_ID}`);
  console.log(APPLY ? "Mode: APPLY (will correct drift)" : "Mode: CHECK (no writes)");

  let created = false;
  try {
    await storage.createBucket({
      bucketId: BUCKET_ID,
      ...DESIRED,
      compression: Compression.None,
    });
    created = true;
    console.log(`\nCreated bucket: ${BUCKET_ID}`);
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && (e as { code?: number }).code === 409) {
      console.log("\nBucket already exists — checking its configuration.");
    } else {
      throw e;
    }
  }

  let bucket = await storage.getBucket({ bucketId: BUCKET_ID });
  let drift = driftOf(bucket);

  if (drift.length === 0) {
    describe(bucket);
    console.log(created ? "\nCreated and verified." : "\nAlready correct — nothing to do.");
    return;
  }

  console.log("\nDrift from the desired configuration:");
  for (const d of drift) console.log(`  - ${d}`);

  if (!APPLY) {
    describe(bucket);
    console.log(
      `\nTo correct it:\n  CONFIRM_BUCKET=${BUCKET_ID} node --env-file=.env.local ` +
        `scripts/setup-case-attachments-bucket.ts --apply`,
    );
    // Non-zero so this fails a setup pipeline instead of passing with a warning.
    process.exitCode = 1;
    return;
  }

  if (process.env.CONFIRM_BUCKET !== BUCKET_ID) {
    throw new Error(
      `Refusing to modify "${BUCKET_ID}". Re-run with CONFIRM_BUCKET="${BUCKET_ID}" to confirm.`,
    );
  }

  await storage.updateBucket({ bucketId: BUCKET_ID, ...DESIRED, compression: Compression.None });

  // Read back rather than trusting the write.
  bucket = await storage.getBucket({ bucketId: BUCKET_ID });
  drift = driftOf(bucket);
  describe(bucket);
  if (drift.length > 0) {
    throw new Error(`Still drifted after update: ${drift.join("; ")}`);
  }
  console.log("\nCorrected and verified.");
}

main().catch((e) => {
  console.error("\nFailed:", e);
  process.exit(1);
});
