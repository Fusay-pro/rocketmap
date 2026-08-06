import { NextResponse } from "next/server";
import { ID } from "node-appwrite";
import { requireAuth } from "@/lib/appwrite-server";
import {
  serverStorage,
  serverTablesDB,
  DATABASE_ID,
  CASE_ATTACHMENTS_BUCKET_ID,
  CASE_QUOTES_TABLE_ID,
  CASE_DEMAND_TESTS_TABLE_ID,
} from "@/lib/appwrite";
import {
  verifyCaseOwnership,
  verifyQuoteBelongsToCase,
  getDemandTestForCase,
} from "@/lib/investment-case/db";
import { buildStoredFilename, deleteBlobIfOwnedByCase } from "@/lib/investment-case/attachments";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

/** Keep in sync with maximumFileSize in scripts/setup-case-attachments-bucket.ts. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Mirrors the bucket's allowedFileExtensions, so a bad type fails legibly. */
const ALLOWED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "csv", "xlsx", "docx"];

function statusFor(message: string): number {
  if (message === "Unauthorized") return 401;
  if (message === "Forbidden") return 403;
  if (message === "Not found") return 404;
  return 500;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * Upload an attachment AND link it to its target row, in one request.
 *
 * Atomic on purpose. Previously this returned a bare `fileId` and the client
 * PATCHed it onto a quote as a second step, which caused two problems:
 *
 *  - **Authorization.** Accepting a raw file id on PATCH let a caller point a
 *    row they owned at a blob they did not, defeating the reference check the
 *    download route relies on. Clients can no longer name a file id at all;
 *    the only way a reference appears is this route writing it.
 *  - **Orphans.** If the upload succeeded and the follow-up PATCH failed, the
 *    bytes were stranded — unreachable (the download route needs a reference)
 *    but still billed. A failed link now deletes the blob it just wrote.
 *
 * Body: multipart with `file`, `targetKind` (`quote` | `demand-test`), and
 * `targetId` when `targetKind` is `quote`.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId } = await context.params;
    await verifyCaseOwnership(caseId, user.$id);

    const formData = await request.formData();
    const file = formData.get("file");
    const targetKind = formData.get("targetKind");
    const targetId = formData.get("targetId");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "Expected multipart form data with a 'file' field" },
        { status: 400 },
      );
    }
    if (targetKind !== "quote" && targetKind !== "demand-test") {
      return NextResponse.json(
        { error: "targetKind must be 'quote' or 'demand-test'" },
        { status: 400 },
      );
    }

    // Resolve the target first: no bytes are stored until we know where they
    // belong and that the caller owns it.
    let tableId: string;
    let rowId: string;
    let field: "attachmentFileId" | "evidenceFileId";
    let previousFileId: string | null;

    if (targetKind === "quote") {
      if (typeof targetId !== "string" || targetId.length === 0) {
        return NextResponse.json({ error: "targetId is required for a quote" }, { status: 400 });
      }
      const quote = await verifyQuoteBelongsToCase(caseId, targetId);
      tableId = CASE_QUOTES_TABLE_ID;
      rowId = quote.$id;
      field = "attachmentFileId";
      previousFileId = quote.attachmentFileId;
    } else {
      const demandTest = await getDemandTestForCase(caseId);
      if (!demandTest) {
        return NextResponse.json(
          { error: "Create the demand test before attaching evidence" },
          { status: 404 },
        );
      }
      tableId = CASE_DEMAND_TESTS_TABLE_ID;
      rowId = demandTest.$id;
      field = "evidenceFileId";
      previousFileId = demandTest.evidenceFileId;
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `File is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is ${
            MAX_UPLOAD_BYTES / 1024 / 1024
          }MB`,
        },
        { status: 413 },
      );
    }
    const extension = extensionOf(file.name);
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return NextResponse.json(
        { error: `Unsupported file type "${extension || "unknown"}". Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` },
        { status: 415 },
      );
    }

    // The stored name is built server-side and carries the owning case id, so
    // the blob is bound to this case independently of any row that points at it.
    const storedName = buildStoredFilename(caseId, file.name);
    const created = await serverStorage.createFile({
      bucketId: CASE_ATTACHMENTS_BUCKET_ID,
      fileId: ID.unique(),
      file: new File([await file.arrayBuffer()], storedName, { type: file.type }),
      permissions: [],
    });

    try {
      await serverTablesDB.updateRow({
        databaseId: DATABASE_ID,
        tableId,
        rowId,
        data: { [field]: created.$id },
      });
    } catch (linkError: unknown) {
      // Compensate: without this the bytes would be unreachable but retained.
      // Deliberately NOT via deleteBlobIfOwnedByCase — this blob was created a
      // few lines above with a name we built for this case, so ownership is
      // known rather than something to re-derive from storage.
      await serverStorage
        .deleteFile({ bucketId: CASE_ATTACHMENTS_BUCKET_ID, fileId: created.$id })
        .catch((cleanupError: unknown) => {
          console.error(
            `[case-attachments] link failed AND cleanup failed for ${created.$id}:`,
            cleanupError,
          );
        });
      throw linkError;
    }

    // Replacing an attachment: drop the superseded blob now that nothing points
    // at it. Routed through the ownership-checked helper rather than deleting
    // `previousFileId` outright — the id comes from a stored row, and a row that
    // points at another case's file (stale data, a manual edit, or a reference
    // written before linking was locked down) would otherwise turn an ordinary
    // replacement into the destruction of someone else's evidence.
    if (previousFileId && previousFileId !== created.$id) {
      await deleteBlobIfOwnedByCase(previousFileId, caseId);
    }

    return NextResponse.json(
      {
        fileId: created.$id,
        name: file.name,
        sizeBytes: created.sizeOriginal,
        mimeType: created.mimeType,
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[case-attachments] upload failed:", message);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
