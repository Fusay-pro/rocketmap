import { stepCountIs, convertToModelMessages } from 'ai';
import { Query } from 'node-appwrite';
import { streamTextWithLogging } from '@/lib/ai/logger';
import { requireAuth } from '@/lib/appwrite-server';
import {
  serverTablesDB,
  DATABASE_ID,
  ASSUMPTIONS_TABLE_ID,
} from '@/lib/appwrite';
import { getCanvasBlocks } from '@/lib/ai/canvas-state';
import { getAgentConfig } from '@/lib/ai/agents';
import { getToolsForAgent } from '@/lib/ai/tools';
import { saveChatMessage } from '@/lib/ai/chat-persistence';
import type { AssumptionContext } from '@/lib/ai/prompts';
import type { BlockType } from '@/lib/types/canvas';
import { recordAiUsage, getAiApiKeyFromUser } from '@/lib/ai/user-preferences';
import { getModelForPurpose, getModelIdForPurpose } from '@/lib/ai/models';
import { checkAiQuota, createQuotaExceededResponse } from '@/lib/ai/quota';

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const quota = await checkAiQuota(user);
    if (!quota.allowed) {
      return createQuotaExceededResponse(quota);
    }
    const { canvasId } = await context.params;
    const { messages, chatKey, persistAssistant = true } = await request.json() as {
      messages: Parameters<typeof convertToModelMessages>[0];
      chatKey?: string;
      persistAssistant?: boolean;
    };

    const blocks = await getCanvasBlocks(canvasId, user.$id);

    // Load tracked assumptions for richer consistency checking context
    let assumptions: AssumptionContext[] = [];
    try {
      const assumptionsResult = await serverTablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: ASSUMPTIONS_TABLE_ID,
        queries: [
          Query.equal('canvas', canvasId),
          Query.limit(200),
        ],
      });
      assumptions = assumptionsResult.rows.map((row: Record<string, unknown>) => {
        let blockTypes: string[] = [];
        if (Array.isArray(row.blocks)) {
          blockTypes = (row.blocks as Array<{ blockType?: string }>)
            .map(b => b.blockType as BlockType)
            .filter(Boolean);
        }
        return {
          statement: (row.assumptionText as string) ?? '',
          status: (row.status as string) ?? 'untested',
          riskLevel: (row.riskLevel as string) ?? 'medium',
          confidenceScore: (row.confidenceScore as number) ?? 0,
          blockTypes,
          decisionSignal: (row.decisionSignal as string) ?? undefined,
        };
      });
    } catch {
      // Non-critical: continue without assumption context
    }

    const config = getAgentConfig('general', blocks, assumptions);
    const tools = getToolsForAgent(config.toolNames);

    const modelMessages = await convertToModelMessages(messages);
    const modelId = getModelIdForPurpose('reasoning');

    const result = streamTextWithLogging('canvas-chat', {
      model: getModelForPurpose('reasoning', getAiApiKeyFromUser(user)),
      system: config.systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(3),
    }, {
      onUsage: (usage) => recordAiUsage(user.$id, 'canvas-chat', usage, { canvasId, model: modelId }),
    });

    if (persistAssistant) {
      // Save assistant response (text + tool results with args) after stream completes
      Promise.resolve(result.steps).then((steps) => {
        const parts: Array<Record<string, unknown>> = [];
        for (const step of steps) {
          if (step.text) parts.push({ type: 'text', text: step.text });
          // Build a map of toolCallId → args from tool calls
          const argsMap = new Map<string, unknown>();
          for (const tc of step.toolCalls) {
            const call = tc as unknown as { toolCallId: string; args: unknown };
            argsMap.set(call.toolCallId, call.args);
          }
          for (const tc of step.toolResults) {
            const tr = tc as unknown as { toolName: string; toolCallId: string; result: unknown };
            parts.push({
              type: 'tool-result',
              toolName: tr.toolName,
              toolCallId: tr.toolCallId,
              args: argsMap.get(tr.toolCallId) ?? {},
              result: tr.result,
            });
          }
        }
        if (parts.length > 0) {
          saveChatMessage(canvasId, chatKey || 'general', user.$id, {
            messageId: `assistant-${Date.now()}`,
            role: 'assistant',
            content: JSON.stringify({ parts }),
          }).catch((err) => console.error('[chat-persist] Failed to save assistant message:', err));
        }
      }).catch(() => {});
    }

    return result.toUIMessageStreamResponse();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
