/**
 * Shared vocabulary for the Q · PTP badge — questions to prepare for, and
 * potential problems. Extracted from ConsistencyReport so the Evidence badge
 * and dashboard card speak the same language instead of forking it.
 */

export type Severity = "minor" | "major" | "critical";

/** Colour for a PTP count: worst severity present wins. */
export function severityColor(items: Array<{ severity: Severity }>): string {
  if (items.some((i) => i.severity === "critical")) return "var(--state-critical)";
  if (items.some((i) => i.severity === "major")) return "var(--state-warning)";
  return "var(--state-healthy)";
}

/**
 * Colour for a PTP count when the source has no per-item severity — the
 * viability payload's `factorsDown` is a flat string list. Volume stands in
 * for severity: a model with many open problems is in worse shape.
 */
export function severityColorFromCount(count: number, hasInvalidatedCritical = false): string {
  if (hasInvalidatedCritical) return "var(--state-critical)";
  if (count >= 3) return "var(--state-warning)";
  if (count === 0) return "var(--state-healthy)";
  return "var(--chroma-cyan)";
}

export const QUESTION_COLOR = "var(--chroma-cyan)";
