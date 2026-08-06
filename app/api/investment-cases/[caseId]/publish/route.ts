import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/appwrite-server";
import { serverTablesDB, DATABASE_ID, INVESTMENT_CASES_TABLE_ID } from "@/lib/appwrite";
import { loadFullCase } from "@/lib/investment-case/db";
import { validateForPublish } from "@/lib/investment-case/validation";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

function statusFor(message: string): number {
  if (message === "Unauthorized") return 401;
  if (message === "Forbidden") return 403;
  if (message === "Not found") return 404;
  return 500;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId } = await context.params;
    const full = await loadFullCase(caseId, user.$id);

    const validation = validateForPublish(full.investmentCase, full.quotes, full.demandTest);
    if (!validation.valid) {
      return NextResponse.json({ error: "Case is not ready to publish", errors: validation.errors }, { status: 400 });
    }

    const publishedAt = new Date().toISOString();
    await serverTablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: INVESTMENT_CASES_TABLE_ID,
      rowId: caseId,
      data: { status: "published", publishedAt, updatedAt: publishedAt },
    });

    const updated = await loadFullCase(caseId, user.$id);
    return NextResponse.json({
      case: updated.investmentCase,
      quotes: updated.quotes,
      demandTest: updated.demandTest,
      scenarios: updated.scenarios,
      systemRecommendation: updated.systemRecommendation,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
