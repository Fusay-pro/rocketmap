"use client";

import { useState, useCallback } from "react";
import * as Popover from "@radix-ui/react-popover";
import type { AssumptionStatus, ViabilityData } from "@/lib/types/canvas";
import {
  hasInvalidatedCriticalAssumptions,
  getBadgeState,
} from "@/lib/utils/viability";
import {
  deriveQptpFromViability,
  type CategoryCount,
} from "@/lib/utils/evidence-counts";
import { severityColorFromCount, QUESTION_COLOR } from "@/lib/utils/qptp";
import { CountBadge } from "../ui/CountBadge";

interface ViabilityScoreProps {
  canvasId: string;
  allBlocksFilled: boolean;
  initialData: ViabilityData | null;
  isOutdated?: boolean;
  readOnly?: boolean;
  /** Outstanding assumptions per category — replaces the invented % breakdown. */
  categoryCounts?: CategoryCount[] | null;
  onExplainClick: () => void;
  onDataChange?: (data: ViabilityData) => void;
  onNavigateToAssumption?: (assumptionId: string) => void;
}

type ViabilityStatus =
  | "not_calculated"
  | "calculating"
  | "calculated"
  | "outdated"
  | "error";

const CATEGORY_LABELS: Record<string, string> = {
  market: "Market",
  product: "Product",
  ops: "Ops",
  legal: "Legal",
};

function getStatusIcon(status: AssumptionStatus): string {
  switch (status) {
    case "validated":
      return "\u2713";
    case "refuted":
    case "inconclusive":
      return "\u2717";
    case "testing":
      return "\u25D0";
    default:
      return "\u25CB";
  }
}

function getTimeAgo(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  const diffHours = Math.floor(diffMins / 60);
  return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
}

