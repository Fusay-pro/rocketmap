import { tool } from 'ai';
import { z } from 'zod';
import { ID } from 'node-appwrite';
import {
  serverTablesDB,
  DATABASE_ID,
  CANVASES_TABLE_ID,
  BLOCKS_TABLE_ID,
  SEGMENTS_TABLE_ID,
} from '@/lib/appwrite';
import { generateSlug } from '@/lib/utils';
import type { BlockType } from '@/lib/types/canvas';
import { SEGMENT_COLORS } from '@/lib/types/canvas';
import { searchBrave } from './brave-search';

export const analyzeBlock = tool({
  description: 'Analyze a business model canvas block and return structured insights including an improved draft, hidden assumptions, risks, and critical questions. Also score how confident we should be in this block.',
  inputSchema: z.object({
    draft: z.string().describe('An improved, more specific version of this single block card. Do NOT write a bullet list of multiple items — each block is one atomic item. If you want to suggest additional items, use createBlockItems separately.'),
    assumptions: z.array(z.string()).describe('Hidden assumptions the user is making'),
    risks: z.array(z.string()).describe('Potential failure points or weaknesses'),
    questions: z.array(z.string()).describe('Critical questions the user should answer to validate this block'),
    confidenceScore: z.number().min(0).max(100).describe('How confident are we in this block (0-100)? Consider: specificity of content (vague=low), evidence/data backing claims, number of untested assumptions, severity of risks, completeness of the block relative to the business model. 80+ = well-validated with data, 50-79 = reasonable but has gaps, 20-49 = speculative or vague, <20 = placeholder or empty'),
    riskScore: z.number().min(0).max(100).describe('Overall risk level for this block (0-100). Consider: number and severity of risks, how many assumptions are untested, dependency on external factors. 70+ = critical risks, 40-69 = moderate, <40 = manageable'),
  }),
  execute: async (params) => params,
});

export const checkConsistency = tool({
  description: 'Check consistency across multiple business model canvas blocks and Business Model OS zone dependencies. Identify contradictions, missing links, broken chain edges, and logical gaps.',
  inputSchema: z.object({
    contradictions: z.array(z.object({
      blocks: z.array(z.string()).describe('The two or more blocks involved'),
      issue: z.string().describe('Description of the contradiction'),
      severity: z.enum(['minor', 'major', 'critical']),
      suggestion: z.string().describe('How to resolve this contradiction'),
      question: z.string().describe('The tough question an investor or audience member would ask about this specific problem — the founder must be ready to answer it'),
    })).describe('Cross-block contradictions found'),
    missingLinks: z.array(z.object({
      from: z.string().describe('Source block'),
      to: z.string().describe('Target block'),
      issue: z.string().describe('What connection is missing'),
      question: z.string().describe('The tough question an investor or audience member would ask about this specific gap — the founder must be ready to answer it'),
    })).describe('Missing connections between blocks'),
    chainFindings: z.array(z.object({
      fromZone: z.string().describe('Upstream BM-OS zone, e.g. customer_market'),
      toZone: z.string().describe('Downstream BM-OS zone, e.g. revenue_pricing'),
      issue: z.string().describe('Broken dependency-chain link or unsupported handoff'),
      severity: z.enum(['minor', 'major', 'critical']),
      evidenceNeeded: z.string().describe('Metric, experiment, or evidence required to validate this link'),
      suggestion: z.string().describe('Specific change or test to repair the chain link'),
      question: z.string().describe('The tough question an investor or audience member would ask about this specific weakness — the founder must be ready to answer it'),
    })).optional().describe('Dependency-chain findings across BM-OS zones'),
    hostQuestions: z.array(z.string()).describe('Tough questions an investor, judge, or audience member would likely ask about this business model — questions the founder should be prepared to answer. Derive them from the weakest links, contradictions, and gaps found. 3-8 questions.'),
  }),
  execute: async (params) => params,
});

export const extractAssumptions = tool({
  description: 'Extract hidden assumptions from the entire business model canvas. Each assumption should be specific, testable, and linked to the blocks where it appears.',
  inputSchema: z.object({
    assumptions: z.array(z.object({
      statement: z.string().describe('A clear, testable assumption statement'),
      category: z.enum(['market', 'product', 'ops', 'legal']).describe('Assumption category'),
      severityScore: z.number().min(0).max(10).describe('Impact score 0-10 (10 = highest risk if wrong)'),
      blockTypes: z.array(z.string()).describe('Block types where this assumption appears (e.g., "customer_segments", "value_prop")'),
    })).describe('Extracted assumptions from the canvas'),
  }),
  execute: async (params) => params,
});

