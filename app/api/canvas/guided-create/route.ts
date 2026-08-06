import { stepCountIs, convertToModelMessages } from 'ai';
import { streamTextWithLogging } from '@/lib/ai/logger';
import { requireAuth } from '@/lib/appwrite-server';
import { getToolsForAgent, createGenerateCanvasTool } from '@/lib/ai/tools';
import { ONBOARDING_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { recordAiUsage, getAiApiKeyFromUser } from '@/lib/ai/user-preferences';
import { getModelForPurpose, getModelIdForPurpose } from '@/lib/ai/models';
import { checkAiQuota, createQuotaExceededResponse } from '@/lib/ai/quota';

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const quota = await checkAiQuota(user);
    if (!quota.allowed) {
      return createQuotaExceededResponse(quota);
    }
    const { messages } = await request.json();

    // Use the server-side factory so the tool creates the canvas in Appwrite
    const serverGenerateCanvas = createGenerateCanvasTool(user.$id);
    const tools = getToolsForAgent(['generateCanvas'], {
      generateCanvas: serverGenerateCanvas,
    });
    const modelMessages = await convertToModelMessages(messages);

    // Count user messages from both raw UIMessages and converted model messages
    const rawUserCount = Array.isArray(messages)
      ? messages.filter((m: { role: string }) => m.role === 'user').length
      : 0;
    const modelUserCount = modelMessages.filter(
      (m) => m.role === 'user',
    ).length;

    const shouldForceTool = rawUserCount >= 3 || modelUserCount >= 3;

    console.log(
      `[AI] guided-create | rawUserCount=${rawUserCount}, modelUserCount=${modelUserCount}, forceTool=${shouldForceTool}`,
    );
    const modelId = getModelIdForPurpose('fast');

    const result = streamTextWithLogging('guided-create', {
      model: getModelForPurpose('fast', getAiApiKeyFromUser(user)),
      system: shouldForceTool
        ? ONBOARDING_SYSTEM_PROMPT + '\n\nYou have enough information. You MUST call generateCanvas now.'
        : ONBOARDING_SYSTEM_PROMPT,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(1),
    }, {
      onUsage: (usage) => recordAiUsage(user.$id, 'guided-create', usage, { model: modelId }),
    });

    return result.toUIMessageStreamResponse();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: message === 'Unauthorized' ? 401 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
