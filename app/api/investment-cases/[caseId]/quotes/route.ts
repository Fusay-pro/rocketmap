import { NextResponse } from "next/server";
import { ID } from "node-appwrite";
import { requireAuth } from "@/lib/appwrite-server";
import { serverTablesDB, DATABASE_ID, CASE_QUOTES_TABLE_ID } from "@/lib/appwrite";
import {
  verifyCaseOwnership,
  listQuotesForCase,
  unsetOtherPrimaryQuotes,
  parseCaseQuoteRow,
} from "@/lib/investment-case/db";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

function statusFor(message: string): number {
  if (message === "Unauthorized") return 401;
  if (message === "Forbidden") return 403;
  if (message === "Not found") return 404;
  return 500;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId } = await context.params;
    await verifyCaseOwnership(caseId, user.$id);
    const quotes = await listQuotesForCase(caseId);
    return NextResponse.json(quotes);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId } = await context.params;
    await verifyCaseOwnership(caseId, user.$id);
    const body = (await request.json()) as Record<string, unknown>;

    const { supplierName, moq, fobPerUnit, freightMode, freightValue, dutyMode, dutyValue, quoteDate } = body;
    if (!supplierName || typeof supplierName !== "string") {
      return NextResponse.json({ error: "supplierName is required" }, { status: 400 });
    }
    if (typeof moq !== "number" || typeof fobPerUnit !== "number") {
      return NextResponse.json({ error: "moq and fobPerUnit are required" }, { status: 400 });
    }
    if (freightMode !== "total" && freightMode !== "per_unit") {
      return NextResponse.json({ error: "freightMode must be total or per_unit" }, { status: 400 });
    }
    if (dutyMode !== "pct" && dutyMode !== "per_unit") {
      return NextResponse.json({ error: "dutyMode must be pct or per_unit" }, { status: 400 });
    }

    const doc = await serverTablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: CASE_QUOTES_TABLE_ID,
      rowId: ID.unique(),
      data: {
        case: caseId,
        supplierName: supplierName.trim(),
        moq,
        fobPerUnit,
        freightMode,
        freightValue: typeof freightValue === "number" ? freightValue : 0,
        dutyMode,
        dutyValue: typeof dutyValue === "number" ? dutyValue : 0,
        leadTimeDays: typeof body.leadTimeDays === "number" ? body.leadTimeDays : null,
        paymentTerms: typeof body.paymentTerms === "string" ? body.paymentTerms : "",
        attachmentFileId: null,
        quoteDate: typeof quoteDate === "string" ? quoteDate : new Date().toISOString(),
        isPrimary: Boolean(body.isPrimary),
      },
    });

    if (body.isPrimary) {
      await unsetOtherPrimaryQuotes(caseId, doc.$id);
    }

    return NextResponse.json(parseCaseQuoteRow(doc), { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
