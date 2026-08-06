import { describe, expect, it } from "vitest";
import {
  computeCaseScenarios,
  computeLandedPerUnit,
  computeScenarioResult,
  computeSystemRecommendation,
} from "@/lib/investment-case/formulas";
import type { CaseDemandTest, CaseQuote, InvestmentCase } from "@/lib/types/investment-case";

function makeQuote(overrides: Partial<CaseQuote> = {}): CaseQuote {
  return {
    $id: "quote-1",
    caseId: "case-1",
    supplierName: "Supplier A",
    moq: 100,
    fobPerUnit: 10,
    freightMode: "total",
    freightValue: 500, // 500/100 = 5/unit
    dutyMode: "pct",
    dutyValue: 10, // 10% of 10 = 1/unit
    leadTimeDays: 30,
    paymentTerms: "50/50",
    attachmentFileId: "file-1",
    quoteDate: "2026-01-01T00:00:00.000Z",
    isPrimary: true,
    ...overrides,
  };
}

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
    targetVolumeSourceNote: "customer preorder list",
    targetVolumePlannedTest: "",
    sellPricePerUnit: 25,
    sellPriceTag: "Quoted",
    sellPriceSourceNote: "customer LOI",
    sellPricePlannedTest: "",
    capitalAvailable: null,
    killMarginPct: 20,
    killDemandMetric: "",
    killDemandThreshold: null,
    nextCheapestTest: "",
    verdict: "unset",
    verdictNote: "",
    systemRecommendation: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDemandTest(overrides: Partial<CaseDemandTest> = {}): CaseDemandTest {
  return {
    $id: "demand-1",
    caseId: "case-1",
    hypothesis: "People will preorder",
    method: "preorder",
    metricName: "preorders",
    threshold: 50,
    result: null,
    sampleSize: 200,
    status: "planned",
    evidenceFileId: null,
    ...overrides,
  };
}

describe("computeLandedPerUnit", () => {
  it("allocates a total freight value by MOQ and a pct duty by FOB (spec §3.1)", () => {
    // freight: 500/100 = 5, duty: 10% of 10 = 1 -> landed = 10 + 5 + 1 = 16
    expect(computeLandedPerUnit(makeQuote())).toBe(16);
  });

  it("uses freightValue directly in per_unit mode", () => {
    const landed = computeLandedPerUnit(
      makeQuote({ freightMode: "per_unit", freightValue: 3, dutyMode: "per_unit", dutyValue: 2 }),
    );
    expect(landed).toBe(10 + 3 + 2);
  });

  it("does not divide by zero when MOQ is unset under total freight mode", () => {
    const landed = computeLandedPerUnit(makeQuote({ moq: 0, freightValue: 500 }));
    expect(Number.isFinite(landed)).toBe(true);
  });
});

describe("computeScenarioResult", () => {
  it("computes contribution, margin%, capital, and break-even (spec §3.2)", () => {
    const result = computeScenarioResult(16, 25, 200, 100);
    expect(result.contributionPerUnit).toBe(9);
    expect(result.landedMarginPct).toBeCloseTo(36, 5); // 9/25*100
    expect(result.capitalRequired).toBe(16 * 200); // max(100, 200) = 200
    expect(result.breakEvenUnits).toBeCloseTo((16 * 200) / 9, 5);
  });

  it("returns null margin (N/A) when sell price is zero", () => {
    const result = computeScenarioResult(16, 0, 200, 100);
    expect(result.landedMarginPct).toBeNull();
  });

  it("returns Infinity break-even when contribution is zero or negative", () => {
    const result = computeScenarioResult(30, 25, 200, 100);
    expect(result.contributionPerUnit).toBe(-5);
    expect(result.breakEvenUnits).toBe(Infinity);
  });

  it("uses MOQ as the capital floor when volume is below it", () => {
    const result = computeScenarioResult(16, 25, 50, 100);
    expect(result.capitalRequired).toBe(16 * 100); // max(100, 50) = 100
  });
});

