import { describe, expect, it } from "vitest";
import {
  deriveQptpFromViability,
  deriveCategoryCounts,
} from "@/lib/utils/evidence-counts";
import type { Assumption, ViabilityData } from "@/lib/types/canvas";

/** Mirrors the real payload shape on the one canvas that carries factors. */
const NEW_SHAPE: Partial<ViabilityData> = {
  score: 34,
  potentialScore: 61,
  breakdown: { assumptions: 30, market: 42, unmetNeed: 31 },
  factorsUp: ["repeat rate above benchmark", "direct suppliers", "freshness dating"],
  factorsDown: [
    "price 2.4x mass-market with no WTP evidence",
    "retention assumption has no cohort data",
    "CAC measured only at low spend",
    "co-packer capacity untested",
  ],
  whatAbout: "What survives if willingness to pay lands at ฿240 instead of ฿320?",
  unlockSteps: [],
};

/** The pre-factors payload 11 of 28 real canvases still carry. */
const LEGACY_SHAPE: Partial<ViabilityData> = {
  score: 41,
  breakdown: { assumptions: 38, market: 45, unmetNeed: 40 },
  reasoning: "older payload",
  validatedAssumptions: [],
};

function step(status: string) {
  return {
    assumptionId: `a-${Math.random()}`,
    assumption: "x",
    blockTypes: [],
    riskLevel: "high",
    status,
    upliftPoints: 5,
    suggestedTest: "t",
  } as unknown as NonNullable<ViabilityData["unlockSteps"]>[number];
}

describe("deriveQptpFromViability", () => {
  it("counts factorsDown as problems and whatAbout as a question", () => {
    expect(deriveQptpFromViability(NEW_SHAPE)).toEqual({ questions: 1, problems: 4 });
  });

  it("returns null for a legacy payload with no factor arrays", () => {
    // The 27-canvas case: rendering 0Q · 0PTP here would be a fabrication.
    expect(deriveQptpFromViability(LEGACY_SHAPE)).toBeNull();
  });

  it("returns null when factors were normalized to empty arrays", () => {
    expect(
      deriveQptpFromViability({ ...LEGACY_SHAPE, factorsUp: [], factorsDown: [] }),
    ).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(deriveQptpFromViability(null)).toBeNull();
    expect(deriveQptpFromViability(undefined)).toBeNull();
  });

  it("counts a whatAbout alone, with zero problems", () => {
    expect(deriveQptpFromViability({ whatAbout: "one open question" })).toEqual({
      questions: 1,
      problems: 0,
    });
  });

  it("ignores a whitespace-only whatAbout", () => {
    expect(deriveQptpFromViability({ whatAbout: "   " })).toBeNull();
  });

  it("adds open unlock steps to the question count", () => {
    const result = deriveQptpFromViability({
      ...NEW_SHAPE,
      unlockSteps: [step("untested"), step("testing"), step("validated")],
    });
    // 1 whatAbout + 2 open (validated excluded)
    expect(result).toEqual({ questions: 3, problems: 4 });
  });

  it("still counts when only factorsUp exists (strengths but no problems)", () => {
    expect(deriveQptpFromViability({ factorsUp: ["a", "b"] })).toEqual({
      questions: 0,
      problems: 0,
    });
  });
});

function asm(category: string, status: string) {
  return { category, status } as Pick<Assumption, "category" | "status">;
}

describe("deriveCategoryCounts", () => {
  it("counts untested and testing per category, sorted descending", () => {
    const result = deriveCategoryCounts([
      asm("market", "untested"),
      asm("market", "untested"),
      asm("market", "testing"),
      asm("ops", "untested"),
      asm("ops", "untested"),
      asm("product", "untested"),
    ]);
    expect(result).toEqual([
      { category: "market", count: 3 },
      { category: "ops", count: 2 },
      { category: "product", count: 1 },
    ]);
  });

  it("excludes validated and refuted assumptions", () => {
    const result = deriveCategoryCounts([
      asm("market", "untested"),
      asm("market", "validated"),
      asm("market", "refuted"),
      asm("market", "inconclusive"),
    ]);
    expect(result).toEqual([{ category: "market", count: 1 }]);
  });

  it("returns null when nothing is outstanding", () => {
    expect(
      deriveCategoryCounts([asm("market", "validated"), asm("ops", "refuted")]),
    ).toBeNull();
  });

  it("returns null for an empty or missing list", () => {
    expect(deriveCategoryCounts([])).toBeNull();
    expect(deriveCategoryCounts(null)).toBeNull();
    expect(deriveCategoryCounts(undefined)).toBeNull();
  });

  it("drops categories that have no outstanding assumptions", () => {
    const result = deriveCategoryCounts([
      asm("market", "untested"),
      asm("legal", "validated"),
    ]);
    expect(result).toEqual([{ category: "market", count: 1 }]);
    expect(result?.some((r) => r.category === "legal")).toBe(false);
  });

  it("breaks count ties alphabetically for a stable order", () => {
    const result = deriveCategoryCounts([
      asm("ops", "untested"),
      asm("legal", "untested"),
      asm("market", "untested"),
    ]);
    expect(result?.map((r) => r.category)).toEqual(["legal", "market", "ops"]);
  });
});
