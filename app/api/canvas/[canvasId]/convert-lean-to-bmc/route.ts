import { NextResponse } from 'next/server';
import { tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { generateTextWithLogging } from '@/lib/ai/logger';
import { Query } from 'node-appwrite';
import { requireAuth } from '@/lib/appwrite-server';
import {
  serverTablesDB,
  DATABASE_ID,
  BLOCKS_TABLE_ID,
} from '@/lib/appwrite';
import { getCanvasBlocks } from '@/lib/ai/canvas-state';
import { BLOCK_DEFINITIONS, isSharedBlock } from '@/app/components/canvas/constants';
import { recordAiUsage, getAiApiKeyFromUser } from '@/lib/ai/user-preferences';
import { getModelForPurpose, getModelIdForPurpose } from '@/lib/ai/models';
import { checkAiQuota, createQuotaExceededResponse } from '@/lib/ai/quota';

const convertLeanToBmc = tool({
  description: 'Provide the converted BMC content for each of the 5 non-shared blocks, derived from the full Lean Canvas context.',
  inputSchema: z.object({
    key_partnerships: z.object({
      content: z.string().describe('BMC Key Partners content: strategic alliances, supplier relationships, partner networks needed'),
      reasoning: z.string().describe('How this was derived from the lean canvas'),
    }),
    key_activities: z.object({
      content: z.string().describe('BMC Key Activities content: core actions required to deliver the value proposition'),
      reasoning: z.string().describe('How this was derived from the lean canvas'),
    }),
    key_resources: z.object({
      content: z.string().describe('BMC Key Resources content: physical, intellectual, human, and financial assets required'),
      reasoning: z.string().describe('How this was derived from the lean canvas'),
    }),
    value_prop: z.object({
      content: z.string().describe('BMC Value Propositions content: the bundle of products/services that create value for customers'),
      reasoning: z.string().describe('How this was derived from the lean canvas'),
    }),
    customer_relationships: z.object({
      content: z.string().describe('BMC Customer Relationships content: how you acquire, retain, and grow customers'),
      reasoning: z.string().describe('How this was derived from the lean canvas'),
    }),
  }),
  execute: async (params) => params,
});

interface RouteContext {
  params: Promise<{ canvasId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireAuth();
    const quota = await checkAiQuota(user);
    if (!quota.allowed) {
      return createQuotaExceededResponse(quota);
    }
    const { canvasId } = await context.params;

    const blocks = await getCanvasBlocks(canvasId, user.$id);

    // Build full lean canvas summary
    const leanLines: string[] = [];
    const sharedLines: string[] = [];

    for (const def of BLOCK_DEFINITIONS) {
      const block = blocks.find((b) => b.blockType === def.type);
      if (!block) continue;

      if (isSharedBlock(def.type)) {
        if (block.content.bmc.trim()) {
          sharedLines.push(`${def.bmcLabel}: ${block.content.bmc}`);
        }
      } else {
        if (block.content.lean.trim()) {
          leanLines.push(`${def.leanLabel}: ${block.content.lean}`);
        }
      }
    }

    if (leanLines.length === 0) {
      return NextResponse.json({ error: 'No lean content to convert' }, { status: 400 });
    }

    const { result, usage } = await generateTextWithLogging(
      'convert-lean-to-bmc',
      {
        model: getModelForPurpose('reasoning', getAiApiKeyFromUser(user)),
        system: `You are a business model expert helping convert a Lean Canvas into a Business Model Canvas (BMC).

The Lean Canvas has these blocks: Problem, Solution, Key Metrics, Unique Value Proposition, Unfair Advantage, Channels, Customer Segments, Cost Structure, Revenue Streams.

The BMC has: Key Partners, Key Activities, Key Resources, Value Propositions, Customer Relationships, Channels, Customer Segments, Cost Structure, Revenue Streams.

4 blocks are identical in both (Channels, Customer Segments, Cost Structure, Revenue Streams) — these are already shared.

The 5 blocks that differ occupy the same grid positions but have DIFFERENT meanings. Do NOT do a 1:1 positional copy. Instead, use the ENTIRE lean canvas holistically to generate appropriate content for each BMC block:

- **Key Partners**: Who does this business need to partner with? Derive from the lean Problem (what ecosystem exists), Solution (who helps build/deliver it), and Unfair Advantage.
- **Key Activities**: What must the business DO to succeed? Derive from Solution (core product work), Key Metrics (what drives those metrics), and the overall business model.
- **Key Resources**: What assets are needed? Derive from Solution (tech/IP needed), Unfair Advantage (moats to build), Key Metrics (data/systems required).
- **Value Propositions**: What value do customers get? Derive from Problem (pain points solved), Solution (how), and Unique Value Proposition (positioning).
- **Customer Relationships**: How to acquire/retain/grow customers? Derive from Channels context, Unfair Advantage (retention moats), and the overall customer journey.

Be specific and actionable. Use the user's actual business details, not generic templates.`,
        messages: [
          {
            role: 'user',
            content: `Here is the full Lean Canvas:

${leanLines.join('\n')}

${sharedLines.length > 0 ? `Shared blocks (same in both canvases):\n${sharedLines.join('\n')}` : ''}

Use the convertLeanToBmc tool to generate BMC content for all 5 non-shared blocks. Draw from the ENTIRE lean canvas to create each BMC block — don't just map one lean block to one BMC block.`,
          },
        ],
        tools: { convertLeanToBmc },
        stopWhen: stepCountIs(3),
      },
      {
        onUsage: (usageData) => recordAiUsage(user.$id, 'convert-lean-to-bmc', usageData, {
          canvasId,
          model: getModelIdForPurpose('reasoning'),
        }),
      },
    );

    // Extract tool result
    type BlockConversion = { content: string; reasoning: string };
    type ConvertedResult = Record<string, BlockConversion>;

    let converted: ConvertedResult | null = null;
    for (const step of result.steps) {
      for (const tc of step.toolResults) {
        if (tc.toolName === 'convertLeanToBmc') {
          converted = (tc as unknown as { result: ConvertedResult }).result;
        }
      }
    }

    if (!converted) {
      console.error('[convert] No tool result found. Steps:', result.steps.length, 'Text:', result.text?.slice(0, 300));
      return NextResponse.json({ error: 'AI did not produce conversions' }, { status: 500 });
    }

    // Persist converted content to Appwrite
    const NON_SHARED_TYPES = ['key_partnerships', 'key_activities', 'key_resources', 'value_prop', 'customer_relationships'];
    const updates: { blockType: string; bmc: string; lean: string; reasoning: string }[] = [];

    for (const blockType of NON_SHARED_TYPES) {
      const conv = converted[blockType];
      if (!conv?.content) continue;

      const block = blocks.find((b) => b.blockType === blockType);
      if (!block) continue;

      const newContent = { bmc: conv.content, lean: block.content.lean };

      // Ordered so we always write to the same row the canvas page reads as
      // the block's main content (`docsForType[0]`).
      const existing = await serverTablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: BLOCKS_TABLE_ID,
        queries: [
          Query.equal('canvas', canvasId),
          Query.equal('blockType', blockType),
          Query.orderAsc('$id'),
          Query.limit(1),
        ],
      });

      if (existing.rows.length > 0) {
        await serverTablesDB.updateRow({
          databaseId: DATABASE_ID,
          tableId: BLOCKS_TABLE_ID,
          rowId: existing.rows[0].$id,
          data: { contentJson: JSON.stringify(newContent) },
        });
      }

      updates.push({
        blockType,
        bmc: conv.content,
        lean: block.content.lean,
        reasoning: conv.reasoning,
      });
    }

    return NextResponse.json({ updates, usage });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('Convert lean-to-bmc error:', message);
    if (stack) console.error('Stack:', stack);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