describe("computeCaseScenarios", () => {
  it("returns all-null scenarios when there's no primary quote", () => {
    const scenarios = computeCaseScenarios(makeCase(), [], null);
    expect(scenarios).toEqual({ base: null, downside: null, downsideDemand: null, upside: null });
  });

  it("applies the base scenario from the primary quote and full target volume", () => {
    const scenarios = computeCaseScenarios(makeCase(), [makeQuote()], null);
    expect(scenarios.base).not.toBeNull();
    expect(scenarios.base!.landedPerUnit).toBe(16);
  });

  it("falls back to primary × 1.15 landed cost for downside with < 2 complete quotes", () => {
    const scenarios = computeCaseScenarios(makeCase(), [makeQuote()], null);
    expect(scenarios.downside!.landedPerUnit).toBeCloseTo(16 * 1.15, 5);
  });

  it("uses max/min landed cost across complete quotes when there are 2+", () => {
    const cheap = makeQuote({ $id: "q2", isPrimary: false, fobPerUnit: 8, dutyValue: 5 }); // landed lower
    const expensive = makeQuote({ $id: "q3", isPrimary: false, fobPerUnit: 15, dutyValue: 20 }); // landed higher
    const scenarios = computeCaseScenarios(makeCase(), [makeQuote(), cheap, expensive], null);

    const cheapLanded = computeLandedPerUnit(cheap);
    const expensiveLanded = computeLandedPerUnit(expensive);
    expect(scenarios.downside!.landedPerUnit).toBeCloseTo(
      Math.max(16, cheapLanded, expensiveLanded),
      5,
    );
    expect(scenarios.upside!.landedPerUnit).toBeCloseTo(
      Math.min(16, cheapLanded, expensiveLanded),
      5,
    );
  });

  it("excludes incomplete quotes (no attachment) from the max/min set", () => {
    const noAttachment = makeQuote({ $id: "q2", isPrimary: false, fobPerUnit: 1, attachmentFileId: null });
    const scenarios = computeCaseScenarios(makeCase(), [makeQuote(), noAttachment], null);
    // only 1 complete quote (the primary) -> falls back to the 1.15x rule, not the (excluded) cheap quote
    expect(scenarios.downside!.landedPerUnit).toBeCloseTo(16 * 1.15, 5);
  });

  it("halves target volume for downside and adds 50% for upside", () => {
    const scenarios = computeCaseScenarios(makeCase({ targetVolume: 200 }), [makeQuote()], null);
    expect(scenarios.downside!.capitalRequired).toBe(scenarios.downside!.landedPerUnit * 100); // max(100 moq, 100 vol)
    expect(scenarios.upside!.capitalRequired).toBe(scenarios.upside!.landedPerUnit * 300); // max(100 moq, 300 vol)
  });

  it("treats null demand result as failed in the downside narrative", () => {
    const scenarios = computeCaseScenarios(
      makeCase(),
      [makeQuote()],
      makeDemandTest({ result: null }),
    );
    expect(scenarios.downsideDemand).toEqual({ treatedAsFailed: true, value: null });
  });

  it("uses 50% of the measured demand result in the downside narrative", () => {
    const scenarios = computeCaseScenarios(
      makeCase(),
      [makeQuote()],
      makeDemandTest({ status: "done", result: 80 }),
    );
    expect(scenarios.downsideDemand).toEqual({ treatedAsFailed: false, value: 40 });
  });
});

describe("computeSystemRecommendation", () => {
  it("recommends test_again when there's no base scenario yet", () => {
    const rec = computeSystemRecommendation(
      makeCase(),
      { base: null, downside: null, downsideDemand: null, upside: null },
      null,
    );
    expect(rec).toBe("test_again");
  });

  it("recommends test_again when a load-bearing field is Untested without a planned test", () => {
    const caseInput = makeCase({ sellPriceTag: "Untested", sellPricePlannedTest: "" });
    const scenarios = computeCaseScenarios(caseInput, [makeQuote()], null);
    expect(computeSystemRecommendation(caseInput, scenarios, null)).toBe("test_again");
  });

  it("does not block on Untested when a planned test is named", () => {
    const caseInput = makeCase({
      sellPriceTag: "Untested",
      sellPricePlannedTest: "$5 deposit test",
      killMarginPct: 0,
    });
    const scenarios = computeCaseScenarios(caseInput, [makeQuote()], null);
    expect(computeSystemRecommendation(caseInput, scenarios, null)).toBe("invest");
  });

  it("recommends kill when base margin falls below killMarginPct", () => {
    const caseInput = makeCase({ killMarginPct: 90 }); // 36% base margin < 90% kill line
    const scenarios = computeCaseScenarios(caseInput, [makeQuote()], null);
    expect(computeSystemRecommendation(caseInput, scenarios, null)).toBe("kill");
  });

  it("recommends test_again (not kill) when sell price is unset (null margin)", () => {
    const caseInput = makeCase({ sellPricePerUnit: 0, killMarginPct: 90 });
    const scenarios = computeCaseScenarios(caseInput, [makeQuote()], null);
    expect(scenarios.base!.landedMarginPct).toBeNull();
    expect(computeSystemRecommendation(caseInput, scenarios, null)).toBe("test_again");
  });

  it("recommends invest when margin clears and no demand kill metric is set", () => {
    const caseInput = makeCase({ killMarginPct: 10, killDemandMetric: "" });
    const scenarios = computeCaseScenarios(caseInput, [makeQuote()], null);
    expect(computeSystemRecommendation(caseInput, scenarios, null)).toBe("invest");
  });

  it("recommends test_again when a demand kill metric is set but the test isn't done", () => {
    const caseInput = makeCase({ killMarginPct: 10, killDemandMetric: "preorders", killDemandThreshold: 50 });
    const scenarios = computeCaseScenarios(caseInput, [makeQuote()], makeDemandTest({ status: "running" }));
    expect(
      computeSystemRecommendation(caseInput, scenarios, makeDemandTest({ status: "running" })),
    ).toBe("test_again");
  });

  it("recommends kill when the demand test finished below threshold (spec §6 fixture)", () => {
    const caseInput = makeCase({ killMarginPct: 10, killDemandMetric: "preorders", killDemandThreshold: 50 });
    const scenarios = computeCaseScenarios(caseInput, [makeQuote()], null);
    const demandTest = makeDemandTest({ status: "done", result: 30, threshold: 50 });
    expect(computeSystemRecommendation(caseInput, scenarios, demandTest)).toBe("kill");
  });

  it("recommends invest when the demand test finished at/above threshold", () => {
    const caseInput = makeCase({ killMarginPct: 10, killDemandMetric: "preorders", killDemandThreshold: 50 });
    const scenarios = computeCaseScenarios(caseInput, [makeQuote()], null);
    const demandTest = makeDemandTest({ status: "done", result: 60, threshold: 50 });
    expect(computeSystemRecommendation(caseInput, scenarios, demandTest)).toBe("invest");
  });
});
