import { NextResponse } from "next/server";
import { Query } from "node-appwrite";
import { generateTextWithLogging } from '@/lib/ai/logger';
import { requireAuth } from "@/lib/appwrite-server";
import { getUserIdFromCanvas } from "@/lib/utils";
import {
  serverTablesDB,
  DATABASE_ID,
  CANVASES_TABLE_ID,
  ASSUMPTIONS_TABLE_ID,
} from "@/lib/appwrite";
import { getCanvasBlocks } from "@/lib/ai/canvas-state";
import { getViabilityPrompt } from "@/lib/ai/prompts";
import { recordAiUsage, getAiApiKeyFromUser } from "@/lib/ai/user-preferences";
import { getModelForPurpose, getModelIdForPurpose } from "@/lib/ai/models";
import { checkAiQuota, createQuotaExceededResponse } from '@/lib/ai/quota';
import { parseAssumptionRow } from "@/lib/utils/assumptions";
import { mergeUnlockStepsWithAssumptions } from "@/lib/utils/viability";
import type {
  Assumption,
  BlockData,
  BlockType,
  CanvasData,
  ViabilityData,
  ViabilityUnlockStep,
} from "@/lib/types/canvas";

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

function getSegmentsText(block: BlockData): string {
  if (block.blockType !== "customer_segments" || !block.linkedSegments?.length) {
    return "";
  }

  return block.linkedSegments
    .map((segment) =>
      [
        segment.name,
        segment.description,
        segment.demographics,
        segment.psychographics,
        segment.behavioral,
        segment.geographic,
        segment.estimatedSize,
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" | "),
    )
    .filter((line) => line.length > 0)
    .join(" \n");
}

function getBlockViabilityText(block: BlockData): string {
  const baseText = block.content.bmc || block.content.lean || "";
  const segmentText = getSegmentsText(block);

  if (block.blockType === "customer_segments" && segmentText.length > 0) {
    return `${baseText}\n${segmentText}`.trim();
  }

  return baseText;
}

function buildUnlockSteps(
  rawSteps: Array<{
    assumptionId: string;
    suggestedTest: string;
  }>,
  assumptions: Assumption[],
): ViabilityUnlockStep[] {
  const byId = new Map(assumptions.map((a) => [a.$id, a]));

  return rawSteps
    .filter((step) => byId.has(step.assumptionId))
    .map((step) => {
      const assumption = byId.get(step.assumptionId)!;
      return {
        assumptionId: step.assumptionId,
        assumption: assumption.statement,
        blockTypes: assumption.blockTypes,
        riskLevel: assumption.riskLevel,
        status: assumption.status,
        suggestedTest: step.suggestedTest,
      };
    });
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const quota = await checkAiQuota(user);
    if (!quota.allowed) {
      return createQuotaExceededResponse(quota);
    }
    const { canvasId } = await context.params;

    const canvas = await serverTablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: CANVASES_TABLE_ID,
      rowId: canvasId,
      queries: [],
    });

    if (getUserIdFromCanvas(canvas as unknown as CanvasData) !== user.$id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [blocks, assumptionsResult] = await Promise.all([
      getCanvasBlocks(canvasId, user.$id),
      serverTablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: ASSUMPTIONS_TABLE_ID,
        queries: [Query.equal("canvas", canvasId), Query.limit(200)],
      }),
    ]);

    const assumptions = assumptionsResult.rows.map((row) =>
      parseAssumptionRow(row as unknown as Record<string, unknown>),
    );

    if (blocks.length < 9) {
      return NextResponse.json({ error: "All 9 blocks must exist" }, { status: 400 });
    }

    const totalContent = blocks.reduce(
      (sum, b) => sum + getBlockViabilityText(b).trim().length,
      0,
    );
    if (totalContent < 50) {
      return NextResponse.json(
        { error: "Canvas needs more content before calculating viability" },
        { status: 400 },
      );
    }

    const { result, usage } = await generateTextWithLogging('viability', {
      model: getModelForPurpose('fast', getAiApiKeyFromUser(user)),
      temperature: 0.3,
      prompt: getViabilityPrompt(blocks, assumptions),
    }, {
      onUsage: (usageData) => recordAiUsage(user.$id, 'viability', usageData, {
        canvasId,
        model: getModelIdForPurpose('fast'),
      }),
    });

    const text = result.text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Model did not return valid JSON");
    }

    const obj = JSON.parse(jsonMatch[0]) as {
      reasoning?: string;
      verdict?: string;
      factorsUp?: string[];
      factorsDown?: string[];
      ceiling?: string;
      whatAbout?: string;
      validatedAssumptions?: Array<{
        blockType: string;
        assumption: string;
        status: "validated" | "invalidated" | "untested";
        evidence: string;
      }>;
      unlockSteps?: Array<{
        assumptionId: string;
        suggestedTest: string;
      }>;
    };

    const unlockSteps = buildUnlockSteps(obj.unlockSteps ?? [], assumptions);
    const mergedSteps = mergeUnlockStepsWithAssumptions(unlockSteps, assumptions);

    const reasoning = obj.reasoning ?? obj.verdict ?? "";

    // No composite score: the verdict is factors, questions, and unlock steps.
    // Q/PTP counts and badge state derive from those (evidence-counts.ts).
    const viabilityData: ViabilityData = {
      reasoning,
      verdict: obj.verdict ?? reasoning,
      factorsUp: obj.factorsUp ?? [],
      factorsDown: obj.factorsDown ?? [],
      ceiling: obj.ceiling ?? "",
      whatAbout: obj.whatAbout ?? "",
      unlockSteps: mergedSteps,
      validatedAssumptions: (obj.validatedAssumptions ?? []).map((item) => ({
        ...item,
        blockType: item.blockType as BlockType,
      })),
      calculatedAt: new Date().toISOString(),
    };

    await serverTablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: CANVASES_TABLE_ID,
      rowId: canvasId,
      data: {
        // viabilityScore column intentionally no longer written; kept in the
        // Appwrite schema so existing rows need no migration.
        viabilityDataJson: JSON.stringify(viabilityData),
        viabilityCalculatedAt: viabilityData.calculatedAt,
      },
    });

    return NextResponse.json({ viability: viabilityData });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Viability calculation error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
