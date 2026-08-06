import { NextResponse } from 'next/server';
import { stepCountIs } from 'ai';
import { generateTextWithLogging } from '@/lib/ai/logger';
import { Query } from 'node-appwrite';
import { requireAuth } from '@/lib/appwrite-server';
import {
  serverTablesDB,
  DATABASE_ID,
  CANVASES_TABLE_ID,
  BLOCKS_TABLE_ID,
} from '@/lib/appwrite';
import { getCanvasBlocks } from '@/lib/ai/canvas-state';
import { getToolsForAgent } from '@/lib/ai/tools';
import { buildDeepDivePrompt, getDeepDiveToolName } from '@/lib/ai/prompts';
import type { DeepDiveModule, MarketResearchData, UnitEconomicsData, CanvasData } from '@/lib/types/canvas';
import { recordAiUsage, getAiApiKeyFromUser } from '@/lib/ai/user-preferences';
import { getModelForPurpose, getModelIdForPurpose } from '@/lib/ai/models';
import { checkAiQuota, createQuotaExceededResponse } from '@/lib/ai/quota';
import { getUserIdFromCanvas } from '@/lib/utils';

interface RouteContext {
  params: Promise<{ canvasId: string; blockType: string }>;
}

const VALID_MODULES: DeepDiveModule[] = [
  'tam_sam_som',
  'segmentation',
  'personas',
  'market_validation',
  'competitive_landscape',
  'segment_scoring',
  'segment_comparison',
  'segment_profile',
  'jtbd',
  'value_product',
  'revenue_pricing',
  'unit_economics',
  'sensitivity_analysis',
];

