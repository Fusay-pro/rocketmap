import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/appwrite-server';
import {
  serverTablesDB,
  DATABASE_ID,
  EXPERIMENTS_TABLE_ID,
  ASSUMPTIONS_TABLE_ID,
} from '@/lib/appwrite';
import { verifyCanvasOwnership, verifyAssumptionBelongsToCanvas, verifyExperimentBelongsToAssumption, isForbiddenError } from '@/lib/utils';
import type { DecisionSignal, ExperimentResult } from '@/lib/types/canvas';

interface RouteContext {
  params: Promise<{ canvasId: string; assumptionId: string; id: string }>;
}

const DECISION_SIGNALS = new Set([
  'kill',
  'pivot',
  'double_down',
  'insufficient_evidence',
]);

function defaultDecisionSignal(result: ExperimentResult): DecisionSignal {
  // A supporting result defaults to "more evidence", not "double down". This
  // fallback fires whenever the client omits decisionSignal, so leaving it as
  // double_down would reinstate the bias the UI no longer has. Kept in sync
  // with defaultDecisionForResult in components/canvas/EvidenceCollectionModal.tsx.
  if (result === 'supports') return 'insufficient_evidence';
  if (result === 'contradicts') return 'pivot';
  return 'insufficient_evidence';
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { canvasId, assumptionId, id } = await context.params;
    await verifyCanvasOwnership(canvasId, user.$id);
    await verifyAssumptionBelongsToCanvas(canvasId, assumptionId);
    await verifyExperimentBelongsToAssumption(assumptionId, id);
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.result !== undefined) updates.result = body.result;
    if (body.evidence !== undefined) updates.evidence = body.evidence;
    if (body.sourceUrl !== undefined) updates.sourceUrl = body.sourceUrl;
    if (body.successThreshold !== undefined) {
      updates.successThreshold = body.successThreshold
        ? String(body.successThreshold).slice(0, 500)
        : null;
    }

    // If marking as completed, auto-update assumption status
    if (body.status === 'completed') {
      updates.completedAt = new Date().toISOString();

      if (body.result) {
        const requestedDecisionSignal = body.decisionSignal;
        if (
          requestedDecisionSignal !== undefined &&
          !DECISION_SIGNALS.has(requestedDecisionSignal)
        ) {
          return NextResponse.json({ error: 'Invalid decision signal' }, { status: 400 });
        }

        const assumptionUpdates: Record<string, unknown> = {
          lastTestedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          decisionSignal: requestedDecisionSignal ?? defaultDecisionSignal(body.result as ExperimentResult),
        };

        if (body.result === 'supports') assumptionUpdates.status = 'validated';
        else if (body.result === 'contradicts') assumptionUpdates.status = 'refuted';
        else assumptionUpdates.status = 'inconclusive';

        await serverTablesDB.updateRow({
          databaseId: DATABASE_ID,
          tableId: ASSUMPTIONS_TABLE_ID,
          rowId: assumptionId,
          data: assumptionUpdates,
        });
      }
    }

    const experiment = await serverTablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: EXPERIMENTS_TABLE_ID,
      rowId: id,
      data: updates,
    });

    return NextResponse.json(experiment);
  } catch (error) {
    if (isForbiddenError(error)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Error updating experiment:', error);
    return NextResponse.json({ error: 'Failed to update experiment' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { canvasId, assumptionId, id } = await context.params;
    await verifyCanvasOwnership(canvasId, user.$id);
    await verifyAssumptionBelongsToCanvas(canvasId, assumptionId);
    await verifyExperimentBelongsToAssumption(assumptionId, id);

    await serverTablesDB.deleteRow({
      databaseId: DATABASE_ID,
      tableId: EXPERIMENTS_TABLE_ID,
      rowId: id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isForbiddenError(error)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Error deleting experiment:', error);
    return NextResponse.json({ error: 'Failed to delete experiment' }, { status: 500 });
  }
}