export const identifyAssumptions = tool({
  description: 'Identify hidden assumptions in a block with risk assessment and impact analysis. Use this alongside analyzeBlock to extract structured assumptions with risk levels.',
  inputSchema: z.object({
    assumptions: z.array(z.object({
      statement: z.string().describe('The assumption being made — specific and testable'),
      riskLevel: z.enum(['high', 'medium', 'low']).describe('How bad if this assumption is wrong: high=business fails, medium=delays/pivots, low=minor adjustment'),
      reasoning: z.string().describe('Why this risk level was assigned'),
      affectedBlocks: z.array(z.string()).describe('Which block types fail if this is wrong (e.g. "value_prop", "revenue_streams")')
    }))
  }),
  execute: async (params) => params
});

export const suggestExperiment = tool({
  description: 'Suggest the cheapest/fastest experiment to validate a specific assumption. Prioritize free/low-cost methods and short timelines.',
  inputSchema: z.object({
    experimentType: z.enum(['survey', 'interview', 'mvp', 'ab_test', 'research', 'other']),
    description: z.string().describe('Step-by-step instructions for running the experiment'),
    successCriteria: z.string().describe('How to know if the assumption is validated (specific, measurable)'),
    successThreshold: z.string().describe('The explicit pass/fail threshold for the experiment, such as a numeric target, observed behavior, or paid commitment count'),
    costEstimate: z.string().describe('$0, $50, $500, etc.'),
    durationEstimate: z.string().describe('5 min, 1 week, 1 month, etc.'),
    reasoning: z.string().describe('Why this is the cheapest/fastest validation method')
  }),
  execute: async (params) => params
});

export const calculateConfidence = tool({
  description: 'Calculate confidence score (0-100) based on experiment evidence quality. Consider sample size, methodology rigor, and relevance.',
  inputSchema: z.object({
    confidenceScore: z.number().min(0).max(100),
    reasoning: z.string().describe('Why this confidence level based on evidence'),
    evidenceQuality: z.enum(['strong', 'moderate', 'weak']),
    recommendedNextSteps: z.array(z.string()).describe('What else to test to increase confidence')
  }),
  execute: async (params) => params
});

export const searchWeb = tool({
  description: 'Search the web for real-world market data, competitor information, industry reports, and validation data. Use this to ground market research in current facts and sources. Always cite URLs in your analysis.',
  inputSchema: z.object({
    query: z.string().describe('Search query optimized for finding market research data (e.g., "TAM coffee shop management software 2026", "specialty coffee market size Bangkok")'),
    maxResults: z.number().optional().default(5).describe('Maximum number of search results to return (default 5)'),
  }),
  execute: async ({ query, maxResults }) => {
    return await searchBrave(query, { maxResults });
  },
});

// ─── Deep Dive Tools (Market Research) ───────────────────────────────────────