// POST — AI generation for a specific deep-dive module
export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const quota = await checkAiQuota(user);
    if (!quota.allowed) {
      return createQuotaExceededResponse(quota);
    }
    const { canvasId, blockType } = await context.params;
    const { module, inputs } = (await request.json()) as {
      module: DeepDiveModule;
      inputs: Record<string, string>;
    };
    console.log(`[deep-dive] canvasId=${canvasId} blockType=${blockType} module=${module}`);

    if (!VALID_MODULES.includes(module)) {
      return NextResponse.json({ error: 'Invalid module' }, { status: 400 });
    }

    const blocks = await getCanvasBlocks(canvasId, user.$id);
    const targetBlock = blocks.find((b) => b.blockType === blockType);
    const existingDeepDive = targetBlock?.deepDiveData ?? null;
    console.log(`[deep-dive] blocks=${blocks.length} targetBlock found=${!!targetBlock} existingDeepDive=${!!existingDeepDive}`);

    const systemPrompt = buildDeepDivePrompt(module, blocks, existingDeepDive, inputs);
    const toolName = getDeepDiveToolName(module);

    // Add searchWeb for modules that need real-world market data
    const toolNames = [toolName];
    const searchModules: DeepDiveModule[] = [
      'tam_sam_som',
      'market_validation',
      'competitive_landscape',
      'value_product',
      'revenue_pricing',
    ];
    if (searchModules.includes(module)) {
      toolNames.push('searchWeb');
    }

    const tools = getToolsForAgent(toolNames);

    const content = targetBlock
      ? `${targetBlock.content.bmc}\n${targetBlock.content.lean}`.trim()
      : '';

    // Build module-specific user message
    let userMessage: string;
    if (module === 'segment_scoring') {
      const name = inputs?.segmentName || '(unnamed)';
      const desc = inputs?.segmentDescription || '';
      const demo = inputs?.demographics || '';
      const psych = inputs?.psychographics || '';
      const behav = inputs?.behavioral || '';
      const geo = inputs?.geographic || '';
      const segDetail = [
        `Segment: "${name}"`,
        desc && `Description: ${desc}`,
        demo && `Demographics: ${demo}`,
        psych && `Psychographics: ${psych}`,
        behav && `Behavioral: ${behav}`,
        geo && `Geographic: ${geo}`,
      ].filter(Boolean).join('\n');
      // Include profile data if available
      const segId = inputs?.segmentId;
      const profile = segId ? existingDeepDive?.segmentProfiles?.[segId] : undefined;
      let profileDetail = '';
      if (profile) {
        const md = profile.marketDefinition;
        const bs = profile.buyerStructure;
        profileDetail = [
          '\n\nMarket Definition:',
          md.geography && `  Geography: ${md.geography}`,
          md.businessType && `  Business Type: ${md.businessType}`,
          md.sizeBucket && `  Size Bucket: ${md.sizeBucket}`,
          md.estimatedCount && `  Estimated Count: ${md.estimatedCount}`,
          '\nBuyer Structure:',
          bs.economicBuyer && `  Economic Buyer: ${bs.economicBuyer}`,
          bs.user && `  Day-to-day User: ${bs.user}`,
          bs.decisionCycle && `  Decision Cycle: ${bs.decisionCycle}`,
          bs.budgetOwnership && `  Budget Ownership: ${bs.budgetOwnership}`,
        ].filter(Boolean).join('\n');
      }
      userMessage = `Score the following customer segment using the scoreSegment tool.\n\n${segDetail}${profileDetail}\n\nBlock content for context: "${content || '(empty)'}"`;
    } else if (module === 'segment_profile') {
      const name = inputs?.segmentName || '(unnamed)';
      const desc = inputs?.segmentDescription || '';
      userMessage = `Suggest a market definition and buyer structure profile for the customer segment "${name}". ${desc ? `Description: ${desc}` : ''}\n\nUse the suggestSegmentProfile tool to return your structured profile.\n\nBlock content for context: "${content || '(empty)'}"`;
    } else if (module === 'segment_comparison') {
      userMessage = `Compare these two customer segments using the compareSegments tool.\n\nSegment A: "${inputs?.segmentAName || '(unnamed)'}" — ${inputs?.segmentADescription || '(no description)'}\nSegment B: "${inputs?.segmentBName || '(unnamed)'}" — ${inputs?.segmentBDescription || '(no description)'}\n\nBlock content for context: "${content || '(empty)'}"`;
    } else if (module === 'unit_economics') {
      userMessage = `Estimate unit economics for all customer segments. Use the estimateUnitEconomics tool to return your structured analysis with ARPU, CAC, LTV, gross margin, payback period, and churn rate per segment. Flag any impossible economics (CAC > LTV, negative margins). Monthly burn: ${inputs?.monthlyBurn || 'not provided'}. Block content for context: "${content || '(empty)'}"`;
    } else if (module === 'sensitivity_analysis') {
      userMessage = `Run sensitivity analysis: What happens if ${inputs?.parameter || 'churn_rate'} changes by ${inputs?.deltaPct || '20'}%? Use the runSensitivityAnalysis tool to return your structured analysis. Block content for context: "${content || '(empty)'}"`;
    } else if (module === 'jtbd') {
      userMessage = `Generate structured jobs-to-be-done, customer role split, and pain types for the "${blockType}" block. Use the generateJTBD tool. Current content: "${content || '(empty)'}".`;
    } else if (module === 'value_product') {
      userMessage = `Map the value proposition into per-role value promises, positioning, and pain -> outcome -> feature -> proof metric rows. Use the mapValueProduct tool. Current content: "${content || '(empty)'}".`;
    } else if (module === 'revenue_pricing') {
      userMessage = `Design per-segment revenue models, payment moments, price points, and paid WTP tests. Use the designRevenuePricing tool. Current content: "${content || '(empty)'}".`;
    } else {
      userMessage = `Perform a deep-dive analysis for the "${blockType}" block. Current content: "${content || '(empty)'}". Use the ${toolName} tool to return your structured analysis.`;
    }

    const { result, usage } = await generateTextWithLogging(
      `deep-dive:${module}`,
      {
        model: getModelForPurpose('reasoning', getAiApiKeyFromUser(user)),
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools,
        toolChoice: { type: 'tool', toolName },
        stopWhen: stepCountIs(3),
      },
      {
        onUsage: (usageData) => recordAiUsage(user.$id, `deep-dive:${blockType}`, usageData, {
          canvasId,
          model: getModelIdForPurpose('reasoning'),
        }),
      },
    );

    // Extract tool result
    let toolResult: unknown = null;
    for (const step of result.steps) {
      for (const tc of step.toolResults) {
        if (tc.toolName === toolName) {
          toolResult = (tc as unknown as { result: unknown }).result;
        }
      }
    }

    const allToolCalls = result.steps.flatMap(s => s.toolResults.map(tc => tc.toolName));
    console.log(`[deep-dive] AI done. steps=${result.steps.length} tools called=[${allToolCalls.join(', ')}] toolResult found=${!!toolResult}`);

    if (!toolResult) {
      console.error(`[deep-dive] No tool result for ${toolName}. text: "${result.text?.slice(0, 200) ?? '(none)'}"`);
      return NextResponse.json({ error: 'AI did not produce a result' }, { status: 500 });
    }

    // Merge into existing deep-dive data
    const updatedDeepDive: MarketResearchData = {
      tamSamSom: existingDeepDive?.tamSamSom ?? null,
      segmentation: existingDeepDive?.segmentation ?? null,
      personas: existingDeepDive?.personas ?? null,
      marketValidation: existingDeepDive?.marketValidation ?? null,
      competitiveLandscape: existingDeepDive?.competitiveLandscape ?? null,
      jtbd: existingDeepDive?.jtbd ?? null,
      valueProduct: existingDeepDive?.valueProduct ?? null,
      revenuePricing: existingDeepDive?.revenuePricing ?? null,
      scorecards: existingDeepDive?.scorecards,
      segmentProfiles: existingDeepDive?.segmentProfiles,
      unitEconomics: existingDeepDive?.unitEconomics,
    };

    // Map module to the correct field
    switch (module) {
      case 'tam_sam_som': {
        const r = toolResult as { tam: unknown; sam: unknown; som: unknown; reasoning: string };
        updatedDeepDive.tamSamSom = {
          industry: inputs?.industry ?? '',
          geography: inputs?.geography ?? '',
          targetCustomerType: inputs?.targetCustomerType ?? '',
          tam: r.tam as MarketResearchData['tamSamSom'] extends { tam: infer T } ? T : never,
          sam: r.sam as MarketResearchData['tamSamSom'] extends { sam: infer T } ? T : never,
          som: r.som as MarketResearchData['tamSamSom'] extends { som: infer T } ? T : never,
          reasoning: r.reasoning,
        };
        break;
      }
      case 'segmentation':
        updatedDeepDive.segmentation = toolResult as MarketResearchData['segmentation'];
        break;
      case 'personas':
        updatedDeepDive.personas = toolResult as MarketResearchData['personas'];
        break;
      case 'market_validation':
        updatedDeepDive.marketValidation = toolResult as MarketResearchData['marketValidation'];
        break;
      case 'competitive_landscape':
        updatedDeepDive.competitiveLandscape = toolResult as MarketResearchData['competitiveLandscape'];
        break;
      case 'segment_scoring': {
        const scoreResult = toolResult as {
          criteria: MarketResearchData extends { scorecards?: Array<infer S> } ? S extends { criteria: infer C } ? C : never : never;
          overallScore: number;
          recommendation: 'pursue' | 'test' | 'defer';
          reasoning: string;
          keyRisks: string[];
          requiredExperiments: string[];
        };
        const segmentId = inputs?.segmentId || '';
        // Compute data confidence from deep-dive completeness
        let dataConfidence = 20; // base
        if (updatedDeepDive.tamSamSom?.tam) dataConfidence += 20;
        if (updatedDeepDive.segmentation?.segments.length) dataConfidence += 20;
        if (updatedDeepDive.competitiveLandscape?.competitors.length) dataConfidence += 20;
        if (updatedDeepDive.marketValidation?.validations.length) dataConfidence += 20;

        const newScorecard = {
          segmentId,
          beachheadStatus: (scoreResult.recommendation === 'pursue' ? 'primary' : scoreResult.recommendation === 'test' ? 'secondary' : 'later') as 'primary' | 'secondary' | 'later',
          arpu: inputs?.arpu ? Number(inputs.arpu) : null,
          revenuePotential: null,
          criteria: scoreResult.criteria,
          overallScore: scoreResult.overallScore,
          aiRecommendation: scoreResult.recommendation,
          aiReasoning: scoreResult.reasoning,
          keyRisks: scoreResult.keyRisks,
          requiredExperiments: scoreResult.requiredExperiments,
          dataConfidence,
          lastUpdated: new Date().toISOString(),
        };
        // Upsert: replace existing scorecard for this segment or append
        const existing = updatedDeepDive.scorecards ?? [];
        updatedDeepDive.scorecards = [
          ...existing.filter((s) => s.segmentId !== segmentId),
          newScorecard,
        ];
        break;
      }
      case 'segment_comparison': {
        // Comparison results returned directly, no persistence needed
        // But we still persist the deep-dive to ensure consistency
        break;
      }
      case 'segment_profile': {
        const profileResult = toolResult as {
          marketDefinition: { geography: string; businessType: string; sizeBucket: string; estimatedCount: string };
          buyerStructure: { economicBuyer: string; user: string; decisionCycle: string; budgetOwnership: string };
        };
        const segId = inputs?.segmentId ?? '0';
        updatedDeepDive.segmentProfiles = {
          ...(updatedDeepDive.segmentProfiles ?? {}),
          [segId]: profileResult,
        };
        break;
      }
      case 'jtbd':
        updatedDeepDive.jtbd = {
          ...(toolResult as NonNullable<MarketResearchData['jtbd']>),
          lastUpdated: new Date().toISOString(),
        };
        break;
      case 'value_product':
        updatedDeepDive.valueProduct = {
          ...(toolResult as NonNullable<MarketResearchData['valueProduct']>),
          lastUpdated: new Date().toISOString(),
        };
        break;
      case 'revenue_pricing':
        updatedDeepDive.revenuePricing = {
          ...(toolResult as NonNullable<MarketResearchData['revenuePricing']>),
          lastUpdated: new Date().toISOString(),
        };
        break;
      case 'unit_economics': {
        const economicsResult = toolResult as {
          segments: UnitEconomicsData['segments'];
          globalMetrics: UnitEconomicsData['globalMetrics'];
          alerts: UnitEconomicsData['alerts'];
        };
        updatedDeepDive.unitEconomics = {
          segments: economicsResult.segments,
          globalMetrics: economicsResult.globalMetrics,
          alerts: economicsResult.alerts,
          sensitivityResults: updatedDeepDive.unitEconomics?.sensitivityResults ?? [],
          lastUpdated: new Date().toISOString(),
        };
        break;
      }
      case 'sensitivity_analysis': {
        const sensitivityResult = toolResult as {
          parameter: string;
          deltaPct: number;
          adjustedSegments: UnitEconomicsData['segments'];
          impact: string;
          verdict: 'survives' | 'stressed' | 'breaks';
        };
        // Build original from existing economics or use empty
        const existingEconomics = updatedDeepDive.unitEconomics;
        const originalSegmentMap = new Map(
          (existingEconomics?.segments ?? []).map((s) => [s.segmentId, s])
        );
        const newResult = {
          parameter: `${sensitivityResult.parameter} ${sensitivityResult.deltaPct >= 0 ? '+' : ''}${sensitivityResult.deltaPct}%`,
          original: originalSegmentMap.values().next().value ?? sensitivityResult.adjustedSegments[0],
          adjusted: sensitivityResult.adjustedSegments[0],
          impact: sensitivityResult.impact,
          verdict: sensitivityResult.verdict,
        };
        const existingResults = existingEconomics?.sensitivityResults ?? [];
        if (existingEconomics) {
          updatedDeepDive.unitEconomics = {
            ...existingEconomics,
            sensitivityResults: [...existingResults, newResult],
            lastUpdated: new Date().toISOString(),
          };
        } else {
          updatedDeepDive.unitEconomics = {
            segments: sensitivityResult.adjustedSegments,
            globalMetrics: { monthlyBurn: null, runwayMonths: null, blendedArpu: 0, blendedCac: 0, blendedLtv: 0, blendedLtvCacRatio: 0 },
            alerts: [],
            sensitivityResults: [newResult],
            lastUpdated: new Date().toISOString(),
          };
        }
        break;
      }
    }

    // Persist to Appwrite
    await persistDeepDive(canvasId, blockType, updatedDeepDive);

    return NextResponse.json({ result: toolResult, updatedDeepDive, usage });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Deep-dive error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT — Manual edits to deep-dive data
export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const { canvasId, blockType } = await context.params;
    const { deepDiveJson } = (await request.json()) as { deepDiveJson: string };

    // Verify ownership — relationship fields auto-loaded
    // Index: none needed (primary key lookup)
    const canvas = await serverTablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: CANVASES_TABLE_ID,
      rowId: canvasId,
      queries: [],
    }) as unknown as CanvasData;
    if (getUserIdFromCanvas(canvas) !== user.$id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Find existing block doc — only need $id for update target
    // Index required: composite [canvas, blockType]
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

    if (existing.rows.length > 0) {
      await serverTablesDB.updateRow({
        databaseId: DATABASE_ID,
        tableId: BLOCKS_TABLE_ID,
        rowId: existing.rows[0].$id,
        data: { deepDiveJson },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Deep-dive PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function persistDeepDive(canvasId: string, blockType: string, data: MarketResearchData) {
  // Index required: composite [canvas, blockType]
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

  if (existing.rows.length > 0) {
    await serverTablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: BLOCKS_TABLE_ID,
      rowId: existing.rows[0].$id,
      data: { deepDiveJson: JSON.stringify(data) },
    });
  }
}
