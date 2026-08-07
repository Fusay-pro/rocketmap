import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/appwrite-server";
import { serverTablesDB, DATABASE_ID, INVESTMENT_CASES_TABLE_ID } from "@/lib/appwrite";
import { loadFullCase, listDemandTestsForCase } from "@/lib/investment-case/db";
import { validateForPublish } from "@/lib/investment-case/validation";
import { attachmentIsUsable } from "@/lib/investment-case/attachments";

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
    const errors = [...validation.errors];

    // Storage-backed checks live here rather than in validateForPublish, which
    // is a pure function over rows and is unit-tested as one.
    //
    // validateForPublish can only see that attachmentFileId is a non-empty
    // string. That is not the same as the document existing: a reference can
    // outlive its blob (an interrupted cleanup, a restore from an older export,
    // a manual edit), and publishing on it would produce a case whose evidence
    // 404s the first time anyone opens it. Publish is the promise that the
    // numbers are backed by something, so it verifies the something is there.
    const primary = full.quotes.find((q) => q.isPrimary);
    if (primary?.attachmentFileId && !(await attachmentIsUsable(primary.attachmentFileId, caseId))) {
      errors.push({
        field: "quotes.attachmentFileId",
        message: "The primary quote's attached document is missing from storage — re-upload it",
      });
    }
    if (
      full.demandTest?.evidenceFileId &&
      !(await attachmentIsUsable(full.demandTest.evidenceFileId, caseId))
    ) {
      errors.push({
        field: "demandTest.evidenceFileId",
        message: "The demand test's evidence file is missing from storage — re-upload it",
      });
    }

    // "At most one demand test per case" is unenforceable at the database
    // level, so confirm it here rather than publishing numbers derived from
    // whichever duplicate happened to be read first.
    const demandTests = await listDemandTestsForCase(caseId);
    if (demandTests.length > 1) {
      errors.push({
        field: "demandTest",
        message: `${demandTests.length} demand tests exist for this case — exactly one must`,
      });
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: "Case is not ready to publish", errors }, { status: 400 });
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
