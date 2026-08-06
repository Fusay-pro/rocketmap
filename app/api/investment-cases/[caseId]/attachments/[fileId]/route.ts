import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/appwrite-server";
import {
  serverStorage,
  serverTablesDB,
  DATABASE_ID,
  CASE_ATTACHMENTS_BUCKET_ID,
  CASE_QUOTES_TABLE_ID,
  CASE_DEMAND_TESTS_TABLE_ID,
} from "@/lib/appwrite";
import { verifyCaseOwnership } from "@/lib/investment-case/db";
import {
  findAttachmentSlot,
  isValidFileId,
  safeFilename,
  isOwnedByCase,
  displayFilename,
  deleteBlobIfOwnedByCase,
} from "@/lib/investment-case/attachments";

interface RouteContext {
  params: Promise<{ caseId: string; fileId: string }>;
}

function statusFor(message: string): number {
  if (message === "Unauthorized") return 401;
  if (message === "Forbidden") return 403;
  if (message === "Not found") return 404;
  return 500;
}

/**
 * Stream an attachment back to the owner.
 *
 * Three checks, all required: the case belongs to the caller, the file is
 * referenced by that case, and the blob was uploaded *for* that case. The API
 * key can read the whole bucket, so this route is the only thing narrowing it.
 *
 * The third check is not redundant. The reference check alone was once the
 * whole authorization story, and it was bypassable: file ids were accepted on
 * quote PATCH, so an attacker could link a victim's file into their own case
 * and read it here. Linking is server-only now, and this check means the leak
 * stays closed even if some future edit re-opens a write path.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId, fileId } = await context.params;

    if (!isValidFileId(fileId)) {
      return NextResponse.json({ error: "Malformed file id" }, { status: 400 });
    }

    await verifyCaseOwnership(caseId, user.$id);

    const slot = await findAttachmentSlot(caseId, fileId);
    if (!slot) {
      // Deliberately indistinguishable from "no such file" — confirming that an
      // id exists but belongs elsewhere would leak the id space.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const metadata = await serverStorage.getFile({
      bucketId: CASE_ATTACHMENTS_BUCKET_ID,
      fileId,
    });
    if (!isOwnedByCase(metadata.name, caseId)) {
      console.warn(
        `[case-attachments] refused ${fileId}: referenced by case ${caseId} but not uploaded for it`,
      );
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const bytes = await serverStorage.getFileView({
      bucketId: CASE_ATTACHMENTS_BUCKET_ID,
      fileId,
    });

    return new Response(bytes, {
      headers: {
        "Content-Type": metadata.mimeType || "application/octet-stream",
        "Content-Length": String(metadata.sizeOriginal),
        "Content-Disposition": `inline; filename="${safeFilename(displayFilename(metadata.name))}"`,
        // Owner-only content behind an auth check — never let a shared cache
        // hold it.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

/**
 * Delete an attachment and clear the reference that pointed at it.
 *
 * Order matters: the row is cleared first. If the storage delete then fails,
 * the result is an orphaned blob — invisible, since the GET route requires a
 * reference. The reverse order would leave a row pointing at a file that no
 * longer exists, which reads as a valid attachment and would let a case publish
 * on evidence that isn't there.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId, fileId } = await context.params;

    if (!isValidFileId(fileId)) {
      return NextResponse.json({ error: "Malformed file id" }, { status: 400 });
    }

    await verifyCaseOwnership(caseId, user.$id);

    const slot = await findAttachmentSlot(caseId, fileId);
    if (!slot) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Same binding check as GET — deleting someone else's blob would be a
    // destructive version of the same bypass.
    const metadata = await serverStorage.getFile({
      bucketId: CASE_ATTACHMENTS_BUCKET_ID,
      fileId,
    });
    if (!isOwnedByCase(metadata.name, caseId)) {
      console.warn(
        `[case-attachments] refused delete of ${fileId}: not uploaded for case ${caseId}`,
      );
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await serverTablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: slot.kind === "quote" ? CASE_QUOTES_TABLE_ID : CASE_DEMAND_TESTS_TABLE_ID,
      rowId: slot.rowId,
      data: { [slot.field]: null },
    });

    // Ownership was already checked above; going through the helper anyway so
    // that every blob deletion in the codebase is gated the same way and a
    // future edit can't drop the check here without noticing.
    await deleteBlobIfOwnedByCase(fileId, caseId);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
