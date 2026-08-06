import type {
  CaseDemandTest,
  CaseQuote,
  CaseScenarios,
  InvestmentCase,
  ScenarioResult,
  SystemRecommendation,
} from "@/lib/types/investment-case";
import { isCompleteQuote } from "@/lib/types/investment-case";

/** Spec §3.1 — per-unit landed cost from a single quote. */
export function computeLandedPerUnit(
  quote: Pick<
    CaseQuote,
    "fobPerUnit" | "freightMode" | "freightValue" | "dutyMode" | "dutyValue" | "moq"
  >,
): number {
  const freightPerUnit =
    quote.freightMode === "total"
      ? quote.moq > 0
        ? quote.freightValue / quote.moq
        : quote.freightValue // guard: undefined MOQ can't allocate a total, fall back to the raw value
      : quote.freightValue;

  const dutyPerUnit =
    quote.dutyMode === "pct"
      ? quote.fobPerUnit * (quote.dutyValue / 100)
      : quote.dutyValue;

  return quote.fobPerUnit + freightPerUnit + dutyPerUnit;
}

/** Spec §3.2 — one scenario's unit economics from a landed cost + volume. */
export function computeScenarioResult(
  landedPerUnit: number,
  sellPricePerUnit: number,
  volume: number,
  moq: number,
): ScenarioResult {
  const contributionPerUnit = sellPricePerUnit - landedPerUnit;
  const landedMarginPct =
    sellPricePerUnit === 0 ? null : (contributionPerUnit / sellPricePerUnit) * 100;
  const capitalRequired = landedPerUnit * Math.max(moq, volume);
  const breakEvenUnits =
    contributionPerUnit <= 0 ? Infinity : capitalRequired / contributionPerUnit;

  return { landedPerUnit, contributionPerUnit, landedMarginPct, capitalRequired, breakEvenUnits };
}

/**
 * Spec §3.3 — base/downside/upside from the case + its quotes + its demand test.
 *
 * MOQ note: capitalRequired always uses the *primary* quote's MOQ across all
 * three scenarios. MOQ is a supplier commitment tied to whichever supplier
 * you'd actually order from — it doesn't move when you stress-test cost.
 *
 * Upside fallback note: the spec only defines a synthetic downside fallback
 * (primary × 1.15 when there's no quote spread to take a max over). It leaves
 * upside's <2-quote fallback undefined; we use the primary's landed cost
 * unchanged (no synthetic markdown) since there's no basis to invent one.
 */
export function computeCaseScenarios(
  caseInput: Pick<InvestmentCase, "targetVolume" | "sellPricePerUnit">,
  quotes: CaseQuote[],
  demandTest: CaseDemandTest | null,
): CaseScenarios {
  const primary = quotes.find((q) => q.isPrimary) ?? null;

  if (!primary) {
    return { base: null, downside: null, downsideDemand: null, upside: null };
  }

  const sellPrice = caseInput.sellPricePerUnit ?? 0;
  const targetVolume = caseInput.targetVolume ?? 0;
  const primaryLanded = computeLandedPerUnit(primary);

  const base = computeScenarioResult(primaryLanded, sellPrice, targetVolume, primary.moq);

  const completeQuotes = quotes.filter(isCompleteQuote);
  const completeLanded = completeQuotes.map((q) => computeLandedPerUnit(q));

  const downsideLanded =
    completeLanded.length > 1 ? Math.max(...completeLanded) : primaryLanded * 1.15;
  const upsideLanded = completeLanded.length > 1 ? Math.min(...completeLanded) : primaryLanded;

  const downside = computeScenarioResult(
    downsideLanded,
    sellPrice,
    targetVolume * 0.5,
    primary.moq,
  );
  const upside = computeScenarioResult(upsideLanded, sellPrice, targetVolume * 1.5, primary.moq);

  const downsideDemand =
    demandTest === null
      ? null
      : demandTest.result === null
        ? { treatedAsFailed: true, value: null }
        : { treatedAsFailed: false, value: demandTest.result * 0.5 };

  return { base, downside, downsideDemand, upside };
}

/**
 * Spec §3.4 — non-binding system recommendation. Never sets `verdict`;
 * the founder always sets that explicitly.
 */
export function computeSystemRecommendation(
  caseInput: Pick<
    InvestmentCase,
    | "targetVolumeTag"
    | "targetVolumePlannedTest"
    | "sellPriceTag"
    | "sellPricePlannedTest"
    | "killMarginPct"
    | "killDemandMetric"
    | "killDemandThreshold"
  >,
  scenarios: CaseScenarios,
  demandTest: CaseDemandTest | null,
): SystemRecommendation {
  // No primary quote yet -> nothing to recommend on.
  if (!scenarios.base) return "test_again";

  const hasUnresolvedUntested =
    (caseInput.targetVolumeTag === "Untested" &&
      caseInput.targetVolumePlannedTest.trim().length === 0) ||
    (caseInput.sellPriceTag === "Untested" && caseInput.sellPricePlannedTest.trim().length === 0);
  if (hasUnresolvedUntested) return "test_again";

  // null margin = sellPrice not entered yet (missing data), not proven-bad
  // economics — that's a "go test more", not a "kill".
  if (scenarios.base.landedMarginPct === null) return "test_again";
  if (scenarios.base.landedMarginPct < caseInput.killMarginPct) return "kill";

  if (caseInput.killDemandMetric.trim().length > 0) {
    if (!demandTest || demandTest.status !== "done" || demandTest.result === null) {
      return "test_again";
    }
    if (demandTest.result < (caseInput.killDemandThreshold ?? 0)) return "kill";
    return "invest";
  }

  return "invest";
}
