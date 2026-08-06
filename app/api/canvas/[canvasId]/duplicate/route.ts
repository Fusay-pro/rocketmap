import { NextResponse } from 'next/server';
import { ID, Query } from 'node-appwrite';
import { requireAuth } from '@/lib/appwrite-server';
import { serverTablesDB, DATABASE_ID, CANVASES_TABLE_ID, BLOCKS_TABLE_ID } from '@/lib/appwrite';
import { generateSlug, getUserIdFromCanvas } from '@/lib/utils';
import type { CanvasData } from '@/lib/types/canvas';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ canvasId: string }> }
) {
  try {
    const user = await requireAuth();
    const { canvasId } = await params;

    // Fetch only fields needed for auth + duplication
    const source = await serverTablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: CANVASES_TABLE_ID,
      rowId: canvasId,
      queries: [],
    }) as unknown as CanvasData;

    if (getUserIdFromCanvas(source) !== user.$id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const newTitle = `${source.title} (Copy)`;
    const slug = await generateSlug(newTitle, user.$id);
    const now = new Date().toISOString();

    const newCanvas = await serverTablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: CANVASES_TABLE_ID,
      rowId: ID.unique(),
      data: {
        title: newTitle,
        slug,
        description: source.description || '',
        createdAt: now,
        updatedAt: now,
        isPublic: false,
        user: user.$id,
      },
    });

    try {
      // Fetch only fields needed for block duplication
      const blocks = await serverTablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: BLOCKS_TABLE_ID,
        queries: [
          Query.equal('canvas', source.$id),
          Query.select(["$id", "blockType", "contentJson"]),
          Query.limit(100),
        ],
      });
      // Create duplicated blocks in parallel
      await Promise.all(
        blocks.rows.map((block) =>
          serverTablesDB.createRow({
            databaseId: DATABASE_ID,
            tableId: BLOCKS_TABLE_ID,
            rowId: ID.unique(),
            data: {
              canvas: newCanvas.$id,
              blockType: block.blockType,
              contentJson: block.contentJson,
            },
          }),
        ),
      );
    } catch (error) {
      // Was silently swallowed — writing to the dead `canvasId` field is why
      // duplicated canvases came out with no blocks at all.
      console.error(`[duplicate] block copy failed for canvas ${source.$id}:`, error);
    }

    return NextResponse.json({ slug, $id: newCanvas.$id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
