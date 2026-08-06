import { generateTextWithLogging } from '@/lib/ai/logger';
import { ID, Query } from 'node-appwrite';
import { requireAuth } from '@/lib/appwrite-server';
import {
  serverTablesDB,
  DATABASE_ID,
  ASSUMPTIONS_TABLE_ID,
  BLOCKS_TABLE_ID,
} from '@/lib/appwrite';
import { getCanvasBlocks } from '@/lib/ai/canvas-state';
import { buildSystemPrompt } from '@/lib/ai/prompts';
import { recordAiUsage, getAiApiKeyFromUser } from '@/lib/ai/user-preferences';
import { getModelForPurpose, getModelIdForPurpose } from '@/lib/ai/models';
import { checkAiQuota, createQuotaExceededResponse } from '@/lib/ai/quota';

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}


function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(_request: Request, context: RouteContext) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(sseEvent(data))); } catch { /* closed */ }
      };

      try {
        const user = await requireAuth();
        const quota = await checkAiQuota(user);
        if (!quota.allowed) {
          send({ type: 'error', error: 'Daily AI budget exceeded', quota });
          controller.close();
          return;
        }
        const { canvasId } = await context.params;

        send({ type: 'step', step: 'loading' });

        // Load canvas blocks (validates canvas exists)
        const blocks = await getCanvasBlocks(canvasId, user.$id);
        const systemPrompt = buildSystemPrompt('general', blocks);

        send({ type: 'step', step: 'analyzing' });

        const { result, usage } = await generateTextWithLogging('assumptions-analyze', {
          model: getModelForPurpose('reasoning', getAiApiKeyFromUser(user)),
          system: systemPrompt,
          prompt: `Analyze this entire business model canvas and extract ALL hidden assumptions the founder is making. Focus on:

- Market assumptions (target customers exist, willingness to pay, market size claims)
- Product assumptions (technical feasibility, value delivery, competitive advantage)
- Operational assumptions (resource availability, scalability, partnerships, timelines)
- Legal/regulatory assumptions (compliance, IP protection, contracts)

For each assumption:
- Make it specific and testable (not vague)
- Link it to the relevant block types (use exact block type keys like "customer_segments", "value_prop", etc.)
- Score severity 0-10 based on impact if the assumption is wrong (10 = catastrophic)

Return ONLY valid JSON (no markdown, no explanation):
{
  "reasoning": "step-by-step reasoning about the canvas",
  "assumptions": [
    {
      "statement": "clear testable assumption",
      "category": "market|product|ops|legal",
      "severityScore": 7,
      "blockTypes": ["customer_segments"]
    }
  ]
}`,
        }, {
          onUsage: (usageData) => recordAiUsage(user.$id, 'assumptions-analyze', usageData, {
            canvasId,
            model: getModelIdForPurpose('reasoning'),
          }),
        });

        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('Model did not return valid JSON');
        const object = JSON.parse(jsonMatch[0]) as {
          reasoning?: string;
          assumptions: Array<{ statement: string; category: 'market' | 'product' | 'ops' | 'legal'; severityScore: number; blockTypes: string[] }>;
        };

        console.log(`[assumptions] Generated ${object.assumptions.length} assumptions, tokens: ${(usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)}`);

        if (object.reasoning) {
          send({ type: 'thinking', text: object.reasoning });
        }

        const extracted = object.assumptions;
        send({ type: 'step', step: 'saving', count: extracted.length });

        // Build block type → $id lookup for relationships
        const blockIdMap = new Map<string, string>();
        const blockDocsRes = await serverTablesDB.listRows({
          databaseId: DATABASE_ID,
          tableId: BLOCKS_TABLE_ID,
          queries: [
            Query.equal('canvas', canvasId),
            Query.select(['$id', 'blockType']),
            Query.limit(100),
          ],
        });
        for (const doc of blockDocsRes.rows) {
          blockIdMap.set(doc.blockType as string, doc.$id as string);
        }

        // Persist each assumption to Appwrite
        const created = [];
        for (const assumption of extracted) {
          const blockIds = assumption.blockTypes
            .map((bt) => blockIdMap.get(bt))
            .filter((id): id is string => !!id);

          try {
            const riskLevel = assumption.severityScore >= 7 ? 'high' : assumption.severityScore >= 4 ? 'medium' : 'low';

            const doc = await serverTablesDB.createRow({
              databaseId: DATABASE_ID,
              tableId: ASSUMPTIONS_TABLE_ID,
              rowId: ID.unique(),
              data: {
                canvas: canvasId,
                assumptionText: assumption.statement,
                category: assumption.category,
                status: 'untested',
                riskLevel,
                severityScore: assumption.severityScore,
                ...(blockIds.length > 0 ? { blocks: blockIds } : {}),
              },
            });

            created.push({
              $id: doc.$id,
              statement: assumption.statement,
              category: assumption.category,
              severityScore: assumption.severityScore,
              status: 'untested' as const,
              blockTypes: assumption.blockTypes,
            });
          } catch (err) {
            console.error('Failed to persist assumption:', err);
          }
        }

        send({ type: 'done', assumptions: created });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Assumptions analyze error:', message);
        send({ type: 'error', error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
