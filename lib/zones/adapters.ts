import type {
  BlockData,
  BlockType,
  EconomicsAlert,
  JTBDData,
  JTBDStatement,
  MarketResearchData,
  ProductScopeRow,
  RevenueModelEntry,
  RevenuePricingData,
  RevenuePricingSegment,
  SegmentEconomics,
  SegmentScorecard,
  UnitEconomicsData,
  ValueProductData,
  WtpTestDraft,
} from '@/lib/types/canvas';
import type { MetricDefinition, ZoneOutput, ZoneReadiness } from '@/lib/types/zones';
import { ZONE_DEFINITIONS } from '@/lib/zones/chain';

function blockMap(blocks: BlockData[]): Map<BlockType, BlockData> {
  return new Map(blocks.map((block) => [block.blockType, block]));
}

function textFor(block: BlockData | undefined): string {
  if (!block) return '';
  return [block.content.bmc, block.content.lean, ...(block.content.items ?? []).map((item) => item.name)]
    .filter(Boolean)
    .join(' | ')
    .trim();
}

function readinessFor(parts: unknown[]): ZoneReadiness {
  const filled = parts.filter((part) => {
    if (!part) return false;
    if (typeof part === 'string') return part.trim().length > 0;
    if (Array.isArray(part)) return part.length > 0;
    return true;
  }).length;
  if (filled === 0) return 'missing';
  return filled >= Math.max(1, Math.ceil(parts.length / 2)) ? 'ready' : 'partial';
}

