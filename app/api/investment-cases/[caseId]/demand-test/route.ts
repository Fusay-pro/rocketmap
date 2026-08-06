import { NextResponse } from "next/server";
import { ID } from "node-appwrite";
import { requireAuth } from "@/lib/appwrite-server";
import { serverTablesDB, DATABASE_ID, CASE_DEMAND_TESTS_TABLE_ID } from "@/lib/appwrite";
import { verifyCaseOwnership, getDemandTestForCase, parseCaseDemandTestRow } from "@/lib/investment-case/db";
import { deleteBlobIfOwnedByCase } from "@/lib/investment-case/attachments";

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
    const demandTest = await getDemandTestForCase(caseId);
    return NextResponse.json(demandTest);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

/** Upsert — max one demand test per case (spec §2.3). */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId } = await context.params;
    const investmentCase = await verifyCaseOwnership(caseId, user.$id);
    const body = (await request.json()) as Record<string, unknown>;

    const { hypothesis, method, metricName, status } = body;
    if (typeof hypothesis !== "string" || typeof metricName !== "string") {
      return NextResponse.json({ error: "hypothesis and metricName are required" }, { status: 400 });
    }
    const validMethods = ["landing", "preorder", "outreach", "interview", "other"];
    if (typeof method !== "string" || !validMethods.includes(method)) {
      return NextResponse.json({ error: "Invalid method" }, { status: 400 });
    }
    const validStatuses = ["planned", "running", "done"];
    if (typeof status !== "string" || !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (
      investmentCase.killDemandMetric.trim().length > 0 &&
      metricName !== investmentCase.killDemandMetric
    ) {
      return NextResponse.json(
        { error: `metricName must match the case's killDemandMetric ("${investmentCase.killDemandMetric}")` },
        { status: 400 },
      );
    }

    const existing = await getDemandTestForCase(caseId);

    // threshold is never client-settable — always synced from the case (spec §4.3)
    //
    // `evidenceFileId` is not client-settable either, for two reasons. Accepting
    // it was an authorization bypass (a caller could point their demand test at
    // someone else's blob and read it through the attachment route), and reading
    // it off the body meant every save that omitted it — which is every save the
    // form makes — silently reset an existing attachment to null and stranded
    // the blob. It is carried over from the stored row and written only by the
    // attachments routes.
    const data = {
      hypothesis: hypothesis.trim(),
      method,
      metricName: metricName.trim(),
      threshold: investmentCase.killDemandThreshold,
      result: typeof body.result === "number" ? body.result : null,
      sampleSize: typeof body.sampleSize === "number" ? body.sampleSize : null,
      status,
      evidenceFileId: existing?.evidenceFileId ?? null,
    };
    const doc = existing
      ? await serverTablesDB.updateRow({
          databaseId: DATABASE_ID,
          tableId: CASE_DEMAND_TESTS_TABLE_ID,
          rowId: existing.$id,
          data,
        })
      : await serverTablesDB.createRow({
          databaseId: DATABASE_ID,
          tableId: CASE_DEMAND_TESTS_TABLE_ID,
          rowId: ID.unique(),
          data: { case: caseId, ...data },
        });

    return NextResponse.json(parseCaseDemandTestRow(doc));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { caseId } = await context.params;
    await verifyCaseOwnership(caseId, user.$id);
    const existing = await getDemandTestForCase(caseId);

    if (existing) {
      await serverTablesDB.deleteRow({
        databaseId: DATABASE_ID,
        tableId: CASE_DEMAND_TESTS_TABLE_ID,
        rowId: existing.$id,
      });
      // Same reasoning as quote deletion: nothing references the evidence blob
      // once the row is gone, so it would sit in the bucket unreachable forever.
      await deleteBlobIfOwnedByCase(existing.evidenceFileId, caseId);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
