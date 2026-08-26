import { NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { requireAuth } from '@/lib/appwrite-server';
import {
  serverTablesDB,
  DATABASE_ID,
  CANVASES_TABLE_ID,
  BLOCKS_TABLE_ID,
  SEGMENTS_TABLE_ID,
} from '@/lib/appwrite';
import { getUserIdFromCanvas } from '@/lib/utils';
import type { CanvasData } from '@/lib/types/canvas';

interface RouteContext {
  params: Promise<{ canvasId: string; blockType: string }>;
}

async function verifyCanvasAndGetBlock(
  canvasId: string,
  blockType: string,
  userId: string,
) {
  const canvas = await serverTablesDB.getRow({
    databaseId: DATABASE_ID,
    tableId: CANVASES_TABLE_ID,
    rowId: canvasId,
  }) as unknown as CanvasData;
  if (getUserIdFromCanvas(canvas) !== userId) {
    throw new Error('Forbidden');
  }

  const existing = await serverTablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: BLOCKS_TABLE_ID,
    queries: [
      Query.equal('canvas', canvasId),
      Query.equal('blockType', blockType),
      Query.select(['$id']),
      Query.limit(1),
    ],
  });

  if (existing.rows.length === 0) {
    throw new Error('Block not found');
  }

  return existing.rows[0];
}

/**
 * Confirm a segment id actually belongs to this canvas before linking it.
 *
 * Owning the canvas is not sufficient authorisation to link an arbitrary
 * segment id into it. `segments` is an Appwrite relationship, and Appwrite
 * auto-loads relationship fields on read — so an id borrowed from another
 * user's canvas would be expanded back out when this block is fetched,
 * disclosing that segment's name and description. Scoping the lookup by
 * canvas makes a foreign id indistinguishable from a nonexistent one.
 */
async function verifySegmentOnCanvas(segmentId: string, canvasId: string) {
  const match = await serverTablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: SEGMENTS_TABLE_ID,
    queries: [
      Query.equal('$id', segmentId),
      Query.equal('canvas', canvasId),
      Query.select(['$id']),
      Query.limit(1),
    ],
  });

  if (match.rows.length === 0) {
    throw new Error('Segment not found');
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { canvasId, blockType } = await context.params;
    const block = await verifyCanvasAndGetBlock(canvasId, blockType, user.$id);
    const body = await request.json();
    const { segmentId } = body;

    if (!segmentId || typeof segmentId !== 'string') {
      return NextResponse.json({ error: 'segmentId (string) is required' }, { status: 400 });
    }

    // Owning the canvas does not authorise linking an arbitrary segment id
    // into it — the id must belong to this canvas too.
    await verifySegmentOnCanvas(segmentId, canvasId);

    // Get current segment IDs
    const currentSegments = Array.isArray(block.segments)
      ? block.segments.map((s: unknown) => (typeof s === 'string' ? s : (s as { $id: string }).$id))
      : [];

    // Add new segment if not already linked
    if (!currentSegments.includes(segmentId)) {
      currentSegments.push(segmentId);

      await serverTablesDB.updateRow({
        databaseId: DATABASE_ID,
        tableId: BLOCKS_TABLE_ID,
        rowId: block.$id,
        data: { segments: currentSegments },
      });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Unauthorized') return NextResponse.json({ error: message }, { status: 401 });
    if (message === 'Forbidden') return NextResponse.json({ error: message }, { status: 403 });
    if (message === 'Block not found') return NextResponse.json({ error: message }, { status: 404 });
    if (message === 'Segment not found') return NextResponse.json({ error: message }, { status: 404 });
    console.error('Link segment error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { canvasId, blockType } = await context.params;
    const block = await verifyCanvasAndGetBlock(canvasId, blockType, user.$id);
    const { searchParams } = new URL(request.url);
    const segmentId = searchParams.get('segmentId');

    if (!segmentId) {
      return NextResponse.json({ error: 'segmentId query param required' }, { status: 400 });
    }

    // Get current segment IDs
    const currentSegments = Array.isArray(block.segments)
      ? block.segments.map((s: unknown) => (typeof s === 'string' ? s : (s as { $id: string }).$id))
      : [];

    // Remove segment
    const updatedSegments = currentSegments.filter((id: string) => id !== segmentId);

    await serverTablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: BLOCKS_TABLE_ID,
      rowId: block.$id,
      data: { segments: updatedSegments },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Unauthorized') return NextResponse.json({ error: message }, { status: 401 });
    if (message === 'Forbidden') return NextResponse.json({ error: message }, { status: 403 });
    if (message === 'Block not found') return NextResponse.json({ error: message }, { status: 404 });
    console.error('Unlink segment error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