function currency(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  return `$${value.toLocaleString()}`;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function phaseData<T>(block: BlockData | undefined, key: string): T | null {
  const data = block?.deepDiveData as unknown;
  if (!data || typeof data !== 'object') return null;
  const value = (data as Record<string, unknown>)[key];
  return value && typeof value === 'object' ? value as T : null;
}

function newerUnitEconomics(
  first: UnitEconomicsData | null | undefined,
  second: UnitEconomicsData | null | undefined,
): UnitEconomicsData | null {
  if (!first) return second ?? null;
  if (!second) return first;

  const firstTime = Date.parse(first.lastUpdated ?? '');
  const secondTime = Date.parse(second.lastUpdated ?? '');
  if (Number.isNaN(firstTime)) return second;
  if (Number.isNaN(secondTime)) return first;
  return secondTime > firstTime ? second : first;
}

function marketMetrics(data: MarketResearchData | null): MetricDefinition[] {
  const estimates = data?.tamSamSom;
  const scorecards = asArray<SegmentScorecard>(data?.scorecards);
  const metrics: MetricDefinition[] = [];

  if (estimates?.tam) {
    metrics.push({
      id: 'tam',
      name: 'TAM',
      targetThreshold: 'Large enough to support the revenue ambition stated in Revenue Streams',
      currentValue: currency(estimates.tam.value),
      source: 'Market Research TAM/SAM/SOM',
    });
  }
  if (estimates?.sam) {
    metrics.push({
      id: 'sam',
      name: 'SAM',
      targetThreshold: 'Serviceable market supports the selected beachhead and channel strategy',
      currentValue: currency(estimates.sam.value),
      source: 'Market Research TAM/SAM/SOM',
    });
  }
  if (estimates?.som) {
    metrics.push({
      id: 'som',
      name: 'SOM',
      targetThreshold: 'Obtainable market supports near-term revenue projections',
      currentValue: currency(estimates.som.value),
      source: 'Market Research TAM/SAM/SOM',
    });
  }

  for (const scorecard of scorecards) {
    metrics.push({
      id: `segment-score-${scorecard.segmentId}`,
      name: `Beachhead score: ${scorecard.segmentId}`,
      targetThreshold: '4.0+ indicates a strong beachhead candidate',
      currentValue: scorecard.overallScore,
      source: 'Segment Evaluation',
    });
  }

  return metrics;
}

function marketAssumptions(data: MarketResearchData | null): string[] {
  const scorecards = asArray<SegmentScorecard>(data?.scorecards);
  const risks = scorecards.flatMap((scorecard: SegmentScorecard) => scorecard.keyRisks ?? []);
  const experiments = scorecards.flatMap((scorecard: SegmentScorecard) => scorecard.requiredExperiments ?? []);
  return [...risks, ...experiments].filter(Boolean).slice(0, 8);
}

function unitEconomicsMetrics(segments: SegmentEconomics[]): MetricDefinition[] {
  return segments.flatMap((segment) => [
    {
      id: `ltv-cac-${segment.segmentId}`,
      name: `LTV:CAC ${segment.segmentName}`,
      targetThreshold: '3.0+ for a durable acquisition loop',
      currentValue: segment.ltvCacRatio,
      source: 'Unit Economics',
    },
    {
      id: `payback-${segment.segmentId}`,
      name: `CAC payback ${segment.segmentName}`,
      targetThreshold: 'Under 12 months for most early SaaS/B2C models',
      currentValue: segment.paybackMonths,
      unit: 'months',
      source: 'Unit Economics',
    },
  ]);
}

function jtbdPainTypes(statement: JTBDStatement): string[] {
  return [
    ...asArray<string>(statement.painTypes),
    ...asArray<{ type?: string }>(statement.pains)
      .map((pain) => pain.type)
      .filter((type): type is string => Boolean(type)),
  ];
}

function productScopeRows(data: ValueProductData | null): ProductScopeRow[] {
  return [
    ...asArray<ProductScopeRow>(data?.productScope),
    ...asArray<ProductScopeRow>(data?.productScopeRows),
  ];
}

function revenueModels(data: RevenuePricingData | null): RevenueModelEntry[] {
  const segmentModels = asArray<RevenuePricingSegment>(data?.segments).map((segment) => ({
    id: segment.segmentId,
    segmentId: segment.segmentId,
    model: segment.revenueModel,
    paymentMoment: segment.paymentMoment,
    price: segment.pricePoint,
  }));
  return [...asArray<RevenueModelEntry>(data?.models), ...segmentModels];
}

function revenueWtpTests(data: RevenuePricingData | null): WtpTestDraft[] {
  const segmentTests = asArray<RevenuePricingSegment>(data?.segments).map((segment) => ({
    id: segment.segmentId,
    segmentId: segment.segmentId,
    testType: segment.wtpTestPreference,
    description: `Run a ${segment.wtpTestPreference.replace('_', ' ')} test for ${segment.segmentName}`,
    successCriteria: `${segment.segmentName} makes a real payment commitment`,
    successThreshold: segment.pricePoint
      ? `Paid commitment at ${segment.pricePoint}`
      : 'Qualified paid commitment',
  }));
  return [...asArray<WtpTestDraft>(data?.wtpTests), ...segmentTests];
}

function jtbdMetrics(data: JTBDData | null): MetricDefinition[] {
  return asArray<JTBDStatement>(data?.statements).map((statement) => ({
    id: `jtbd-confidence-${statement.id}`,
    name: `JTBD confidence: ${statement.role}`,
    targetThreshold: 'High confidence from direct evidence before downstream value/product work',
    currentValue: statement.confidence ?? 'low',
    source: 'JTBD',
  }));
}

function jtbdAssumptions(data: JTBDData | null): string[] {
  return asArray<JTBDStatement>(data?.statements).map((statement) => {
    const segment = statement.segmentId ?? 'selected segment';
    return `${statement.role} job for ${segment}: ${statement.job}`;
  });
}

function valueProductMetrics(data: ValueProductData | null): MetricDefinition[] {
  return productScopeRows(data).map((row) => ({
    id: `product-proof-${row.id}`,
    name: `Proof metric: ${row.feature}`,
    targetThreshold: row.proofMetric,
    linkedAssumption: `${row.feature} will produce ${row.outcome}`,
    source: 'Value/Product Scope',
  }));
}

function valueProductAssumptions(data: ValueProductData | null): string[] {
  return productScopeRows(data).map((row) => (
    `${row.feature} will produce ${row.outcome}`
  ));
}

function revenuePricingMetrics(data: RevenuePricingData | null): MetricDefinition[] {
  return revenueWtpTests(data).map((test) => ({
    id: `wtp-threshold-${test.id}`,
    name: `WTP test threshold: ${test.testType}`,
    targetThreshold: test.successThreshold,
    linkedAssumption: test.successCriteria,
    source: 'Revenue/Pricing WTP',
  }));
}

function revenuePricingAssumptions(data: RevenuePricingData | null): string[] {
  return revenueModels(data).map((model) => {
    const segment = model.segmentId ?? 'selected segment';
    const price = model.price ?? model.model;
    return `${segment} will pay ${price} at moment: ${model.paymentMoment}`;
  });
}

export function buildZoneOutputs(blocks: BlockData[]): ZoneOutput[] {
  const byType = blockMap(blocks);
  const customerSegments = byType.get('customer_segments');
  const valueProp = byType.get('value_prop');
  const revenueStreams = byType.get('revenue_streams');
  const costStructure = byType.get('cost_structure');
  const marketData = customerSegments?.deepDiveData ?? null;
  const jtbd = phaseData<JTBDData>(customerSegments, 'jtbd') ?? phaseData<JTBDData>(valueProp, 'jtbd');
  const valueProduct = phaseData<ValueProductData>(valueProp, 'valueProduct');
  const revenuePricing = phaseData<RevenuePricingData>(revenueStreams, 'revenuePricing');
  const unitEconomics = newerUnitEconomics(
    revenueStreams?.deepDiveData?.unitEconomics,
    costStructure?.deepDiveData?.unitEconomics,
  );

  return ZONE_DEFINITIONS.map((definition) => {
    const sourceTexts = definition.sourceBlocks.map((type) => textFor(byType.get(type)));
    const metrics: MetricDefinition[] = [];
    const assumptions: string[] = [];
    const structuredData: Record<string, unknown> = {
      blockContent: Object.fromEntries(definition.sourceBlocks.map((type) => [type, textFor(byType.get(type))])),
    };

    if (definition.id === 'customer_market') {
      const segments = asArray(marketData?.segmentation?.segments);
      const personas = asArray(marketData?.personas?.personas);
      const competitors = asArray(marketData?.competitiveLandscape?.competitors);
      const validations = asArray(marketData?.marketValidation?.validations);
      const scorecards = asArray(marketData?.scorecards);

      structuredData.marketResearch = {
        tamSamSom: marketData?.tamSamSom ?? null,
        segmentCount: segments.length,
        personaCount: personas.length,
        competitorCount: competitors.length,
        validationCount: validations.length,
        scorecardCount: scorecards.length,
      };
      metrics.push(...marketMetrics(marketData));
      assumptions.push(...marketAssumptions(marketData));
    }

    if (definition.id === 'pain_jtbd' && jtbd) {
      const statements = asArray<JTBDStatement>(jtbd.statements);
      structuredData.jtbd = {
        statementCount: statements.length,
        roles: Array.from(new Set(statements.map((statement) => statement.role))),
        painTypes: Array.from(new Set(statements.flatMap(jtbdPainTypes))),
      };
      metrics.push(...jtbdMetrics(jtbd));
      assumptions.push(...jtbdAssumptions(jtbd));
    }

    if (definition.id === 'value_product' && valueProduct) {
      const productScope = productScopeRows(valueProduct);
      structuredData.valueProduct = {
        positioning: valueProduct.positioning ?? null,
        productScopeCount: productScope.length,
      };
      metrics.push(...valueProductMetrics(valueProduct));
      assumptions.push(...valueProductAssumptions(valueProduct));
    }

    if (definition.id === 'revenue_pricing' && revenuePricing) {
      const models = revenueModels(revenuePricing);
      const wtpTests = revenueWtpTests(revenuePricing);
      structuredData.revenuePricing = {
        modelCount: models.length,
        wtpTestCount: wtpTests.length,
        models: models.map((model) => model.model),
      };
      metrics.push(...revenuePricingMetrics(revenuePricing));
      assumptions.push(...revenuePricingAssumptions(revenuePricing));
    }

    if (definition.id === 'unit_economics' && unitEconomics) {
      const segments = asArray<SegmentEconomics>(unitEconomics.segments);
      const alerts = asArray<EconomicsAlert>(unitEconomics.alerts);
      structuredData.unitEconomics = {
        segmentCount: segments.length,
        blendedArpu: unitEconomics.globalMetrics?.blendedArpu,
        blendedCac: unitEconomics.globalMetrics?.blendedCac,
        blendedLtvCacRatio: unitEconomics.globalMetrics?.blendedLtvCacRatio,
        alertCount: alerts.length,
      };
      metrics.push(...unitEconomicsMetrics(segments));
      assumptions.push(...alerts.map((alert) => alert.message));
    }

    const readinessInputs = [
      ...sourceTexts,
      definition.id === 'customer_market' ? marketData?.tamSamSom : null,
      definition.id === 'customer_market' ? asArray(marketData?.segmentation?.segments) : null,
      definition.id === 'pain_jtbd' ? asArray(jtbd?.statements) : null,
      definition.id === 'value_product' ? productScopeRows(valueProduct) : null,
      definition.id === 'revenue_pricing' ? revenueModels(revenuePricing) : null,
      definition.id === 'revenue_pricing' ? revenueWtpTests(revenuePricing) : null,
      definition.id === 'unit_economics' ? asArray(unitEconomics?.segments) : null,
    ];
    const moduleReady =
      (definition.id === 'pain_jtbd' && asArray(jtbd?.statements).length > 0) ||
      (definition.id === 'value_product' && productScopeRows(valueProduct).length > 0) ||
      (definition.id === 'revenue_pricing' && (
        revenueModels(revenuePricing).length > 0 ||
        revenueWtpTests(revenuePricing).length > 0
      ));

    return {
      zone: definition.id,
      label: definition.label,
      sourceBlocks: definition.sourceBlocks,
      readiness: moduleReady ? 'ready' : readinessFor(readinessInputs),
      structuredData,
      assumptions,
      metrics,
      feedsInto: definition.feedsInto,
      updatedAt: new Date().toISOString(),
    };
  });
}
