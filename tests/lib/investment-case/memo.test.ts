import { describe, expect, it } from "vitest";
import { buildCaseMemo } from "@/lib/investment-case/memo";
import type { FullCase } from "@/lib/investment-case/db";
import type { InvestmentCase } from "@/lib/types/investment-case";

function makeCase(overrides: Partial<InvestmentCase> = {}): InvestmentCase {
  return {
    $id: "case-1",
    userId: "user-1",
    status: "draft",
    publishedAt: null,
    title: "Test venture",
    currency: "USD",
    skuDescription: "Widget",
    targetVolume: 200,
    targetVolumeTag: "Quoted",
    targetVolumeSourceNote: "preorder list",
    targetVolumePlannedTest: "",
    sellPricePerUnit: 25,
    sellPriceTag: "Untested",
    sellPriceSourceNote: "",
    sellPricePlannedTest: "landing page A/B test",
    capitalAvailable: null,
    killMarginPct: 20,
    killDemandMetric: "preorders",
    killDemandThreshold: 50,
    nextCheapestTest: "run a $5 deposit test",
    verdict: "test_again",
    verdictNote: "",
    systemRecommendation: "test_again",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeFullCase(overrides: Partial<InvestmentCase> = {}): FullCase {
  const investmentCase = makeCase(overrides);
  return {
    investmentCase,
    quotes: [],
    demandTest: null,
    scenarios: { base: null, downside: null, downsideDemand: null, upside: null },
    systemRecommendation: investmentCase.systemRecommendation ?? "test_again",
  };
}

describe("buildCaseMemo", () => {
  it("sorts a Quoted field into knowns and an Untested field into unknowns", () => {
    const memo = buildCaseMemo(makeFullCase());
    expect(memo.knowns.find((k) => k.field === "targetVolume")).toMatchObject({
      tag: "Quoted",
      source: "preorder list",
    });
    expect(memo.unknowns.find((u) => u.field === "sellPricePerUnit")).toMatchObject({
      plannedTest: "landing page A/B test",
    });
  });

  it("always includes the fixed disclaimer", () => {
    const memo = buildCaseMemo(makeFullCase());
    expect(memo.disclaimer).toBe("Not financial advice; founder judgment required.");
  });

  it("carries kill criteria through unchanged", () => {
    const memo = buildCaseMemo(makeFullCase());
    expect(memo.killCriteria).toEqual({
      killMarginPct: 20,
      killDemandMetric: "preorders",
      killDemandThreshold: 50,
    });
  });

  it("nulls out nextCheapestTest when it's blank", () => {
    const memo = buildCaseMemo(makeFullCase({ nextCheapestTest: "" }));
    expect(memo.nextCheapestTest).toBeNull();
  });

  it("carries the founder verdict, not just the system recommendation", () => {
    const memo = buildCaseMemo(makeFullCase({ verdict: "kill" }));
    expect(memo.verdict).toBe("kill");
    expect(memo.systemRecommendation).toBe("test_again");
  });
});
