import type { CaseMemo } from "@/lib/types/investment-case";
import type { FullCase } from "@/lib/investment-case/db";

const DISCLAIMER = "Not financial advice; founder judgment required.";

/** Spec §7 — the 9-section Dad Decision Memo, computed live, never stored separately. */
export function buildCaseMemo(full: FullCase): CaseMemo {
  const c = full.investmentCase;

  const knowns: CaseMemo["knowns"] = [];
  const unknowns: CaseMemo["unknowns"] = [];

  if (c.sellPriceTag === "Untested") {
    unknowns.push({ field: "sellPricePerUnit", plannedTest: c.sellPricePlannedTest });
  } else {
    knowns.push({
      field: "sellPricePerUnit",
      tag: c.sellPriceTag,
      value: c.sellPricePerUnit !== null ? String(c.sellPricePerUnit) : "",
      source: c.sellPriceSourceNote,
    });
  }

  if (c.targetVolumeTag === "Untested") {
    unknowns.push({ field: "targetVolume", plannedTest: c.targetVolumePlannedTest });
  } else {
    knowns.push({
      field: "targetVolume",
      tag: c.targetVolumeTag,
      value: c.targetVolume !== null ? String(c.targetVolume) : "",
      source: c.targetVolumeSourceNote,
    });
  }

  return {
    title: c.title,
    publishedAt: c.publishedAt,
    currency: c.currency,
    skuDescription: c.skuDescription,
    verdict: c.verdict,
    systemRecommendation: full.systemRecommendation,
    disclaimer: DISCLAIMER,
    base: full.scenarios.base,
    scenarios: full.scenarios,
    knowns,
    unknowns,
    demandTest: full.demandTest,
    killCriteria: {
      killMarginPct: c.killMarginPct,
      killDemandMetric: c.killDemandMetric,
      killDemandThreshold: c.killDemandThreshold,
    },
    nextCheapestTest: c.nextCheapestTest.trim().length > 0 ? c.nextCheapestTest : null,
  };
}
