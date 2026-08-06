import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/appwrite-server";
import { serverTablesDB, DATABASE_ID, CASE_QUOTES_TABLE_ID } from "@/lib/appwrite";
import {
  verifyCaseOwnership,
  verifyQuoteBelongsToCase,
  unsetOtherPrimaryQuotes,
  parseCaseQuoteRow,
} from "@/lib/investment-case/db";
import { deleteBlobIfOwnedByCase } from "@/lib/investment-case/attachments";

interface RouteContext {
  params: Promise<{ caseId: string; quoteId: string }>;
}

/**
 * `attachmentFileId` is deliberately NOT patchable.
 *
 * It was, and that was an authorization bypass: the download route treats "this
 * case references the file" as proof of ownership, so a caller who learned any
 * file id could PATCH it onto their own quote and then read or delete a file
 * belonging to someone else. Attachments are now written only by
 * `POST /api/investment-cases/:caseId/attachments`, which uploads and links in
 * one step, and cleared only by the attachment DELETE route.
 */
const PATCHABLE_FIELDS = [
  "supplierName",
  "moq",
  "fobPerUnit",
  "freightMode",
  "freightValue",
  "dutyMode",
  "dutyValue",
  "leadTimeDays",
  "paymentTerms",
  "quoteDate",
  "isPrimary",
] as const;

function statusFor(message: string): number {
  if (message === "Unauthorized") return 401;
  if (message === "Forbidden") return 403;
  if (message === "Not found") return 404;
  return 500;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId, quoteId } = await context.params;
    await verifyCaseOwnership(caseId, user.$id);
    await verifyQuoteBelongsToCase(caseId, quoteId);

    const body = (await request.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const field of PATCHABLE_FIELDS) {
      if (field in body) updates[field] = body[field];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const updated = await serverTablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: CASE_QUOTES_TABLE_ID,
      rowId: quoteId,
      data: updates,
    });

    if (updates.isPrimary === true) {
      await unsetOtherPrimaryQuotes(caseId, quoteId);
    }

    return NextResponse.json(parseCaseQuoteRow(updated));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId, quoteId } = await context.params;
    await verifyCaseOwnership(caseId, user.$id);
    const quote = await verifyQuoteBelongsToCase(caseId, quoteId);

    await serverTablesDB.deleteRow({
      databaseId: DATABASE_ID,
      tableId: CASE_QUOTES_TABLE_ID,
      rowId: quoteId,
    });

    // The row was the only thing referencing this blob; without this the bytes
    // stay in the bucket forever, unreachable (reads require a reference) but
    // still stored and billed. Row first, so a storage failure leaves an orphan
    // rather than a quote that can't be deleted.
    await deleteBlobIfOwnedByCase(quote.attachmentFileId, caseId);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