const marketSizeEstimateSchema = z.object({
  value: z.number().describe('Market size in USD'),
  methodology: z.string().describe('How this estimate was derived'),
  sources: z.array(z.string()).describe('Data sources or references'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence level of the estimate'),
});

export const estimateMarketSize = tool({
  description: 'Estimate TAM, SAM, and SOM market sizes for a startup based on industry, geography, and target customer type.',
  inputSchema: z.object({
    tam: marketSizeEstimateSchema.describe('Total Addressable Market'),
    sam: marketSizeEstimateSchema.describe('Serviceable Addressable Market'),
    som: marketSizeEstimateSchema.describe('Serviceable Obtainable Market'),
    reasoning: z.string().describe('Overall reasoning connecting the three estimates'),
  }),
  execute: async (params) => params,
});

export const generateSegments = tool({
  description: 'Generate customer segments based on the business model canvas content.',
  inputSchema: z.object({
    segments: z.array(z.object({
      id: z.string().describe('Unique segment identifier'),
      name: z.string().describe('Segment name'),
      description: z.string().describe('Segment description'),
      demographics: z.string().describe('Demographic characteristics'),
      psychographics: z.string().describe('Psychographic characteristics'),
      behavioral: z.string().describe('Behavioral patterns'),
      geographic: z.string().describe('Geographic scope'),
      estimatedSize: z.string().describe('Estimated segment size'),
      priority: z.enum(['high', 'medium', 'low']).describe('Segment priority'),
    })).describe('Customer segments'),
  }),
  execute: async (params) => params,
});

export const generatePersonas = tool({
  description: 'Generate detailed customer personas linked to existing segments.',
  inputSchema: z.object({
    personas: z.array(z.object({
      id: z.string().describe('Unique persona identifier'),
      name: z.string().describe('Persona name'),
      age: z.number().describe('Persona age'),
      occupation: z.string().describe('Job title or role'),
      segmentId: z.string().describe('ID of the segment this persona belongs to'),
      goals: z.array(z.string()).describe('What this persona wants to achieve'),
      frustrations: z.array(z.string()).describe('Pain points and frustrations'),
      behaviors: z.array(z.string()).describe('Typical behaviors and habits'),
      quote: z.string().describe('A representative quote from this persona'),
    })).describe('Customer personas'),
  }),
  execute: async (params) => params,
});

export const validateMarketSize = tool({
  description: 'Validate TAM/SAM/SOM estimates by cross-referencing with industry data and checking internal consistency.',
  inputSchema: z.object({
    validations: z.array(z.object({
      claim: z.string().describe('The claim being validated'),
      status: z.enum(['confirmed', 'questioned', 'contradicted']).describe('Validation status'),
      evidence: z.string().describe('Evidence supporting the validation'),
      source: z.string().describe('Source of the evidence'),
    })).describe('Validation results'),
    overallAssessment: z.string().describe('Summary assessment of the market size estimates'),
  }),
  execute: async (params) => params,
});

export const analyzeCompetitors = tool({
  description: 'Analyze the competitive landscape for the target market segments.',
  inputSchema: z.object({
    competitors: z.array(z.object({
      id: z.string().describe('Unique competitor identifier'),
      name: z.string().describe('Competitor name'),
      positioning: z.string().describe('Market positioning'),
      strengths: z.array(z.string()).describe('Key strengths'),
      weaknesses: z.array(z.string()).describe('Key weaknesses'),
      marketShareEstimate: z.string().describe('Estimated market share'),
      threatLevel: z.enum(['low', 'medium', 'high']).describe('Threat level to the startup'),
    })).describe('Competitors in the landscape'),
  }),
  execute: async (params) => params,
});

// ─── Phase 1 BM-OS Tools ────────────────────────────────────────────────────

const customerRoleSchema = z.enum([
  'user',
  'buyer',
  'decision_maker',
  'influencer',
  'beneficiary',
  'economic_customer',
]);

const jtbdPainTypeSchema = z.enum([
  'functional',
  'emotional',
  'social',
  'economic',
  'status',
]);

const revenueModelSchema = z.enum([
  'one_time',
  'license',
  'rev_share',
  'saas',
  'sponsorship',
]);

const wtpTestSchema = z.enum(['reserve', 'deposit', 'paid_pilot']);

export const generateJTBD = tool({
  description: 'Generate structured jobs-to-be-done statements, pain types, and customer role splits for the selected customer/value context.',
  inputSchema: z.object({
    statements: z.array(z.object({
      id: z.string().describe('Stable identifier, e.g. jtbd-1'),
      segmentId: z.string().optional().describe('Segment id if available'),
      role: customerRoleSchema,
      situation: z.string().describe('The triggering situation: When ...'),
      job: z.string().describe('The progress sought: I want ...'),
      outcome: z.string().describe('The desired outcome: so I can ...'),
      pains: z.array(z.object({
        id: z.string(),
        type: jtbdPainTypeSchema,
        description: z.string(),
        intensity: z.number().min(1).max(5).optional(),
        evidence: z.string().optional(),
      })).describe('Functional/emotional/social/economic/status pains behind the job'),
      priority: z.enum(['low', 'medium', 'high']),
      evidence: z.string().optional(),
      confidence: z.enum(['low', 'medium', 'high']).optional(),
    })).min(1),
    roleSplits: z.array(z.object({
      segmentId: z.string().optional(),
      user: z.string(),
      buyer: z.string(),
      decision_maker: z.string(),
      influencer: z.string(),
      beneficiary: z.string(),
      economic_customer: z.string(),
    })).optional(),
    notes: z.string().optional(),
  }),
  execute: async (params) => params,
});

export const mapValueProduct = tool({
  description: 'Map customer roles and pains to a positioning statement and pain -> outcome -> feature -> proof metric product scope.',
  inputSchema: z.object({
    roleMappings: z.array(z.object({
      id: z.string(),
      role: z.string(),
      customer: z.string(),
      pain: z.string(),
      desiredOutcome: z.string(),
      valuePromise: z.string(),
    })).describe('Per customer-role value mapping'),
    positioning: z.object({
      customer: z.string(),
      pain: z.string(),
      outcome: z.string(),
      mechanism: z.string(),
      alternative: z.string(),
    }),
    productScopeRows: z.array(z.object({
      id: z.string(),
      pain: z.string(),
      outcome: z.string(),
      feature: z.string(),
      proofMetric: z.string().describe('A measurable proof metric or threshold'),
    })).min(1),
    notes: z.string().optional(),
  }),
  execute: async (params) => params,
});

export const designRevenuePricing = tool({
  description: 'Design per-segment revenue model, payment moment, price point, and willingness-to-pay test preference.',
  inputSchema: z.object({
    segments: z.array(z.object({
      segmentId: z.string(),
      segmentName: z.string(),
      revenueModel: revenueModelSchema,
      paymentMoment: z.string().describe('What moment creates enough value that this segment pays now'),
      pricePoint: z.string().optional(),
      wtpTestPreference: wtpTestSchema.describe('Use paid commitment tests, not would-you-pay surveys'),
    })).min(1),
    notes: z.string().optional(),
  }),
  execute: async (params) => params,
});

// ─── Segment Evaluation Tools ────────────────────────────────────────────────

const decisionCriterionSchema = z.object({
  id: z.string().describe('Unique criterion identifier'),
  category: z.enum(['demand', 'market', 'execution']).describe('Category: demand (~30%), market (~40%), execution (~30%)'),
  name: z.string().describe('Criterion name'),
  weight: z.number().min(0).max(1).describe('Weight within category (0-1)'),
  score: z.number().min(1).max(5).describe('Score (1-5)'),
  reasoning: z.string().describe('Justification for this score'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence in this score'),
});

export const scoreSegment = tool({
  description: 'Score a customer segment across 10 decision criteria in 3 categories (Demand, Market, Execution) to evaluate whether to pursue it.',
  inputSchema: z.object({
    criteria: z.array(decisionCriterionSchema).length(10).describe('Exactly 10 decision criteria scores'),
    overallScore: z.number().min(1).max(5).describe('Weighted overall score (1-5)'),
    recommendation: z.enum(['pursue', 'test', 'defer']).describe('Overall recommendation'),
    reasoning: z.string().describe('Overall rationale for the recommendation'),
    keyRisks: z.array(z.string()).min(3).max(5).describe('3-5 key risks for this segment'),
    requiredExperiments: z.array(z.string()).min(2).max(4).describe('2-4 experiments to validate assumptions'),
  }),
  execute: async (params) => params,
});

export const compareSegments = tool({
  description: 'Compare two customer segments to determine which to prioritize as beachhead.',
  inputSchema: z.object({
    segmentAName: z.string().describe('Name of segment A'),
    segmentBName: z.string().describe('Name of segment B'),
    scoreDifference: z.number().describe('Score delta (A - B)'),
    betterSegment: z.enum(['A', 'B', 'tie']).describe('Which segment scores higher'),
    keyDifferences: z.array(z.object({
      criterion: z.string().describe('Criterion name'),
      scoreA: z.number().min(1).max(5),
      scoreB: z.number().min(1).max(5),
      delta: z.number(),
      explanation: z.string(),
    })).describe('Key differences between the segments'),
    recommendation: z.string().describe('Which segment to prioritize and why'),
  }),
  execute: async (params) => params,
});

// ─── Segment Profile Tool ────────────────────────────────────────────────────

export const suggestSegmentProfile = tool({
  description: 'Suggest a segment profile with market definition and buyer structure based on the canvas context and segment data.',
  inputSchema: z.object({
    marketDefinition: z.object({
      geography: z.string().describe('Target geography (e.g. "Thailand", "Bangkok only", "Southeast Asia")'),
      businessType: z.string().describe('Business type (e.g. "Specialty cafe", "chain restaurant", "SaaS startup")'),
      sizeBucket: z.string().describe('Size bucket (e.g. "Revenue $1-5M, 1-3 locations", "10-50 employees")'),
      estimatedCount: z.string().describe('Estimated count in target geography (e.g. "~2,500 in Bangkok", "15,000 nationwide")'),
    }),
    buyerStructure: z.object({
      economicBuyer: z.string().describe('Who signs the check (e.g. "Owner-operator", "Purchasing manager")'),
      user: z.string().describe('Who uses the product day-to-day (e.g. "Barista", "Store manager")'),
      decisionCycle: z.string().describe('How long to close a deal (e.g. "1-2 weeks", "3-6 month procurement")'),
      budgetOwnership: z.string().describe('Where budget comes from (e.g. "Owner personal budget", "Departmental OPEX")'),
    }),
  }),
  execute: async (params) => params,
});

// ─── Block Item Creation Tool (Block Chat Copilot) ──────────────────────────

export const createBlockItems = tool({
  description: 'Create structured items for a business model canvas block. Use this when the user asks to add, suggest, or list specific items (costs, activities, resources, channels, partners, etc.) for ANY block. Each item becomes a card that can be linked to segments and other blocks. ALWAYS prefer this tool over writing markdown lists.',
  inputSchema: z.object({
    items: z.array(z.object({
      name: z.string().describe('Short item name (e.g. "AWS hosting", "Content marketing", "$15/mo subscription")'),
      description: z.string().describe('Brief description or details about this item'),
    })).min(1).describe('Block items to create'),
  }),
  execute: async (params) => params,
});

// ─── Segment Creation Tool (Block Chat Copilot) ─────────────────────────────

export const createSegments = tool({
  description: 'Create customer segments as structured records. Use this when the user asks to define, suggest, or create customer segments. Each segment becomes a real record that can be linked to blocks and evaluated.',
  inputSchema: z.object({
    segments: z.array(z.object({
      name: z.string().describe('Segment name'),
      description: z.string().describe('Segment description'),
      demographics: z.string().describe('Demographic characteristics'),
      psychographics: z.string().describe('Psychographic characteristics'),
      behavioral: z.string().describe('Behavioral patterns'),
      geographic: z.string().describe('Geographic scope'),
      estimatedSize: z.string().describe('Estimated segment size (e.g. "50,000 SMBs in US")'),
      priority: z.enum(['high', 'medium', 'low']).describe('Segment priority'),
    })).min(1).describe('Customer segments to create'),
  }),
  execute: async (params) => params,
});

// ─── Canvas Generation Tool ──────────────────────────────────────────────────

const atomicBlockItemSchema = z.object({
  text: z.string().min(1).describe('Atomic block content text'),
  tags: z.array(z.string()).optional().describe('Optional categorization tags'),
  segmentRefs: z
    .array(z.string())
    .optional()
    .describe('Optional segment references by exact segment name or position ("1", "2", ...)'),
});

const guidedBlockArraySchema = z
  .array(z.union([z.string(), atomicBlockItemSchema]))
  .optional();

type AtomicBlockItemInput = z.infer<typeof atomicBlockItemSchema>;

function normalizeSegmentRefKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeGuidedBlockItem(
  value: string | AtomicBlockItemInput,
): { text: string; tags: string[]; segmentRefs: string[] } | null {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    return { text, tags: [], segmentRefs: [] };
  }

  const text = value.text.trim();
  if (!text) return null;
  return {
    text,
    tags: Array.isArray(value.tags)
      ? value.tags.map((t) => t.trim()).filter(Boolean)
      : [],
    segmentRefs: Array.isArray(value.segmentRefs)
      ? value.segmentRefs.map((r) => r.trim()).filter(Boolean)
      : [],
  };
}

const generateCanvasInputSchema = z.object({
  title: z.string().min(3).describe('A concise title for the canvas (the startup or product name)'),
  segments: z.array(z.object({
    name: z.string().describe('Segment name'),
    description: z.string().describe('Segment description'),
    demographics: z.string().describe('Demographic characteristics (e.g., "25-40 years old, urban professionals")'),
    psychographics: z.string().describe('Psychographic characteristics (e.g., "Value convenience, tech-savvy")'),
    behavioral: z.string().describe('Behavioral patterns (e.g., "Early adopters, frequent online shoppers")'),
    geographic: z.string().describe('Geographic scope (e.g., "Bangkok metropolitan area", "Southeast Asia")'),
    estimatedSize: z.string().describe('Estimated segment size (e.g., "50,000 SMBs in Thailand", "15% of TAM")'),
    priority: z.enum(['high', 'medium', 'low']).describe('Segment priority'),
  })).optional().describe('Customer segments to extract (1-3 segments recommended)'),
  key_partnerships: guidedBlockArraySchema.describe('Atomic key partner items (string legacy format is supported temporarily)'),
  key_activities: guidedBlockArraySchema.describe('Atomic key activity items (string legacy format is supported temporarily)'),
  key_resources: guidedBlockArraySchema.describe('Atomic key resource items (string legacy format is supported temporarily)'),
  value_prop: guidedBlockArraySchema.describe('Atomic value proposition items (string legacy format is supported temporarily)'),
  customer_relationships: guidedBlockArraySchema.describe('Atomic customer relationship items (string legacy format is supported temporarily)'),
  channels: guidedBlockArraySchema.describe('Atomic channel items (string legacy format is supported temporarily)'),
  cost_structure: guidedBlockArraySchema.describe('Atomic cost structure items (string legacy format is supported temporarily)'),
  revenue_streams: guidedBlockArraySchema.describe('Atomic revenue stream items (string legacy format is supported temporarily)'),
});

/** Static version — echoes args back (used as fallback / in tool registry) */
export const generateCanvas = tool({
  description: 'Generate a complete Business Model Canvas with content for all 9 blocks based on the startup idea discussed. Call this once you have enough context from the conversation.',
  inputSchema: generateCanvasInputSchema,
  execute: async (params) => params,
});



/**
 * Factory: creates a generateCanvas tool that persists the canvas + blocks
 * in Appwrite and returns { slug, canvasId, title }.
 */
export function createGenerateCanvasTool(userId: string) {
  return tool({
    description: 'Generate a complete Business Model Canvas with content for all 9 blocks based on the startup idea discussed. Call this once you have enough context from the conversation. Extract customer segments and create multiple atomic blocks per type.',
    inputSchema: generateCanvasInputSchema,
    execute: async (params) => {
      const { title, segments = [], ...blockArrays } = params;
      const now = new Date().toISOString();

      try {
        // 1. Create canvas
        const canvas = await serverTablesDB.createRow({
          databaseId: DATABASE_ID,
          tableId: CANVASES_TABLE_ID,
          rowId: ID.unique(),
        data: {
          title: title.trim(),
          slug: await generateSlug(title, userId),
          description: '',
          createdAt: now,
          updatedAt: now,
          isPublic: false,
            user: userId, // Appwrite relationship field
          }
        });

        // 2. Create segments and build deterministic lookup for block linking
        const segmentIdByName = new Map<string, string>();
        const segmentIdByIndex = new Map<string, string>();
        if (segments.length > 0) {
          const createdSegments = await Promise.all(
            segments.map((seg, idx) =>
              serverTablesDB.createRow({
                databaseId: DATABASE_ID,
                tableId: SEGMENTS_TABLE_ID,
                rowId: ID.unique(),
                data: {
                  canvas: canvas.$id,  // Appwrite relationship
                  name: seg.name,
                  description: seg.description || '',
                  demographics: seg.demographics || '',
                  psychographics: seg.psychographics || '',
                  behavioral: seg.behavioral || '',
                  geographic: seg.geographic || '',
                  estimatedSize: seg.estimatedSize || '',
                  priorityScore: seg.priority === 'high' ? 80 : seg.priority === 'low' ? 30 : 50,
                  earlyAdopterFlag: false,
                  colorHex: SEGMENT_COLORS[idx % SEGMENT_COLORS.length]
                }
              })
            )
          );
          createdSegments.forEach((doc, idx) => {
            const seg = segments[idx];
            segmentIdByName.set(normalizeSegmentRefKey(seg.name), doc.$id);
            segmentIdByIndex.set(String(idx + 1), doc.$id);
          });
        }

        const resolveSegmentIds = (segmentRefs: string[]): string[] => {
          const resolved = new Set<string>();
          for (const ref of segmentRefs) {
            const byName = segmentIdByName.get(normalizeSegmentRefKey(ref));
            if (byName) {
              resolved.add(byName);
              continue;
            }
            const byIndex = segmentIdByIndex.get(ref.trim());
            if (byIndex) resolved.add(byIndex);
          }
          return Array.from(resolved);
        };

        // 3. Create blocks (multiple per type, atomic format)
        const blockTypeMap: Record<string, BlockType> = {
          key_partnerships: 'key_partnerships',
          key_activities: 'key_activities',
          key_resources: 'key_resources',
          value_prop: 'value_prop',
          customer_relationships: 'customer_relationships',
          channels: 'channels',
          cost_structure: 'cost_structure',
          revenue_streams: 'revenue_streams'
        };

        const blockCreationPromises = [];
        for (const [paramKey, blockType] of Object.entries(blockTypeMap)) {
          const contentArray = blockArrays[paramKey as keyof typeof blockArrays];
          if (!Array.isArray(contentArray) || contentArray.length === 0) continue;

          for (const rawItem of contentArray as Array<string | AtomicBlockItemInput>) {
            const normalized = normalizeGuidedBlockItem(rawItem);
            if (!normalized) continue;
            const linkedSegmentIds = resolveSegmentIds(normalized.segmentRefs);

            blockCreationPromises.push(
              serverTablesDB.createRow({
                databaseId: DATABASE_ID,
                tableId: BLOCKS_TABLE_ID,
                rowId: ID.unique(),
                data: {
                  canvas: canvas.$id,  // Appwrite relationship
                  blockType: blockType,
                  contentJson: JSON.stringify({
                    text: normalized.text,
                    ...(normalized.tags.length > 0 ? { tags: normalized.tags } : {}),
                  }),
                  aiAnalysisJson: '',
                  deepDiveJson: '',
                  confidenceScore: 0,
                  riskScore: 0,
                  ...(linkedSegmentIds.length > 0 ? { segments: linkedSegmentIds } : {}),
                }
              })
            );
          }
        }

        // Create customer_segments blocks based on created segment records
        for (let idx = 0; idx < segments.length; idx++) {
          const seg = segments[idx];
          const segmentId = segmentIdByIndex.get(String(idx + 1));
          if (!segmentId) continue;
          const summary = seg.description
            ? `${seg.name} - ${seg.description}`
            : seg.name;

          blockCreationPromises.push(
            serverTablesDB.createRow({
              databaseId: DATABASE_ID,
              tableId: BLOCKS_TABLE_ID,
              rowId: ID.unique(),
              data: {
                canvas: canvas.$id,
                blockType: 'customer_segments',
                contentJson: JSON.stringify({
                  text: summary,
                  tags: ['segment'],
                }),
                aiAnalysisJson: '',
                deepDiveJson: '',
                confidenceScore: 0,
                riskScore: 0,
                segments: [segmentId],
              }
            })
          );
        }

        if (blockCreationPromises.length > 0) {
          await Promise.all(blockCreationPromises);
        }

        // 4. Return canvas info (use $id for Appwrite)
        return {
          slug: canvas.slug,
          canvasId: canvas.$id,
          title: canvas.title
        };
      } catch (error) {
        // Appwrite cascade deletes handle cleanup automatically
        console.error('Canvas creation failed:', error);
        throw error;
      }
    },
  });
}

// ─── Surgical Card Tools (Atomic CRUD) ───────────────────────────────────────



// ─── Unit Economics Tools ────────────────────────────────────────────────────

const segmentEconomicsSchema = z.object({
  segmentId: z.string().describe('Segment identifier'),
  segmentName: z.string().describe('Segment display name'),
  arpu: z.number().describe('Average Revenue Per User (monthly, USD)'),
  cac: z.number().describe('Customer Acquisition Cost (USD)'),
  grossMarginPct: z.number().min(0).max(100).describe('Gross margin percentage (0-100)'),
  ltv: z.number().describe('Customer Lifetime Value (USD)'),
  paybackMonths: z.number().describe('CAC payback period in months'),
  churnRatePct: z.number().describe('Monthly churn rate percentage'),
  ltvCacRatio: z.number().describe('LTV:CAC ratio'),
  status: z.enum(['healthy', 'warning', 'critical']).describe('Economic health: healthy (LTV:CAC >= 3), warning (1-3), critical (< 1)'),
  methodology: z.string().describe('How these numbers were estimated'),
});

const economicsAlertSchema = z.object({
  type: z.enum(['impossible', 'warning', 'benchmark']).describe('Alert type: impossible = CAC > LTV, warning = marginal economics, benchmark = industry comparison'),
  message: z.string().describe('Human-readable alert message'),
  severity: z.enum(['critical', 'warning', 'info']).describe('Alert severity level'),
  segmentId: z.string().optional().describe('Segment this alert applies to, if specific'),
});

export const estimateUnitEconomics = tool({
  description: 'Estimate unit economics per customer segment using canvas context, revenue streams, cost structure, and industry benchmarks.',
  inputSchema: z.object({
    segments: z.array(segmentEconomicsSchema).describe('Unit economics per customer segment'),
    globalMetrics: z.object({
      monthlyBurn: z.number().nullable().describe('Estimated monthly burn rate (USD), null if unknown'),
      runwayMonths: z.number().nullable().describe('Estimated runway in months, null if unknown'),
      blendedArpu: z.number().describe('Blended ARPU across all segments'),
      blendedCac: z.number().describe('Blended CAC across all segments'),
      blendedLtv: z.number().describe('Blended LTV across all segments'),
      blendedLtvCacRatio: z.number().describe('Blended LTV:CAC ratio'),
    }).describe('Global metrics across all segments'),
    alerts: z.array(economicsAlertSchema).describe('Alerts for impossible economics, warnings, or benchmark comparisons'),
  }),
  execute: async (params) => params,
});

export const runSensitivityAnalysis = tool({
  description: 'Run sensitivity analysis on unit economics by adjusting a parameter and showing impact.',
  inputSchema: z.object({
    parameter: z.string().describe('Parameter being adjusted (e.g., "churn_rate", "cac", "arpu")'),
    deltaPct: z.number().describe('Percentage change applied (e.g., 20 means +20%)'),
    adjustedSegments: z.array(segmentEconomicsSchema).describe('Recalculated segment economics after adjustment'),
    impact: z.string().describe('Human-readable summary of the impact'),
    verdict: z.enum(['survives', 'stressed', 'breaks']).describe('Overall verdict: survives = still healthy, stressed = marginal, breaks = unsustainable'),
  }),
  execute: async (params) => params,
});

// ─── Block Editing Tool ──────────────────────────────────────────────────────

export const proposeBlockEdit = tool({
  description: 'Propose a text edit to a SINGLE existing block card. Each block is one atomic item — NEVER put multiple items or bullet lists in newContent. If you need to suggest multiple items, use createBlockItems instead. Use this only to reword or refine the text of one existing card.',
  inputSchema: z.object({
    edits: z.array(z.object({
      blockType: z.enum([
        'key_partnerships', 'key_activities', 'key_resources',
        'value_prop', 'customer_relationships', 'channels',
        'customer_segments', 'cost_structure', 'revenue_streams',
      ]).describe('Which block to edit'),
      mode: z.enum(['bmc', 'lean', 'both']).describe('Which canvas mode to edit. Use "both" for shared blocks (channels, customer_segments, cost_structure, revenue_streams)'),
      oldContent: z.string().describe('The current content of the block (for diff display)'),
      newContent: z.string().describe('The proposed new content for this single card. Must be ONE item, not a list.'),
      reason: z.string().describe('Brief explanation of why this change improves the business model'),
    })).min(1).describe('Block edits to propose — each edit rewrites ONE card'),
  }),
  execute: async (params) => params,
});

// ─── Tool Registry ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allTools: Record<string, ReturnType<typeof tool<any, any>>> = {
  analyzeBlock,
  checkConsistency,
  extractAssumptions,
  identifyAssumptions,
  suggestExperiment,
  calculateConfidence,
  searchWeb,
  proposeBlockEdit,
  createBlockItems,
  createSegments,
  generateCanvas,
  estimateMarketSize,
  generateSegments,
  generatePersonas,
  validateMarketSize,
  analyzeCompetitors,
  generateJTBD,
  mapValueProduct,
  designRevenuePricing,
  scoreSegment,
  compareSegments,
  suggestSegmentProfile,
  estimateUnitEconomics,
  runSensitivityAnalysis,
};

export function getToolsForAgent(
  toolNames: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overrides?: Record<string, ReturnType<typeof tool<any, any>>>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, ReturnType<typeof tool<any, any>>> = {};
  for (const name of toolNames) {
    if (overrides?.[name]) {
      result[name] = overrides[name];
    } else if (allTools[name]) {
      result[name] = allTools[name];
    }
  }
  return result;
}
