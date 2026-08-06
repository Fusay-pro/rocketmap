import { stepCountIs, convertToModelMessages } from 'ai';
import { streamTextWithLogging } from '@/lib/ai/logger';
import { requireAuth } from '@/lib/appwrite-server';
import { getCanvasBlocks } from '@/lib/ai/canvas-state';
import { getAgentConfig } from '@/lib/ai/agents';
import { getToolsForAgent } from '@/lib/ai/tools';
import { saveChatMessage } from '@/lib/ai/chat-persistence';
import type { BlockType } from '@/lib/types/canvas';
import { recordAiUsage, getAiApiKeyFromUser } from '@/lib/ai/user-preferences';
import { getModelForPurpose, getModelIdForPurpose } from '@/lib/ai/models';
import { checkAiQuota, createQuotaExceededResponse } from '@/lib/ai/quota';

interface RouteContext {
  params: Promise<{ canvasId: string; blockType: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const quota = await checkAiQuota(user);
    if (!quota.allowed) {
      return createQuotaExceededResponse(quota);
    }
    const { canvasId, blockType } = await context.params;
    const { messages, chatKey } = await request.json();

    const blocks = await getCanvasBlocks(canvasId, user.$id);
    const config = getAgentConfig(blockType as BlockType, blocks);
    const tools = getToolsForAgent(config.toolNames);

    const modelMessages = await convertToModelMessages(messages);
    const modelId = getModelIdForPurpose('fast');

    const result = streamTextWithLogging(`block-chat:${blockType}`, {
      model: getModelForPurpose('fast', getAiApiKeyFromUser(user)),
      system: config.systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(3),
    }, {
      onUsage: (usage) => recordAiUsage(user.$id, `block-chat:${blockType}`, usage, { canvasId, model: modelId }),
    });

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
        saveChatMessage(canvasId, chatKey || blockType, user.$id, {
          messageId: `assistant-${Date.now()}`,
          role: 'assistant',
          content: JSON.stringify({ parts }),
        }).catch((err) => console.error('[chat-persist] Failed to save assistant message:', err));
      }
    }).catch(() => {});

    return result.toUIMessageStreamResponse();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
