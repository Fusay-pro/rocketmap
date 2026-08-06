import { describe, expect, it } from "vitest";
import {
  getBadgeState,
  hasInvalidatedCriticalAssumptions,
  computeWeightedScore,
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

describe("computeWeightedScore", () => {
  it("applies the 0.4 / 0.3 / 0.3 weighting", () => {
    expect(computeWeightedScore({ assumptions: 100, market: 100, unmetNeed: 100 })).toBe(100);
    expect(computeWeightedScore({ assumptions: 50, market: 0, unmetNeed: 0 })).toBe(20);
  });
});
