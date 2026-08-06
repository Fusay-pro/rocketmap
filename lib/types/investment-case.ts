/** Investment Case module — spec: docs/INVESTMENT_CASE_SPEC.md */

export type EvidenceTag = "Quoted" | "Measured" | "Untested";
export type CaseStatus = "draft" | "published";
export type CaseVerdict = "invest" | "test_again" | "kill" | "unset";
export type SystemRecommendation = "invest" | "test_again" | "kill";
export type FreightMode = "total" | "per_unit";
export type DutyMode = "pct" | "per_unit";
export type DemandTestMethod =
  | "landing"
  | "preorder"
  | "outreach"
  | "interview"
  | "other";
export type DemandTestStatus = "planned" | "running" | "done";

export interface InvestmentCase {
  $id: string;
  userId: string;
  status: CaseStatus;
  publishedAt: string | null;
  title: string;
  currency: string;
  skuDescription: string;
  targetVolume: number | null;
  targetVolumeTag: EvidenceTag;
  targetVolumeSourceNote: string;
  targetVolumePlannedTest: string;
  sellPricePerUnit: number | null;
  sellPriceTag: EvidenceTag;
  sellPriceSourceNote: string;
  sellPricePlannedTest: string;
  capitalAvailable: number | null;
  killMarginPct: number;
  killDemandMetric: string;
  killDemandThreshold: number | null;
  nextCheapestTest: string;
  verdict: CaseVerdict;
  verdictNote: string;
  systemRecommendation: SystemRecommendation | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaseQuote {
  $id: string;
  caseId: string;
  supplierName: string;
  moq: number;
  fobPerUnit: number;
  freightMode: FreightMode;
  freightValue: number;
  dutyMode: DutyMode;
  dutyValue: number;
  leadTimeDays: number | null;
  paymentTerms: string;
  attachmentFileId: string | null;
  quoteDate: string;
  isPrimary: boolean;
}

export interface CaseDemandTest {
  $id: string;
  caseId: string;
  hypothesis: string;
  method: DemandTestMethod;
  metricName: string;
  threshold: number | null;
  result: number | null;
  sampleSize: number | null;
  status: DemandTestStatus;
  evidenceFileId: string | null;
}

/** A quote with FOB + freight + duty + attachment — usable in published math. */
export function isCompleteQuote(quote: CaseQuote): boolean {
  return (
    quote.fobPerUnit > 0 &&
    quote.freightValue >= 0 &&
    quote.dutyValue >= 0 &&
    Boolean(quote.attachmentFileId)
  );
}

export interface ScenarioResult {
  landedPerUnit: number;
  contributionPerUnit: number;
  landedMarginPct: number | null; // null = N/A (sellPrice is 0)
  capitalRequired: number;
  breakEvenUnits: number; // Infinity when contribution <= 0
}

export interface CaseScenarios {
  base: ScenarioResult | null; // null when there's no primary quote
  downside: ScenarioResult | null;
  /** Narrative-only per spec §3.3: not part of the unit-econ math. */
  downsideDemand: { treatedAsFailed: boolean; value: number | null } | null;
  upside: ScenarioResult | null;
}

export interface FieldValidationError {
  field: string;
  message: string;
}

export interface PublishValidationResult {
  valid: boolean;
  errors: FieldValidationError[];
}

export interface CaseMemo {
  title: string;
  publishedAt: string | null;
  currency: string;
  skuDescription: string;
  verdict: CaseVerdict;
  systemRecommendation: SystemRecommendation | null;
  disclaimer: string;
  base: ScenarioResult | null;
  scenarios: CaseScenarios;
  knowns: Array<{ field: string; tag: EvidenceTag; value: string; source: string }>;
  unknowns: Array<{ field: string; plannedTest: string }>;
  demandTest: CaseDemandTest | null;
  killCriteria: { killMarginPct: number; killDemandMetric: string; killDemandThreshold: number | null };
  nextCheapestTest: string | null;
}
