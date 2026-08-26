import { describe, expect, it } from "vitest";
import {
  getBadgeState,
  hasInvalidatedCriticalAssumptions,
  mergeUnlockStepsWithAssumptions,
  normalizeViabilityData,
} from "@/lib/utils/viability";
import { severityColor, severityColorFromCount } from "@/lib/utils/qptp";
import type { ViabilityData, ViabilityUnlockStep } from "@/lib/types/canvas";

function step(overrides: Partial<ViabilityUnlockStep> = {}): ViabilityUnlockStep {
  return {
    assumptionId: "a1",
    assumption: "Customers will pay",
    blockTypes: [],
    riskLevel: "high",
    status: "untested",
    upliftPoints: 5,
    suggestedTest: "run a deposit test",
    ...overrides,
  } as ViabilityUnlockStep;
}

function data(overrides: Partial<ViabilityData> = {}) {
  return { unlockSteps: [], factorsUp: [], ...overrides } as Pick<
    ViabilityData,
    "unlockSteps" | "factorsUp"
  >;
}

describe("hasInvalidatedCriticalAssumptions", () => {
  it("flags a refuted high-risk step", () => {
    expect(hasInvalidatedCriticalAssumptions([step({ status: "refuted" })])).toBe(true);
  });

  it("ignores a refuted low-risk step", () => {
    expect(
      hasInvalidatedCriticalAssumptions([step({ status: "refuted", riskLevel: "low" })]),
    ).toBe(false);
  });

  it("does not throw on undefined — the raw onDataChange payload path", () => {
    expect(() => hasInvalidatedCriticalAssumptions(undefined)).not.toThrow();
    expect(hasInvalidatedCriticalAssumptions(undefined)).toBe(false);
    expect(hasInvalidatedCriticalAssumptions(null)).toBe(false);
  });
});

describe("getBadgeState", () => {
  it("warns when a critical assumption has been invalidated, whatever the count", () => {
    expect(getBadgeState(data({ unlockSteps: [step({ status: "refuted" })] }), 0)).toBe(
      "warning",
    );
  });

  it("warns at three or more open problems", () => {
    expect(getBadgeState(data(), 3)).toBe("warning");
    expect(getBadgeState(data(), 7)).toBe("warning");
  });

  it("is healthy with no problems and at least one strength", () => {
    expect(getBadgeState(data({ factorsUp: ["strong retention"] }), 0)).toBe("healthy");
  });

  it("is calm with no problems but nothing proven either", () => {
    expect(getBadgeState(data(), 0)).toBe("calm");
  });

  it("is calm at one or two problems", () => {
    expect(getBadgeState(data(), 1)).toBe("calm");
    expect(getBadgeState(data(), 2)).toBe("calm");
  });

  it("does not throw on a null payload", () => {
    expect(() => getBadgeState(null, 2)).not.toThrow();
    expect(getBadgeState(undefined, 0)).toBe("calm");
  });
});

describe("severityColor", () => {
  it("takes the worst severity present", () => {
    expect(severityColor([{ severity: "minor" }, { severity: "critical" }])).toBe(
      "var(--state-critical)",
    );
    expect(severityColor([{ severity: "minor" }, { severity: "major" }])).toBe(
      "var(--state-warning)",
    );
    expect(severityColor([{ severity: "minor" }])).toBe("var(--state-healthy)");
    expect(severityColor([])).toBe("var(--state-healthy)");
  });
});

describe("severityColorFromCount", () => {
  it("escalates to critical when a critical assumption was invalidated", () => {
    expect(severityColorFromCount(0, true)).toBe("var(--state-critical)");
  });

  it("warns from three problems up", () => {
    expect(severityColorFromCount(3)).toBe("var(--state-warning)");
  });

  it("is healthy at zero", () => {
    expect(severityColorFromCount(0)).toBe("var(--state-healthy)");
  });
});

describe("mergeUnlockStepsWithAssumptions", () => {
  it("overlays live assumption status onto stored steps", () => {
    const merged = mergeUnlockStepsWithAssumptions(
      [step({ assumptionId: "a1", status: "untested" })],
      [
        {
          $id: "a1",
          statement: "Customers will pay",
          blockTypes: [],
          riskLevel: "high",
          status: "validated",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
    );
    expect(merged[0].status).toBe("validated");
  });

  it("leaves steps untouched when the assumption is not in the live list", () => {
    const merged = mergeUnlockStepsWithAssumptions(
      [step({ assumptionId: "missing", status: "untested" })],
      [],
    );
    expect(merged[0].status).toBe("untested");
  });
});

describe("normalizeViabilityData", () => {
  it("accepts a new-format payload with verdict and factors but no score", () => {
    const result = normalizeViabilityData({
      verdict: "Real demand signal, unproven pricing.",
      factorsDown: ["No willingness-to-pay evidence"],
      unlockSteps: [step()],
    });
    expect(result).not.toBeNull();
    expect(result?.verdict).toBe("Real demand signal, unproven pricing.");
    expect(result?.score).toBeUndefined();
  });

  it("still accepts a legacy payload gated on score alone", () => {
    // Old payloads always carried a 0-100 score; some carried nothing else.
    const result = normalizeViabilityData({ score: 42 });
    expect(result).not.toBeNull();
    expect(result?.score).toBe(42);
  });

  it("returns null for empty, null, and content-free payloads", () => {
    expect(normalizeViabilityData(null)).toBeNull();
    expect(normalizeViabilityData(undefined)).toBeNull();
    expect(normalizeViabilityData({})).toBeNull();
    expect(
      normalizeViabilityData({ verdict: "", factorsUp: [], factorsDown: [], unlockSteps: [] }),
    ).toBeNull();
  });

  it("normalizes unlock steps without upliftPoints and produces no NaN", () => {
    const result = normalizeViabilityData({
      verdict: "ok",
      unlockSteps: [step({ upliftPoints: undefined })],
    });
    expect(result?.unlockSteps).toHaveLength(1);
    expect(Number.isNaN(result?.potentialScore ?? 0)).toBe(false);
  });
});
