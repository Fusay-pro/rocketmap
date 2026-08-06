import { describe, expect, it } from "vitest";
import { validateForPublish } from "@/lib/investment-case/validation";
import type { CaseDemandTest, CaseQuote, InvestmentCase } from "@/lib/types/investment-case";

function makeQuote(overrides: Partial<CaseQuote> = {}): CaseQuote {
  return {
    $id: "quote-1",
    caseId: "case-1",
    supplierName: "Supplier A",
    moq: 100,
    fobPerUnit: 10,
    freightMode: "total",
    freightValue: 500,
    dutyMode: "pct",
    dutyValue: 10,
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
    verdict: "invest",
    verdictNote: "margins clear the bar",
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
    hypothesis: "People will preorder at $25",
    method: "preorder",
    metricName: "preorders",
    threshold: 50,
    result: 60,
    sampleSize: 200,
    status: "done",
    evidenceFileId: "file-2",
    ...overrides,
  };
}

describe("validateForPublish", () => {
  it("passes a fully-formed, correctly-tagged case", () => {
    const result = validateForPublish(makeCase(), [makeQuote()], null);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when there is no primary quote", () => {
    const result = validateForPublish(makeCase(), [makeQuote({ isPrimary: false })], null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "quotes")).toBe(true);
  });

  it("fails when the primary quote has no attachment", () => {
    const result = validateForPublish(makeCase(), [makeQuote({ attachmentFileId: null })], null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "quotes.attachmentFileId")).toBe(true);
  });

  it("fails when a Quoted field has no source note", () => {
    const result = validateForPublish(
      makeCase({ sellPriceTag: "Quoted", sellPriceSourceNote: "" }),
      [makeQuote()],
      null,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "sellPrice")).toBe(true);
  });

  it("fails when an Untested field has no planned test", () => {
    const result = validateForPublish(
      makeCase({ targetVolumeTag: "Untested", targetVolumePlannedTest: "" }),
      [makeQuote()],
      null,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "targetVolume")).toBe(true);
  });

  it("passes an Untested field once a planned test is named", () => {
    const result = validateForPublish(
      makeCase({ targetVolumeTag: "Untested", targetVolumePlannedTest: "landing page waitlist" }),
      [makeQuote()],
      null,
    );
    expect(result.valid).toBe(true);
  });

  it("requires demand-test evidence when a Measured tag is used", () => {
    const result = validateForPublish(
      makeCase({ sellPriceTag: "Measured" }),
      [makeQuote()],
      null,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "demandTest")).toBe(true);
  });

  it("passes a Measured tag once the demand test carries evidence", () => {
    const result = validateForPublish(
      makeCase({ sellPriceTag: "Measured" }),
      [makeQuote()],
      makeDemandTest({ evidenceFileId: "file-9" }),
    );
    expect(result.valid).toBe(true);
  });

  it("fails when killDemandMetric is set but the demand test metricName doesn't match", () => {
    const result = validateForPublish(
      makeCase({ killDemandMetric: "signups", killDemandThreshold: 50 }),
      [makeQuote()],
      makeDemandTest({ metricName: "preorders", threshold: 50 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "demandTest.metricName")).toBe(true);
  });

  it("fails when the demand test threshold is out of sync with killDemandThreshold", () => {
    const result = validateForPublish(
      makeCase({ killDemandMetric: "preorders", killDemandThreshold: 75 }),
      [makeQuote()],
      makeDemandTest({ metricName: "preorders", threshold: 50 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "demandTest.threshold")).toBe(true);
  });

  it("fails when verdict is unset", () => {
    const result = validateForPublish(makeCase({ verdict: "unset" }), [makeQuote()], null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "verdict")).toBe(true);
  });

  it("collects multiple errors at once rather than stopping at the first", () => {
    const result = validateForPublish(
      makeCase({ sellPriceSourceNote: "", verdict: "unset" }),
      [],
      null,
    );
    expect(result.errors.length).toBeGreaterThanOrEqual(3); // no primary quote, no source note, no verdict
  });

  it("refuses to publish when two quotes are both marked primary", () => {
    // unsetOtherPrimaryQuotes is a read-then-write with no DB constraint behind
    // it, so concurrency or a console edit can produce this. Publishing on
    // whichever sorted first would use numbers the founder never chose.
    const result = validateForPublish(
      makeCase({ verdict: "invest" }),
      [
        makeQuote({ $id: "q1", supplierName: "Supplier A", isPrimary: true }),
        makeQuote({ $id: "q2", supplierName: "Supplier B", isPrimary: true }),
      ],
      null,
    );
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.field === "quotes");
    expect(err?.message).toContain("2 quotes are marked primary");
    expect(err?.message).toContain("Supplier A");
    expect(err?.message).toContain("Supplier B");
  });

  it("still publishes with exactly one primary among several quotes", () => {
    const result = validateForPublish(
      makeCase({ verdict: "invest" }),
      [
        makeQuote({ $id: "q1", isPrimary: true }),
        makeQuote({ $id: "q2", isPrimary: false, attachmentFileId: null }),
      ],
      null,
    );
    expect(result.valid).toBe(true);
  });
});
