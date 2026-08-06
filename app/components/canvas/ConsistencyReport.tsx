"use client";

import * as HoverCard from "@radix-ui/react-hover-card";
import { CountBadge } from "../ui/CountBadge";
import { severityColor, QUESTION_COLOR } from "@/lib/utils/qptp";

interface Contradiction {
  blocks: string[];
  issue: string;
  severity: "minor" | "major" | "critical";
  suggestion: string;
  question?: string;
}

interface MissingLink {
  from: string;
  to: string;
  issue: string;
  question?: string;
}

interface ChainFinding {
  fromZone: string;
  toZone: string;
  issue: string;
  severity: "minor" | "major" | "critical";
  evidenceNeeded: string;
  suggestion: string;
  question?: string;
}

export interface ConsistencyData {
  contradictions: Contradiction[];
  missingLinks: MissingLink[];
  chainFindings?: ChainFinding[];
  hostQuestions?: string[];
}

interface ConsistencyReportProps {
  data: ConsistencyData | null;
  isLoading: boolean;
}

const SEVERITY_COLORS: Record<string, string> = {
  minor: "var(--chroma-cyan)",
  major: "var(--chroma-amber)",
  critical: "var(--state-critical)",
};

interface ProblemItem {
  label: string;
  issue: string;
  severity: "minor" | "major" | "critical";
  suggestion?: string;
  question?: string;
}

export function ConsistencyReport({ data, isLoading }: ConsistencyReportProps) {
  if (isLoading) {
    return (
      <div className="p-4 text-xs text-foreground-muted text-center glow-ai rounded-[14px]">
        Running consistency check across all blocks...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 text-xs text-foreground-muted text-center">
        Run a consistency check to find cross-block issues
      </div>
    );
  }

  const questions = data.hostQuestions ?? [];
  const problems: ProblemItem[] = [
    ...data.contradictions.map((c) => ({
      label: c.blocks.join(" / "),
      issue: c.issue,
      severity: c.severity,
      suggestion: c.suggestion,
      question: c.question,
    })),
    ...(data.chainFindings ?? []).map((f) => ({
      label: `${f.fromZone} → ${f.toZone}`,
      issue: f.issue,
      severity: f.severity,
      suggestion: f.suggestion,
      question: f.question,
    })),
    ...data.missingLinks.map((ml) => ({
      label: `${ml.from} → ${ml.to}`,
      issue: ml.issue,
      severity: "minor" as const,
      question: ml.question,
    })),
  ];

  if (questions.length === 0 && problems.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--state-healthy)" }}>
        No problems found — your model holds together
      </p>
    );
  }

  const problemColor = severityColor(problems);

  return (
    <HoverCard.Root openDelay={100} closeDelay={200}>
      <HoverCard.Trigger asChild>
        <button
          type="button"
          className="self-start flex items-baseline gap-3 cursor-default rounded-[10px] px-2 py-1 -mx-2 hover:bg-foreground/5 transition-colors"
          aria-label={`${questions.length} questions, ${problems.length} potential problems — hover for details`}
        >
          <CountBadge value={questions.length} unit="Q" color={QUESTION_COLOR} size="lg" />
          <CountBadge value={problems.length} unit="PTP" color={problemColor} size="lg" />
        </button>
      </HoverCard.Trigger>

      <HoverCard.Portal>
        <HoverCard.Content
          className="glass-morphism border border-border rounded-xl p-0 w-[380px] z-50 overflow-hidden"
          style={{ boxShadow: "0 24px 48px rgba(var(--ink-shadow), 0.12)" }}
          sideOffset={8}
          align="start"
        >
          <div className="px-4 py-3 border-b border-border">
            <div className="text-xs font-semibold text-foreground">
              {questions.length}{" "}
              {questions.length === 1 ? "Question" : "Questions"} ·{" "}
              {problems.length} Potential{" "}
              {problems.length === 1 ? "Problem" : "Problems"} found
            </div>
            <div className="text-[10px] text-foreground-muted/70 mt-0.5">
              Be ready to answer these before someone else asks
            </div>
          </div>

          <div className="max-h-[440px] overflow-y-auto">
            {questions.length > 0 && (
              <div className="px-4 py-3 border-b border-border/60 flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-foreground-muted/50 font-semibold">
                  Questions to prepare for
                </span>
                {questions.map((q, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span
                      className="text-[9px] font-mono uppercase tracking-wider mt-0.5 shrink-0"
                      style={{ color: "var(--chroma-cyan)" }}
                    >
                      Q{i + 1}
                    </span>
                    <p className="text-[11px] text-foreground/80 leading-relaxed">
                      {q}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {problems.length > 0 && (
              <div className="px-4 py-3 flex flex-col gap-2">
                <span className="text-[10px] uppercase tracking-wider text-foreground-muted/50 font-semibold">
                  Potential problems
                </span>
                {problems.map((p, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-border bg-canvas-surface px-2.5 py-2 border-t-2 flex flex-col gap-1"
                    style={{ borderTopColor: SEVERITY_COLORS[p.severity] }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: SEVERITY_COLORS[p.severity] }}
                      />
                      <span
                        className="text-[9px] font-mono uppercase tracking-wider"
                        style={{ color: SEVERITY_COLORS[p.severity] }}
                      >
                        {p.severity}
                      </span>
                      <span className="text-[10px] text-foreground-muted truncate">
                        {p.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-foreground/80 leading-relaxed">
                      {p.issue}
                    </p>
                    {p.question && (
                      <p
                        className="text-[11px] leading-relaxed"
                        style={{ color: "var(--chroma-cyan)" }}
                      >
                        They will ask: {p.question}
                      </p>
                    )}
                    {p.suggestion && (
                      <p className="text-[10px] text-foreground-muted leading-relaxed">
                        {p.suggestion}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <HoverCard.Arrow className="fill-border" />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
