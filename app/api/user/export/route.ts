import { NextResponse } from 'next/server';
import { Query } from 'node-appwrite';
import { requireAuth } from '@/lib/appwrite-server';
import { serverTablesDB, DATABASE_ID, BLOCKS_TABLE_ID } from '@/lib/appwrite';
import { listCanvasesByOwner } from '@/lib/utils';

export async function GET() {
  try {
    const user = await requireAuth();

    // Index required: user (key), $updatedAt (desc) — composite index recommended
    const canvasesResult = await listCanvasesByOwner(user.$id, [
      Query.select(['$id', 'title', 'slug', 'createdAt', '$updatedAt']),
      Query.orderDesc('$updatedAt'),
      Query.limit(100),
    ]);

    const canvases = await Promise.all(
      canvasesResult.rows.map(async (canvas) => {
        let blocks: { blockType: string; content: unknown }[] = [];
        try {
          // Index required: blocks.canvas (relationship — auto-indexed by Appwrite)
          // Export every atomic row, not just 9 — a canvas holds 33-49 of them.
          const blocksResult = await serverTablesDB.listRows({
            databaseId: DATABASE_ID,
            tableId: BLOCKS_TABLE_ID,
            queries: [
              Query.equal('canvas', canvas.$id),
              Query.select(['blockType', 'contentJson']),
              Query.limit(100),
            ],
          });
          blocks = blocksResult.rows.map((block) => ({
            blockType: block.blockType as string,
            content: (() => {
              try { return JSON.parse(block.contentJson as string); }
              catch { return { bmc: '', lean: '' }; }
            })(),
          }));
        } catch (error) {
          console.error(`[export] block fetch failed for canvas ${canvas.$id}:`, error);
        }
        const c = canvas as Record<string, unknown>;
        return {
          title: c.title as string,
          slug: c.slug as string,
          createdAt: c.createdAt as string,
          updatedAt: canvas.$updatedAt,
          blocks,
        };
      })
    );

    return NextResponse.json({
      user: { name: user.name || '', email: user.email },
      canvases,
      exportDate: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
