import type {
  Assumption,
  ViabilityData,
  ViabilityUnlockStep,
} from "@/lib/types/canvas";

/** Normalize legacy viability payloads missing potential/unlock fields. */
export function normalizeViabilityData(
  raw: Partial<ViabilityData> | null | undefined,
): ViabilityData | null {
  if (!raw) return null;

  const unlockSteps = raw.unlockSteps ?? [];

  // Gate on content, not on the legacy score. Old payloads always carried a
  // 0-100 score; new ones carry verdict/factors/unlockSteps and no score.
  // Mirrors deriveQptpFromViability's "emptiness, not presence" philosophy.
  const hasContent =
    typeof raw.score === "number" ||
    (typeof raw.verdict === "string" && raw.verdict.length > 0) ||
    (raw.factorsUp?.length ?? 0) > 0 ||
    (raw.factorsDown?.length ?? 0) > 0 ||
    unlockSteps.length > 0;
  if (!hasContent) return null;

  return {
    score: raw.score,
    potentialScore: raw.potentialScore,
    breakdown: raw.breakdown,
    reasoning: raw.reasoning ?? "",
    verdict: raw.verdict ?? raw.reasoning ?? "",
    factorsUp: raw.factorsUp ?? [],
    factorsDown: raw.factorsDown ?? [],
    ceiling: raw.ceiling ?? "",
    whatAbout: raw.whatAbout ?? "",
    unlockSteps,
    validatedAssumptions: raw.validatedAssumptions ?? [],
    calculatedAt: raw.calculatedAt ?? new Date().toISOString(),
  };
}

/** Overlay live assumption status onto stored unlock steps. */
export function mergeUnlockStepsWithAssumptions(
  steps: ViabilityUnlockStep[],
  assumptions: Assumption[],
): ViabilityUnlockStep[] {
  const byId = new Map(assumptions.map((a) => [a.$id, a]));

  return steps.map((step) => {
    const live = byId.get(step.assumptionId);
    if (!live) return step;
    return {
      ...step,
      assumption: live.statement,
      blockTypes: live.blockTypes,
      riskLevel: live.riskLevel,
      status: live.status,
    };
  });
}

export function hasInvalidatedCriticalAssumptions(
  steps: ViabilityUnlockStep[] | null | undefined,
): boolean {
  // Guarded: the onDataChange path writes a raw server payload straight into
  // state, bypassing normalizeViabilityData, so unlockSteps can be undefined.
  return (steps ?? []).some(
    (s) =>
      (s.status === "refuted" || s.status === "inconclusive") &&
      s.riskLevel === "high",
  );
}

export type BadgeState = "calm" | "healthy" | "warning";

/**
 * Colour state for the Evidence badge, keyed on the count of open problems
 * rather than a 0-100 score. A model with several unaddressed problems reads
 * as warning regardless of what any score would have said.
 */
export function getBadgeState(
  data: Pick<ViabilityData, "unlockSteps" | "factorsUp"> | null | undefined,
  problems: number,
): BadgeState {
  if (hasInvalidatedCriticalAssumptions(data?.unlockSteps)) return "warning";
  if (problems >= 3) return "warning";
  if (problems === 0 && (data?.factorsUp?.length ?? 0) > 0) return "healthy";
  return "calm";
}
