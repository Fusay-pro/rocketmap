import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/appwrite-server";
import {
  serverTablesDB,
  DATABASE_ID,
  INVESTMENT_CASES_TABLE_ID,
  CASE_DEMAND_TESTS_TABLE_ID,
} from "@/lib/appwrite";
import { loadFullCase, getDemandTestForCase } from "@/lib/investment-case/db";
import { deleteBlobIfOwnedByCase } from "@/lib/investment-case/attachments";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

const PATCHABLE_FIELDS = [
  "title",
  "currency",
  "skuDescription",
  "targetVolume",
  "targetVolumeTag",
  "targetVolumeSourceNote",
  "targetVolumePlannedTest",
  "sellPricePerUnit",
  "sellPriceTag",
  "sellPriceSourceNote",
  "sellPricePlannedTest",
  "capitalAvailable",
  "killMarginPct",
  "killDemandMetric",
  "killDemandThreshold",
  "nextCheapestTest",
  "verdict",
  "verdictNote",
] as const;

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
    const full = await loadFullCase(caseId, user.$id);

    return NextResponse.json({
      case: full.investmentCase,
      quotes: full.quotes,
      demandTest: full.demandTest,
      scenarios: full.scenarios,
      systemRecommendation: full.systemRecommendation,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId } = await context.params;
    const existing = await loadFullCase(caseId, user.$id);
    const body = (await request.json()) as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
    for (const field of PATCHABLE_FIELDS) {
      if (field in body) updates[field] = body[field];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    updates.updatedAt = new Date().toISOString();

    await serverTablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: INVESTMENT_CASES_TABLE_ID,
      rowId: caseId,
      data: updates,
    });

    // Sync rule (spec §2.1): case is the source of truth for the demand
    // test's threshold whenever killDemandMetric is set.
    const nextKillDemandMetric =
      typeof updates.killDemandMetric === "string"
        ? updates.killDemandMetric
        : existing.investmentCase.killDemandMetric;
    const nextKillDemandThreshold =
      "killDemandThreshold" in updates
        ? (updates.killDemandThreshold as number | null)
        : existing.investmentCase.killDemandThreshold;

    if (nextKillDemandMetric.trim().length > 0) {
      const demandTest = await getDemandTestForCase(caseId);
      if (demandTest && demandTest.threshold !== nextKillDemandThreshold) {
        await serverTablesDB.updateRow({
          databaseId: DATABASE_ID,
          tableId: CASE_DEMAND_TESTS_TABLE_ID,
          rowId: demandTest.$id,
          data: { threshold: nextKillDemandThreshold },
        });
      }
    }

    const full = await loadFullCase(caseId, user.$id);
    return NextResponse.json({
      case: full.investmentCase,
      quotes: full.quotes,
      demandTest: full.demandTest,
      scenarios: full.scenarios,
      systemRecommendation: full.systemRecommendation,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId } = await context.params;
    const full = await loadFullCase(caseId, user.$id); // ownership check

    // Collect the blob ids BEFORE deleting the case: the quote and demand-test
    // rows cascade away with it, and once they're gone nothing records which
    // files belonged here. This is the largest orphan source — one case delete
    // can strand every attachment it ever held.
    const blobIds = [
      ...full.quotes.map((q) => q.attachmentFileId),
      full.demandTest?.evidenceFileId ?? null,
    ];

    await serverTablesDB.deleteRow({
      databaseId: DATABASE_ID,
      tableId: INVESTMENT_CASES_TABLE_ID,
      rowId: caseId,
    });

    // Ownership-checked individually, and never allowed to fail the delete the
    // caller actually asked for.
    await Promise.all(blobIds.map((fileId) => deleteBlobIfOwnedByCase(fileId, caseId)));

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
