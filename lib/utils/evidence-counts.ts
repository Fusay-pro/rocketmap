import type { Assumption, ViabilityData } from "@/lib/types/canvas";

/**
 * Counts that back the Q · PTP badge, derived from stored viability data.
 *
 * Q   = open questions the founder should be ready to answer
 * PTP = potential problems (risks / structural weaknesses) found
 */
export interface QptpCounts {
  questions: number;
  problems: number;
}

/**
 * Q · PTP from a canvas's viability payload, or `null` when there is nothing
 * real to count.
 *
 * The null case is the common one, not an edge case: most canvases either have
 * no viability data at all, or carry a pre-factors payload from an older
 * version. Rendering `0Q · 0PTP` for those would be a fabrication — strictly
 * worse than the invented score this replaces — so callers must render nothing.
 *
 * Emptiness, not presence, is the test: `normalizeViabilityData` coerces missing
 * factor arrays to `[]` on the canvas page while the dashboard sees `undefined`.
 * Both must fall through to null.
 */
export function deriveQptpFromViability(
  viability: Partial<ViabilityData> | null | undefined,
): QptpCounts | null {
  if (!viability) return null;

  const factorsDown = Array.isArray(viability.factorsDown) ? viability.factorsDown : [];
  const factorsUp = Array.isArray(viability.factorsUp) ? viability.factorsUp : [];
  const whatAbout = typeof viability.whatAbout === "string" ? viability.whatAbout.trim() : "";
  const unlockSteps = Array.isArray(viability.unlockSteps) ? viability.unlockSteps : [];

  const hasAnything = factorsDown.length > 0 || factorsUp.length > 0 || whatAbout.length > 0;
  if (!hasAnything) return null;

  const openTests = unlockSteps.filter(
    (s) => s?.status === "untested" || s?.status === "testing",
  ).length;

  return {
    questions: (whatAbout ? 1 : 0) + openTests,
    problems: factorsDown.length,
  };
}

export interface CategoryCount {
  category: Assumption["category"];
  count: number;
}

/**
 * Untested/testing assumptions per category — the honest replacement for the
 * invented `Assumptions 45% · Market 30% · Need 25%` breakdown. Every number
 * here maps to rows you can open.
 *
 * Returns `null` when there is nothing outstanding, so the caller renders no
 * breakdown section at all. Validated and refuted assumptions are deliberately
 * excluded: this answers "what's still open", not "what have I done".
 */
export function deriveCategoryCounts(
  assumptions: Array<Pick<Assumption, "category" | "status">> | null | undefined,
): CategoryCount[] | null {
  if (!assumptions || assumptions.length === 0) return null;

  const counts = new Map<Assumption["category"], number>();
  for (const a of assumptions) {
    if (a?.status !== "untested" && a?.status !== "testing") continue;
    if (!a.category) continue;
    counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
