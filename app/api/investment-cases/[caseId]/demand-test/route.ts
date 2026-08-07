import { NextResponse } from "next/server";
import { ID } from "node-appwrite";
import { requireAuth } from "@/lib/appwrite-server";
import { serverTablesDB, DATABASE_ID, CASE_DEMAND_TESTS_TABLE_ID } from "@/lib/appwrite";
import {
  verifyCaseOwnership,
  getDemandTestForCase,
  listDemandTestsForCase,
  parseCaseDemandTestRow,
} from "@/lib/investment-case/db";
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
    if (existing) {
      const updated = await serverTablesDB.updateRow({
        databaseId: DATABASE_ID,
        tableId: CASE_DEMAND_TESTS_TABLE_ID,
        rowId: existing.$id,
        data,
      });
      return NextResponse.json(parseCaseDemandTestRow(updated));
    }

    const created = await serverTablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: CASE_DEMAND_TESTS_TABLE_ID,
      rowId: ID.unique(),
      data: { case: caseId, ...data },
    });

    // "At most one demand test per case" is a spec rule with nothing enforcing
    // it: a relationship column can't take a unique index, and the check above
    // is a read-then-write, so two concurrent saves can both find nothing and
    // both create. Converge instead of leaving a duplicate behind for the memo
    // and the publish gate to disagree over.
    //
    // Deterministic by construction: every racer keeps the oldest row by $id and
    // deletes only the row it created itself, so exactly one survives no matter
    // how many raced or what order they arrive in.
    const all = await listDemandTestsForCase(caseId);
    if (all.length > 1) {
      const winner = all[0];
      if (winner.$id !== created.$id) {
        await serverTablesDB
          .deleteRow({
            databaseId: DATABASE_ID,
            tableId: CASE_DEMAND_TESTS_TABLE_ID,
            rowId: created.$id,
          })
          .catch((e: unknown) => {
            console.error(`[demand-test] failed to drop duplicate ${created.$id}:`, e);
          });
        console.warn(
          `[demand-test] concurrent create on case ${caseId}; kept ${winner.$id}, dropped ${created.$id}`,
        );
        return NextResponse.json(winner);
      }
    }

    return NextResponse.json(parseCaseDemandTestRow(created));
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
    // Delete every demand test on the case, not just the first. If a race ever
    // produced duplicates, removing one would leave the case looking like it
    // still has a demand test, and the caller asked for it to be gone.
    const existing = await listDemandTestsForCase(caseId);

    for (const row of existing) {
      await serverTablesDB.deleteRow({
        databaseId: DATABASE_ID,
        tableId: CASE_DEMAND_TESTS_TABLE_ID,
        rowId: row.$id,
      });
      // Same reasoning as quote deletion: nothing references the evidence blob
      // once the row is gone, so it would sit in the bucket unreachable forever.
      await deleteBlobIfOwnedByCase(row.evidenceFileId, caseId);
    }

    return NextResponse.json({ success: true, deleted: existing.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
