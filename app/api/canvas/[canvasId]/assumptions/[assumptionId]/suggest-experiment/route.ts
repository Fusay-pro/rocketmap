import { generateTextWithLogging } from '@/lib/ai/logger';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/appwrite-server';
import { recordAiUsage, getAiApiKeyFromUser } from '@/lib/ai/user-preferences';
import { getModelForPurpose, getModelIdForPurpose } from '@/lib/ai/models';
import { buildSystemPrompt } from '@/lib/ai/prompts';
import { getCanvasBlocks } from '@/lib/ai/canvas-state';
import { serverTablesDB, DATABASE_ID, ASSUMPTIONS_TABLE_ID } from '@/lib/appwrite';
import { verifyCanvasOwnership, verifyAssumptionBelongsToCanvas, isForbiddenError } from '@/lib/utils';
import { checkAiQuota, createQuotaExceededResponse } from '@/lib/ai/quota';

interface RouteContext {
  params: Promise<{ canvasId: string; assumptionId: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth();
    const quota = await checkAiQuota(user);
    if (!quota.allowed) {
      return createQuotaExceededResponse(quota);
    }
    const { canvasId, assumptionId } = await context.params;
    await verifyCanvasOwnership(canvasId, user.$id);
    await verifyAssumptionBelongsToCanvas(canvasId, assumptionId);

    const assumptionRow = await serverTablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: ASSUMPTIONS_TABLE_ID,
      rowId: assumptionId,
    });

    const assumptionText = assumptionRow.assumptionText as string;

    const blocks = await getCanvasBlocks(canvasId, user.$id);
    const systemPrompt = buildSystemPrompt('general', blocks);

    const { result } = await generateTextWithLogging('suggest-experiment', {
      model: getModelForPurpose('fast', getAiApiKeyFromUser(user)),
      system: systemPrompt,
      prompt: `Suggest the cheapest and fastest experiment to validate this assumption:

"${assumptionText}"

Prioritize free/low-cost methods ($0-$100), short timelines (days to weeks), actionable steps, and measurable success criteria.

Return ONLY valid JSON (no markdown, no explanation):
{
  "experimentType": "survey|interview|mvp|ab_test|research|other",
  "description": "step-by-step instructions",
  "successCriteria": "how to know if validated (specific, measurable)",
  "successThreshold": "numeric or observable threshold that decides pass/fail",
  "costEstimate": "$0",
  "durationEstimate": "1 week",
  "reasoning": "why this is cheapest/fastest method"
}`,
    }, {
      onUsage: (usageData) => recordAiUsage(user.$id, 'suggest-experiment', usageData, {
        canvasId,
        model: getModelIdForPurpose('fast'),
      }),
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Model did not return valid JSON');
    const obj = JSON.parse(jsonMatch[0]) as {
      experimentType: string;
      description: string;
      successCriteria: string;
      successThreshold?: string;
      costEstimate: string;
      durationEstimate: string;
      reasoning: string;
    };

    return NextResponse.json(obj);
  } catch (error) {
    if (isForbiddenError(error)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Error suggesting experiment:', error);
    return NextResponse.json({ error: 'Failed to suggest experiment' }, { status: 500 });
  }
}