export function ViabilityScore({
  canvasId,
  allBlocksFilled,
  initialData,
  isOutdated = false,
  readOnly = false,
  categoryCounts = null,
  onExplainClick,
  onDataChange,
  onNavigateToAssumption,
}: ViabilityScoreProps) {
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status: ViabilityStatus = isCalculating
    ? "calculating"
    : error
      ? "error"
      : !initialData
        ? "not_calculated"
        : isOutdated
          ? "outdated"
          : "calculated";

  const handleCalculate = useCallback(async () => {
    setIsCalculating(true);
    setError(null);

    try {
      const res = await fetch(`/api/canvas/${canvasId}/viability`, {
        method: "POST",
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to calculate viability");
      }

      const { viability } = await res.json();
      onDataChange?.(viability);
    } catch (err) {
      console.error("Viability calculation error:", err);
      setError(err instanceof Error ? err.message : "Calculation failed");
    } finally {
      setIsCalculating(false);
    }
  }, [canvasId, onDataChange]);

  const handleRefresh = useCallback(() => {
    handleCalculate();
  }, [handleCalculate]);

  if (!allBlocksFilled || readOnly) return null;

  if (status === "not_calculated" || status === "error") {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleCalculate}
          className="ui-btn ui-btn-sm ui-btn-primary flex items-center gap-1.5"
        >
          Calculate Evidence
        </button>
        {error && (
          <span className="text-xs text-state-critical" title={error}>
            Error
          </span>
        )}
      </div>
    );
  }

  if (status === "calculating") {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="animate-spin inline-block w-3 h-3 border border-foreground-muted border-t-transparent rounded-full" />
          <span className="text-xs text-foreground-muted uppercase tracking-wider">
            Analyzing...
          </span>
        </div>
      </div>
    );
  }

  if (!initialData) return null;

  const timeAgo = getTimeAgo(initialData.calculatedAt);
  const unlockSteps = initialData.unlockSteps ?? [];
  const factorsUp = initialData.factorsUp ?? [];
  const factorsDown = initialData.factorsDown ?? [];
  const pendingSteps = unlockSteps.filter((s) => s.status === "untested" || s.status === "testing");

  const counts = deriveQptpFromViability(initialData);
  const badgeState = getBadgeState(initialData, counts?.problems ?? 0);
  const problemColor = severityColorFromCount(
    counts?.problems ?? 0,
    hasInvalidatedCriticalAssumptions(unlockSteps),
  );

  return (
    <Popover.Root>
      <div className="flex items-center gap-2">
        <Popover.Trigger asChild>
          <button
            className={`viability-potential-badge viability-potential-badge--${badgeState} ${
              status === "outdated" ? "opacity-80" : ""
            }`}
            aria-label={
              counts
                ? `${counts.questions} questions, ${counts.problems} potential problems`
                : "No evidence breakdown yet"
            }
          >
            {counts ? (
              <span className="flex items-baseline gap-2.5">
                <CountBadge value={counts.questions} unit="Q" color={QUESTION_COLOR} size="sm" />
                <CountBadge value={counts.problems} unit="PTP" color={problemColor} size="sm" />
              </span>
            ) : (
              <span className="text-[11px] text-foreground-muted">No breakdown yet</span>
            )}
          </button>
        </Popover.Trigger>

        <span className="text-[10px] font-mono uppercase tracking-wider text-foreground-muted">
          Evidence
        </span>

        {status === "outdated" && (
          <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-state-warning">
            <span className="w-1.5 h-1.5 rounded-full bg-state-warning animate-pulse" />
            Outdated
          </span>
        )}

        <button
          onClick={handleRefresh}
          className={`ui-btn ui-btn-xs ui-btn-ghost ${
            status === "outdated" ? "animate-pulse" : ""
          }`}
          title="Refresh evidence score"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
        </button>
      </div>

      <Popover.Portal>
        <Popover.Content
          className="glass-morphism border border-border rounded-xl p-0 w-[380px] z-50 overflow-hidden"
          style={{ boxShadow: "0 24px 48px rgba(var(--ink-shadow), 0.12)" }}
          sideOffset={8}
          align="end"
        >
          <div className="px-4 py-3 border-b border-border">
            <div className="text-xs font-semibold text-foreground">
              {counts ? (
                <>
                  {counts.questions} {counts.questions === 1 ? "Question" : "Questions"} ·{" "}
                  {counts.problems} Potential{" "}
                  {counts.problems === 1 ? "Problem" : "Problems"} found
                </>
              ) : (
                "Evidence"
              )}
            </div>
            <div className="text-[10px] text-foreground-muted/70 mt-0.5">
              {counts
                ? "Be ready to answer these before someone else asks"
                : "Recalculate to see what still needs evidence"}
            </div>
          </div>

          <div className="max-h-[440px] overflow-y-auto">
            {/* The two counted sections lead, in the header's own order and
                vocabulary. They used to sit at the very bottom of this scroll
                area, under the strengths and the unlock path — so a badge that
                said "1 Question · 4 Potential Problems" opened onto a wall of
                strengths and the counted items were never seen. Whatever the
                badge counts, the panel shows first. */}
            {initialData.whatAbout && (
              <div className="px-4 py-3 border-b border-border/60">
                <span className="text-[10px] uppercase tracking-wider text-[var(--chroma-cyan)]/70 font-semibold">
                  {counts && counts.questions === 1 ? "Question" : "Questions"} to prepare for
                </span>
                <p className="text-[11px] text-foreground/80 leading-relaxed mt-1.5">
                  {initialData.whatAbout}
                </p>
                <button
                  type="button"
                  onClick={onExplainClick}
                  className="text-[10px] text-[var(--chroma-indigo)] hover:underline flex items-center gap-1 mt-2"
                >
                  Discuss this
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            )}

            {factorsDown.length > 0 && (
              <div className="px-4 py-3 border-b border-border/60">
                <span className="text-[10px] uppercase tracking-wider text-state-critical/70 font-semibold">
                  Potential problems
                </span>
                <div className="space-y-1.5 mt-1.5">
                  {factorsDown.map((f, i) => (
                    <div key={`down-${i}`} className="flex items-start gap-2">
                      <span className="text-state-critical text-[11px] mt-px shrink-0">✗</span>
                      <span className="text-[11px] text-foreground/70 leading-relaxed">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {categoryCounts && (
              <div className="px-4 py-3 border-b border-border/60">
                <span className="text-[10px] uppercase tracking-wider text-foreground-muted/50 font-semibold">
                  Open assumptions
                </span>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                  {categoryCounts.map((c) => (
                    <span key={c.category} className="text-[11px] text-foreground/75">
                      <span className="font-mono font-semibold text-foreground">{c.count}</span>{" "}
                      {CATEGORY_LABELS[c.category] ?? c.category}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(initialData.verdict || initialData.reasoning) && (
              <div className="px-4 py-3 border-b border-border/60">
                <p className="text-[11px] text-foreground/75 leading-relaxed">
                  {initialData.verdict || initialData.reasoning}
                </p>
              </div>
            )}

            {factorsUp.length > 0 && (
              <div className="px-4 py-3 border-b border-border/60">
                <span className="text-[10px] uppercase tracking-wider text-foreground-muted/50 font-semibold">
                  Working in your favour
                </span>
                <div className="space-y-1.5 mt-1.5">
                  {factorsUp.map((f, i) => (
                    <div key={`up-${i}`} className="flex items-start gap-2">
                      <span className="text-primary text-[11px] mt-px shrink-0">✦</span>
                      <span className="text-[11px] text-foreground/70 leading-relaxed">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {initialData.ceiling && (
              <div className="px-4 py-2.5 border-b border-border/60">
                <span className="text-[10px] uppercase tracking-wider text-foreground-muted/50 font-semibold mr-2">
                  Ceiling
                </span>
                <span className="text-[11px] text-foreground/60 leading-relaxed">
                  {initialData.ceiling}
                </span>
              </div>
            )}

            <div className="px-4 py-3 border-b border-border/60">
              <div className="text-xs font-semibold text-foreground mb-2">
                Unlock path
                {pendingSteps.length > 0 && (
                  <span className="text-foreground-muted font-normal">
                    {" "}
                    ({pendingSteps.length} remaining)
                  </span>
                )}
              </div>
              {unlockSteps.length === 0 ? (
                <p className="text-xs text-foreground-muted">
                  Calculate evidence to see which assumption tests unlock potential.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {unlockSteps.map((step) => {
                    const isDone = step.status === "validated";
                    const isFailed =
                      step.status === "refuted" || step.status === "inconclusive";
                    return (
                      <button
                        key={step.assumptionId}
                        type="button"
                        onClick={() => onNavigateToAssumption?.(step.assumptionId)}
                        className="w-full text-left rounded-md border border-border bg-canvas-surface px-2.5 py-2 hover:bg-foreground/5 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={
                              isDone
                                ? "text-primary"
                                : isFailed
                                  ? "text-state-critical"
                                  : "text-foreground-muted"
                            }
                          >
                            {getStatusIcon(step.status)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-foreground line-clamp-2">
                                {step.assumption}
                              </span>
                              <span
                                className={`shrink-0 font-mono text-[10px] uppercase ${
                                  isDone
                                    ? "text-primary"
                                    : step.riskLevel === "high"
                                      ? "text-state-critical"
                                      : "text-state-ai"
                                }`}
                              >
                                {isDone ? "done" : step.riskLevel}
                              </span>
                            </div>
                            {step.suggestedTest && !isDone && (
                              <p className="text-[10px] text-foreground-muted mt-0.5 line-clamp-2">
                                {step.suggestedTest}
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

          <div className="px-4 py-2.5 border-t border-border flex items-center justify-between">
            <span className="text-[10px] text-foreground-muted/40">
              {timeAgo}
            </span>
            <button onClick={onExplainClick} className="ui-btn ui-btn-xs ui-btn-primary">
              Ask AI →
            </button>
          </div>

          <Popover.Arrow className="fill-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
