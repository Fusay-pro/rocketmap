import { stepCountIs } from 'ai';
import { streamTextWithLogging } from '@/lib/ai/logger';
import { ID, Query } from 'node-appwrite';
import { requireAuth } from '@/lib/appwrite-server';
import {
  serverTablesDB,
  DATABASE_ID,
  BLOCKS_TABLE_ID,
  ASSUMPTIONS_TABLE_ID,
} from '@/lib/appwrite';
import { getCanvasBlocks } from '@/lib/ai/canvas-state';
import { getAgentConfig } from '@/lib/ai/agents';
import { getToolsForAgent } from '@/lib/ai/tools';
import type { BlockType } from '@/lib/types/canvas';
import { recordAiUsage, getAiApiKeyFromUser } from '@/lib/ai/user-preferences';
import { getModelForPurpose, getModelIdForPurpose } from '@/lib/ai/models';
import { checkAiQuota, createQuotaExceededResponse } from '@/lib/ai/quota';

interface RouteContext {
  params: Promise<{ canvasId: string; blockType: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const quota = await checkAiQuota(user);
    if (!quota.allowed) {
      return createQuotaExceededResponse(quota);
    }
    const { canvasId, blockType } = await context.params;
    console.log(`[analyze] canvasId=${canvasId} blockType=${blockType} userId=${user.$id}`);

    const blocks = await getCanvasBlocks(canvasId, user.$id);
    const config = getAgentConfig(blockType as BlockType, blocks);
    const tools = getToolsForAgent(config.toolNames);
    console.log(`[analyze] blocks loaded=${blocks.length} tools=[${Object.keys(tools).join(', ')}]`);

    const targetBlock = blocks.find((b) => b.blockType === blockType);
    let content = '';
    if (targetBlock) {
      const parts = [targetBlock.content.bmc, targetBlock.content.lean].filter(Boolean);
      if (targetBlock.content.items?.length) {
        for (const item of targetBlock.content.items) {
          parts.push(`• ${item.name}`);
        }
      }
      content = parts.join('\n').trim();
    }

    const result = streamTextWithLogging(
      `analyze:${blockType}`,
      {
        model: getModelForPurpose('reasoning', getAiApiKeyFromUser(user)),
        system: config.systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Analyze the "${blockType}" block. Current content: "${content || '(empty)'}". Use the analyzeBlock tool to provide your structured analysis. Also use the identifyAssumptions tool to extract hidden assumptions with risk levels.`,
          },
        ],
        tools,
        toolChoice: 'required',
        stopWhen: stepCountIs(3),
      },
      {
        onUsage: (usageData) => recordAiUsage(user.$id, `block-analyze:${blockType}`, usageData, {
          canvasId,
          model: getModelIdForPurpose('reasoning'),
        }),
      },
    );

    // Persist after the stream completes. The HTTP response is already
    // committed by then, so failures can only be logged — hence the loud,
    // structured logging inside.
    void persistBlockAnalysis(canvasId, blockType, result.steps, content);

    return result.toUIMessageStreamResponse();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Block analyze error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** Serialized analysis above this size gets its draft truncated rather than
 *  failing the write outright. Well under longtext, but a real ceiling. */
const MAX_ANALYSIS_JSON = 60000;

async function persistBlockAnalysis(
  canvasId: string,
  blockType: string,
  stepsPromise: PromiseLike<Awaited<ReturnType<typeof streamTextWithLogging>['steps']>>,
  content: string,
): Promise<void> {
  return Promise.resolve(stepsPromise).then(async (steps) => {
      let analysis: {
        draft: string;
        assumptions: string[];
        risks: string[];
        questions: string[];
        confidenceScore?: number;
        riskScore?: number;
      } = { draft: '', assumptions: [], risks: [], questions: [] };
      let identifiedAssumptions: Array<{
        statement: string;
        riskLevel: 'high' | 'medium' | 'low';
        reasoning: string;
        affectedBlocks: string[];
      }> = [];

      for (const step of steps) {
        for (const tc of step.toolResults) {
          if (tc.toolName === 'analyzeBlock') {
            const toolResult = (tc as unknown as { result: typeof analysis }).result;
            if (toolResult) analysis = toolResult;
          }
          if (tc.toolName === 'identifyAssumptions') {
            const res = (tc as unknown as { result: { assumptions: typeof identifiedAssumptions } }).result;
            identifiedAssumptions = res?.assumptions ?? [];
          }
        }
      }

      const aiConfidence = typeof analysis.confidenceScore === 'number' ? analysis.confidenceScore : null;
      const aiRisk = typeof analysis.riskScore === 'number' ? analysis.riskScore : null;
      const confidenceScore = aiConfidence !== null
        ? aiConfidence / 100
        : (content.length > 20 ? 0.4 : 0.2);
      const riskScore = aiRisk !== null
        ? aiRisk / 100
        : Math.min(1, analysis.risks.length * 0.15);

      // Ordered explicitly: the canvas page reads `docsForType[0]` as a
      // block's main content, so an unordered limit(1) could write the
      // analysis to a row that is never displayed.
      const existing = await serverTablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: BLOCKS_TABLE_ID,
        queries: [
          Query.equal('canvas', canvasId),
          Query.equal('blockType', blockType),
          Query.select(['$id']),
          Query.orderAsc('$id'),
          Query.limit(1),
        ],
      });

      let payload = { ...analysis, generatedAt: new Date().toISOString() };
      let aiAnalysisJson = JSON.stringify(payload);
      if (aiAnalysisJson.length > MAX_ANALYSIS_JSON) {
        console.warn(
          `[analyze-persist] payload ${aiAnalysisJson.length}b exceeds ${MAX_ANALYSIS_JSON}b for blockType=${blockType} — truncating draft`,
        );
        payload = { ...payload, draft: payload.draft.slice(0, 4000) };
        aiAnalysisJson = JSON.stringify(payload);
      }

      if (existing.rows.length === 0) {
        console.warn(
          `[analyze-persist] no block row for canvas=${canvasId} blockType=${blockType} — analysis discarded`,
        );
      } else {
        try {
          await serverTablesDB.updateRow({
            databaseId: DATABASE_ID,
            tableId: BLOCKS_TABLE_ID,
            rowId: existing.rows[0].$id,
            data: { aiAnalysisJson, confidenceScore, riskScore },
          });
          console.log(
            `[analyze-persist] saved blockType=${blockType} bytes=${aiAnalysisJson.length} ` +
              `assumptions=${analysis.assumptions.length} risks=${analysis.risks.length} questions=${analysis.questions.length}`,
          );
        } catch (err) {
          // `type` is the field that identifies this class of failure
          // (document_invalid_structure = the column is too small); a bare
          // console.error on an AppwriteException buries it.
          const e = err as { code?: number; type?: string; message?: string };
          console.error(
            `[analyze-persist] updateRow FAILED blockType=${blockType} bytes=${aiAnalysisJson.length} ` +
              `code=${e?.code} type=${e?.type} message=${e?.message}`,
          );
          throw err;
        }
      }

      if (identifiedAssumptions.length > 0) {
        const blocksLookup = await serverTablesDB.listRows({
          databaseId: DATABASE_ID,
          tableId: BLOCKS_TABLE_ID,
          queries: [
            Query.equal('canvas', canvasId),
            Query.select(['$id', 'blockType']),
            Query.limit(100),
          ],
        });
        const blockIdMap = new Map<string, string>();
        for (const doc of blocksLookup.rows) {
          blockIdMap.set(doc.blockType as string, doc.$id as string);
        }

        const now = new Date().toISOString();
        await Promise.allSettled(
          identifiedAssumptions.map((assumption) => {
            const affectedBlockIds = assumption.affectedBlocks
              .map((bt) => blockIdMap.get(bt))
              .filter((id): id is string => !!id);
            const severityScore = assumption.riskLevel === 'high' ? 8 : assumption.riskLevel === 'medium' ? 5 : 2;

            return serverTablesDB.createRow({
              databaseId: DATABASE_ID,
              tableId: ASSUMPTIONS_TABLE_ID,
              rowId: ID.unique(),
              data: {
                canvas: canvasId,
                assumptionText: assumption.statement,
                category: 'product',
                status: 'untested',
                riskLevel: assumption.riskLevel,
                severityScore,
                confidenceScore: 0,
                source: 'ai',
                segmentIds: JSON.stringify([]),
                linkedValidationItemIds: JSON.stringify([]),
                createdAt: now,
                updatedAt: now,
                ...(affectedBlockIds.length > 0 ? { blocks: affectedBlockIds } : {}),
              },
            });
          }),
        );
      }
    }).catch((err) => {
      const e = err as { code?: number; type?: string; message?: string };
      console.error(
        `[analyze-persist] Failed to save analysis for blockType=${blockType}: ` +
          `code=${e?.code} type=${e?.type} message=${e?.message ?? String(err)}`,
      );
    });
}
