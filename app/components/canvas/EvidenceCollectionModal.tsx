"use client";

import { useCallback, useState, useEffect } from "react";
import type { Assumption, DecisionSignal, Experiment, ExperimentResult } from "@/lib/types/canvas";

interface EvidenceCollectionModalProps {
  assumption: Assumption;
  canvasId: string;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

const RESULT_OPTIONS: { value: ExperimentResult; label: string; color: string }[] = [
  { value: "supports", label: "Supports", color: "var(--state-healthy)" },
  { value: "contradicts", label: "Contradicts", color: "var(--state-critical)" },
  { value: "mixed", label: "Mixed", color: "var(--state-warning)" },
  { value: "inconclusive", label: "Inconclusive", color: "var(--state-ai)" },
];

const DECISION_OPTIONS: { value: DecisionSignal; label: string; color: string }[] = [
  { value: "double_down", label: "Double Down", color: "var(--state-healthy)" },
  { value: "pivot", label: "Pivot", color: "var(--state-warning)" },
  { value: "kill", label: "Kill", color: "var(--state-critical)" },
  { value: "insufficient_evidence", label: "More Evidence", color: "var(--state-ai)" },
];

function defaultDecisionForResult(result: ExperimentResult): DecisionSignal {
  // A supporting result defaults to "More Evidence", not "Double Down". One
  // experiment that agrees with an assumption is not a mandate to commit — the
  // stronger call should be something the user chooses, not something the
  // form pre-selects for them. Kept in sync with defaultDecisionSignal in
  // api/canvas/[canvasId]/assumptions/[assumptionId]/experiments/[id]/route.ts.
  if (result === "supports") return "insufficient_evidence";
  if (result === "contradicts") return "pivot";
  return "insufficient_evidence";
}

export function EvidenceCollectionModal({
  assumption,
  canvasId,
  isOpen,
  onClose,
  onUpdated,
}: EvidenceCollectionModalProps) {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null);
  const [evidence, setEvidence] = useState("");
  const [result, setResult] = useState<ExperimentResult>("supports");
  const [decisionSignal, setDecisionSignal] = useState<DecisionSignal>("double_down");
  const [sourceUrl, setSourceUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const applyExperimentState = useCallback((experiment: Experiment) => {
    const nextResult = experiment.result ?? "supports";
    setSelectedExperiment(experiment);
    setEvidence(experiment.evidence ?? "");
    setResult(nextResult);
    setSourceUrl(experiment.sourceUrl ?? "");
    setDecisionSignal(
      assumption.decisionSignal ?? defaultDecisionForResult(nextResult),
    );
  }, [assumption.decisionSignal]);

  useEffect(() => {
    if (!isOpen) return;
    const id = setTimeout(() => setLoading(true), 0);
    fetch(
      `/api/canvas/${canvasId}/assumptions/${assumption.$id}/experiments`,
    )
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        const exps = Array.isArray(data) ? data : [];
        setExperiments(exps);
        if (exps.length > 0) applyExperimentState(exps[0]);
      })
      .catch(() => setExperiments([]))
      .finally(() => setLoading(false));
    return () => clearTimeout(id);
  }, [isOpen, canvasId, assumption.$id, applyExperimentState]);

  if (!isOpen) return null;

  const handleComplete = async () => {
    if (!selectedExperiment || !evidence.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/canvas/${canvasId}/assumptions/${assumption.$id}/experiments/${selectedExperiment.$id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "completed",
            result,
            decisionSignal,
            evidence: evidence.trim(),
            sourceUrl: sourceUrl.trim() || undefined,
          }),
        },
      );
      if (res.ok) {
        onUpdated();
        onClose();
      }
    } catch {
      // silently fail
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg mx-4 rounded-[14px] border border-border bg-canvas-surface p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display-small text-base text-foreground">Collect Evidence</h3>
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground text-sm"
          >
            &times;
          </button>
        </div>

        {/* Assumption context */}
        <div className="rounded-[12px] border border-border bg-canvas-surface p-3">
          <p className="text-[11px] font-mono uppercase tracking-wider text-foreground-subtle mb-1">Assumption:</p>
          <p className="text-sm leading-relaxed text-foreground">{assumption.statement}</p>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-foreground-muted">
            Loading experiments...
          </div>
        ) : experiments.length === 0 ? (
          <div className="py-8 text-center text-sm text-foreground-muted">
            No experiments found. Design a test first.
          </div>
        ) : (
          <>
            {/* Experiment selector (if multiple) */}
            {experiments.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono uppercase tracking-wider text-foreground-muted">Experiment</label>
                <select
                  value={selectedExperiment?.$id ?? ""}
                  onChange={(e) => {
                    const exp = experiments.find((x) => x.$id === e.target.value);
                    if (exp) applyExperimentState(exp);
                  }}
                  className="w-full rounded-[12px] border border-border bg-canvas-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/55 focus:shadow-[0_0_0_3px_rgba(var(--primary-rgb),0.16)]"
                >
                  {experiments.map((exp) => (
                    <option key={exp.$id} value={exp.$id}>
                      {exp.type}: {exp.description.slice(0, 60)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Selected experiment details */}
            {selectedExperiment && (
              <div className="rounded-[12px] border border-border bg-canvas-surface p-3 space-y-1">
                <p className="text-[11px] font-mono uppercase tracking-wider text-foreground-subtle">
                  {selectedExperiment.type.toUpperCase()}
                </p>
                <p className="text-sm text-foreground">{selectedExperiment.description}</p>
                <p className="text-[11px] font-mono uppercase tracking-wider text-foreground-muted">
                  Success criteria: {selectedExperiment.successCriteria}
                </p>
                {selectedExperiment.successThreshold && (
                  <p className="text-[11px] font-mono uppercase tracking-wider text-foreground-muted">
                    Threshold: {selectedExperiment.successThreshold}
                  </p>
                )}
              </div>
            )}

            {/* Evidence textarea */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-foreground-muted">Evidence</label>
              <textarea
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="What did you find? Describe the evidence..."
                rows={3}
                className="w-full rounded-[12px] border border-border bg-canvas-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-primary/55 focus:shadow-[0_0_0_3px_rgba(var(--primary-rgb),0.16)]"
              />
            </div>

            {/* Result radio */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-foreground-muted">Result</label>
              <div className="flex flex-wrap gap-2">
                {RESULT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setResult(opt.value);
                      setDecisionSignal(defaultDecisionForResult(opt.value));
                    }}
                    className={`px-3 py-1.5 rounded-[12px] text-xs font-medium transition-colors ${
                      result === opt.value
                        ? "border-2"
                        : "border border-border text-foreground-muted hover:text-foreground"
                    }`}
                    style={
                      result === opt.value
                        ? {
                            borderColor: opt.color,
                            color: opt.color,
                            background: `color-mix(in srgb, ${opt.color} 8%, transparent)`,
                          }
                        : undefined
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-foreground-muted">Decision Signal</label>
              <div className="flex flex-wrap gap-2">
                {DECISION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDecisionSignal(opt.value)}
                    className={`px-3 py-1.5 rounded-[12px] text-xs font-medium transition-colors ${
                      decisionSignal === opt.value
                        ? "border-2"
                        : "border border-border text-foreground-muted hover:text-foreground"
                    }`}
                    style={
                      decisionSignal === opt.value
                        ? {
                            borderColor: opt.color,
                            color: opt.color,
                            background: `color-mix(in srgb, ${opt.color} 8%, transparent)`,
                          }
                        : undefined
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Source URL */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-foreground-muted">Source URL (optional)</label>
              <input
                type="text"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-[12px] border border-border bg-canvas-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-primary/55 focus:shadow-[0_0_0_3px_rgba(var(--primary-rgb),0.16)]"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="ui-btn ui-btn-sm ui-btn-ghost text-foreground-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleComplete}
                disabled={!evidence.trim() || !selectedExperiment || submitting}
                className="ui-btn ui-btn-sm ui-btn-secondary"
              >
                {submitting ? "Saving..." : "Mark Complete"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
