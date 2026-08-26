"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import type {
  BlockData,
  BlockItem,
  BlockType,
  BlockContent,
  BlockEditProposal,
  BlockItemProposal,
  SegmentProposal,
  CanvasMode,
  CanvasTab,
  CanvasData,
  MarketResearchData,
  UnitEconomicsData,
  RiskMetrics,
  Segment,
  ViabilityData,
  Assumption,
} from "@/lib/types/canvas";
import { getSegmentColor } from "@/lib/types/canvas";
import { mergeUnlockStepsWithAssumptions } from "@/lib/utils/viability";
import { deriveCategoryCounts, deriveQptpFromViability, type CategoryCount } from "@/lib/utils/evidence-counts";
import type { HoveredItem } from "@/app/components/canvas/ConnectionOverlay";
import type { ConsistencyData } from "@/app/components/canvas/ConsistencyReport";
import {
  isSharedBlock,
  BLOCK_DEFINITIONS,
} from "@/app/components/canvas/constants";
import { BMCGrid } from "@/app/components/canvas/BMCGrid";
import { CanvasToolbar } from "@/app/components/canvas/CanvasToolbar";
import { CanvasTabs } from "@/app/components/canvas/CanvasTabs";
import { NotesView } from "@/app/components/canvas/NotesView";
import { CanvasSettingsModal } from "@/app/components/canvas/CanvasSettingsModal";
import { BlockFocusPanel } from "@/app/components/canvas/BlockFocusPanel";
import { MobileCanvasCarousel } from "@/app/components/canvas/MobileCanvasCarousel";
import { MobileFocusSheet } from "@/app/components/canvas/MobileFocusSheet";
import { AnalysisView } from "@/app/components/canvas/AnalysisView";
import { AssumptionsView } from "@/app/components/canvas/AssumptionsView";
import { MarketView } from "@/app/components/canvas/MarketView";
import { JTBDView } from "@/app/components/canvas/JTBDView";
import { DebugPanel } from "@/app/components/canvas/DebugPanel";
import { ChatBar } from "@/app/components/ai/ChatBar";
import { BlockChatSection } from "@/app/components/ai/BlockChatSection";
import { DeepDiveOverlay } from "@/app/components/blocks/DeepDiveOverlay";
import { EconomicsView } from "@/app/components/blocks/unit-economics/EconomicsView";
import { InlineSegmentEval } from "@/app/components/blocks/segment-eval/InlineSegmentEval";
import { ExpandedCanvasOverview } from "@/app/components/canvas/ExpandedCanvasOverview";

interface CanvasClientProps {
  canvasId: string;
  initialCanvasData: CanvasData;
  initialBlocks: BlockData[];
  initialSegments?: Segment[];
  readOnly: boolean;
  initialViabilityData?: ViabilityData | null;
}

type SaveStatus = "saved" | "saving" | "unsaved";
const MIN_TEXT_ZOOM = 0.85;
const MAX_TEXT_ZOOM = 1.6;

function clampTextZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_TEXT_ZOOM, Math.max(MIN_TEXT_ZOOM, value));
}

function deriveBlockState(block: BlockData): BlockData["state"] {
  if (!block.aiAnalysis) return "calm";
  if (block.confidenceScore >= 0.7 && block.riskScore < 0.3) return "healthy";
  if (block.riskScore >= 0.6) return "critical";
  if (block.riskScore >= 0.3 || block.confidenceScore < 0.5) return "warning";
  return "healthy";
}

export function CanvasClient({
  canvasId,
  initialCanvasData,
  initialBlocks,
  initialSegments = [],
  readOnly,
  initialViabilityData,
}: CanvasClientProps) {
  const router = useRouter();
  const [mode, setMode] = useState<CanvasMode>("bmc");
  const [blocks, setBlocks] = useState<Map<BlockType, BlockData>>(() => {
    const map = new Map<BlockType, BlockData>();
    for (const block of initialBlocks) {
      map.set(block.blockType, block);
    }
    return map;
  });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [focusedBlock, setFocusedBlock] = useState<BlockType | null>(null);
  const [expandedBlock, setExpandedBlock] = useState<BlockType | null>(null);
  const [chatTargetBlock, setChatTargetBlock] = useState<BlockType | null>(
    null,
  );
  // Start minimized: opening a canvas should show the canvas, not the copilot.
  // The minimized state still renders the restore bubble, so chat is one click away.
  const [chatMinimized, setChatMinimized] = useState(true);
  const [pendingChatMessage, setPendingChatMessage] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileSheetBlock, setMobileSheetBlock] = useState<BlockType | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<CanvasTab>("canvas");
  const [canvasData, setCanvasData] = useState<CanvasData>(initialCanvasData);
  const [showSettings, setShowSettings] = useState(false);
  const [textZoom, setTextZoom] = useState(1);
  const [isZoomStorageReady, setIsZoomStorageReady] = useState(false);
  const [analyzingBlock, setAnalyzingBlock] = useState<BlockType | null>(null);
  const [deepDiveBlock, setDeepDiveBlock] = useState<BlockType | null>(null);
  const [consistencyData, setConsistencyData] =
    useState<ConsistencyData | null>(null);
  const [isCheckingConsistency, setIsCheckingConsistency] = useState(false);
  const [notes, setNotes] = useState(initialCanvasData.description);
  const [segments, setSegments] = useState<Map<string, Segment>>(() => {
    const map = new Map<string, Segment>();
    for (const seg of initialSegments) {
      map.set(seg.$id, seg);
    }
    return map;
  });
  const [hoveredItem, setHoveredItem] = useState<HoveredItem | null>(null);
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(null);
  const [viabilityData, setViabilityData] = useState<ViabilityData | null>(
    initialViabilityData ?? null,
  );
  const [viabilityOutdated, setViabilityOutdated] = useState(false);
  const [categoryCounts, setCategoryCounts] = useState<CategoryCount[] | null>(null);
  const viabilityBlocksFingerprintRef = useRef<string | null>(null);
  const viabilityAssumptionsFingerprintRef = useRef<string | null>(null);
  const viabilityAssumptionsRecalcTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [selectedAssumptionId, setSelectedAssumptionId] = useState<string | null>(
    null,
  );
  const [riskHeatmap, setRiskHeatmap] = useState<Record<
    BlockType,
    RiskMetrics
  > | null>(null);
  const [economicsData, setEconomicsData] = useState<UnitEconomicsData | null>(() => {
    const revenueBlock = initialBlocks.find((b) => b.blockType === "revenue_streams");
    const dd = revenueBlock?.deepDiveData as { unitEconomics?: UnitEconomicsData } | undefined;
    return dd?.unitEconomics ?? null;
  });
  const [economicsGenerating, setEconomicsGenerating] = useState(false);
  const [economicsProgress, setEconomicsProgress] = useState<string | null>(null);
  const [focusPanelWidth, setFocusPanelWidth] = useState(420);

  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // ─── Segment Focus View (client-side lens over the single canvas) ──────────
  const segmentList = useMemo(() => Array.from(segments.values()), [segments]);

  // How many block items across all blocks link to each segment.
  const segmentItemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const block of blocks.values()) {
      for (const item of block.content.items ?? []) {
        for (const segId of item.linkedSegmentIds ?? []) {
          counts.set(segId, (counts.get(segId) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [blocks]);

  // Display color of the currently-focused segment (undefined when not focusing).
  const focusSegmentColor = useMemo(() => {
    if (!focusSegmentId) return undefined;
    const idx = segmentList.findIndex((s) => s.$id === focusSegmentId);
    return idx === -1 ? undefined : getSegmentColor(segmentList[idx], idx);
  }, [focusSegmentId, segmentList]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    fetch(`/api/canvas/${canvasId}/risk-heatmap`)
      .then((res) => res.json())
      .then((data) => setRiskHeatmap(data))
      .catch((err) => console.error("Risk heatmap fetch error:", err));
  }, [canvasId]);

  useEffect(() => {
    if (expandedBlock) {
      // Use a microtask to avoid synchronous setState in effect body
      const id = setTimeout(() => setChatMinimized(true), 0);
      return () => clearTimeout(id);
    }
  }, [expandedBlock]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`canvas:textZoom:${canvasId}`);
      if (stored) {
        const parsed = Number.parseFloat(stored);
        const id = setTimeout(() => setTextZoom(clampTextZoom(parsed)), 0);
        return () => clearTimeout(id);
      }
    } catch {
      // ignore storage errors
    } finally {
      setIsZoomStorageReady(true);
    }
  }, [canvasId]);

  useEffect(() => {
    if (!isZoomStorageReady) return;
    try {
      window.localStorage.setItem(
        `canvas:textZoom:${canvasId}`,
        String(textZoom),
      );
    } catch {
      // ignore storage errors
    }
  }, [canvasId, isZoomStorageReady, textZoom]);

  const blocksFingerprint = useMemo(
    () =>
      [...blocks.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(
          ([type, block]) =>
            `${type}:${block.content.bmc}|${block.content.lean}`,
        )
        .join(";"),
    [blocks],
  );

  // Viability recalculation on block changes (debounced, skip initial load)
  useEffect(() => {
    if (!viabilityData || readOnly) return;

    if (viabilityBlocksFingerprintRef.current === null) {
      viabilityBlocksFingerprintRef.current = blocksFingerprint;
      return;
    }

    if (viabilityBlocksFingerprintRef.current === blocksFingerprint) return;

    viabilityBlocksFingerprintRef.current = blocksFingerprint;
    setViabilityOutdated(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/canvas/${canvasId}/viability`, {
          method: "POST",
        });
        if (res.ok) {
          const { viability } = await res.json();
          setViabilityData(viability);
          setViabilityOutdated(false);
        }
      } catch (err) {
        console.error("Auto-recalc failed:", err);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [blocksFingerprint, viabilityData, canvasId, readOnly]);

  const refreshLiveViabilityScore = useCallback(
    async (markOutdated = true) => {
      if (readOnly) return;

      try {
        const res = await fetch(`/api/canvas/${canvasId}/assumptions`);
        if (!res.ok) return;
        const assumptions: Assumption[] = await res.json();

        // Reuse this fetch for the Evidence popover's category breakdown.
        // Set before the fingerprint short-circuit so it populates on first load.
        setCategoryCounts(deriveCategoryCounts(assumptions));

        const fingerprint = assumptions
          .map((a) => `${a.$id}:${a.status}`)
          .sort()
          .join(";");

        if (viabilityAssumptionsFingerprintRef.current === fingerprint) return;
        viabilityAssumptionsFingerprintRef.current = fingerprint;

        setViabilityData((prev) => {
          if (!prev) return prev;
          // Overlay live assumption statuses onto stored unlock steps. Badge
          // state, Q/PTP counts, and step rendering all read unlockSteps —
          // no score recompute needed (nothing renders one since 74fd136).
          return {
            ...prev,
            unlockSteps: mergeUnlockStepsWithAssumptions(
              prev.unlockSteps,
              assumptions,
            ),
          };
        });
        if (markOutdated) setViabilityOutdated(true);
      } catch (err) {
        console.error("Live viability refresh failed:", err);
      }
    },
    [canvasId, readOnly],
  );

  const handleAssumptionsChanged = useCallback(() => {
    void refreshLiveViabilityScore(true);

    if (viabilityAssumptionsRecalcTimerRef.current) {
      clearTimeout(viabilityAssumptionsRecalcTimerRef.current);
    }
    viabilityAssumptionsRecalcTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/canvas/${canvasId}/viability`, {
          method: "POST",
        });
        if (res.ok) {
          const { viability } = await res.json();
          setViabilityData(viability);
          setViabilityOutdated(false);
          viabilityAssumptionsFingerprintRef.current = null;
        }
      } catch (err) {
        console.error("Assumption-triggered viability recalc failed:", err);
      }
    }, 5000);
  }, [refreshLiveViabilityScore, canvasId]);

  useEffect(() => {
    if (!viabilityData || readOnly) return;

    if (viabilityAssumptionsFingerprintRef.current !== null) return;

    const timer = setTimeout(() => {
      void refreshLiveViabilityScore(false);
    }, 0);

    return () => clearTimeout(timer);
  }, [viabilityData, readOnly, refreshLiveViabilityScore]);

  const handleNavigateToAssumption = useCallback((assumptionId: string) => {
    setSelectedAssumptionId(assumptionId);
    setActiveTab("assumptions");
  }, []);

  // Save block content
  const saveBlock = useCallback(
    async (
      blockType: BlockType,
      content: { bmc: string; lean: string; items?: BlockItem[] },
    ) => {
      if (readOnly) return;
      setSaveStatus("saving");
      try {
        const res = await fetch(`/api/canvas/${canvasId}/blocks`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blockType,
            contentJson: JSON.stringify(content),
          }),
        });
        setSaveStatus(res.ok ? "saved" : "unsaved");
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [canvasId, readOnly],
  );

  // Save canvas metadata
  const saveCanvas = useCallback(
    async (
      updates: Partial<Pick<CanvasData, "title" | "description" | "isPublic">>,
    ) => {
      if (readOnly) return;
      try {
        const res = await fetch(`/api/canvas/${canvasId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });

        if (res.ok) {
          const data = await res.json();

          // Update local state
          setCanvasData((prev) => ({ ...prev, ...updates }));

          // If slug changed, redirect to new URL
          if (data.canvas && data.canvas.slug !== canvasData.slug) {
            router.push(`/canvas/${data.canvas.slug}`);
          }
        }
      } catch {
        // silently fail
      }
    },
    [canvasId, canvasData.slug, router, readOnly],
  );

  const handleBlockChange = useCallback(
    (blockType: BlockType, value: string) => {
      if (readOnly) return;
      let updatedContent: BlockContent = {
        bmc: "",
        lean: "",
        items: [],
      };

      setBlocks((prev) => {
        const next = new Map(prev);
        const existing = next.get(blockType);
        const content = existing?.content ?? { bmc: "", lean: "", items: [] };
        // Shared blocks (channels, customer_segments, cost_structure, revenue_streams)
        // always write to both bmc and lean so content stays in sync across modes
        if (isSharedBlock(blockType)) {
          updatedContent = {
            bmc: value,
            lean: value,
            items: content.items,
          };
        } else {
          updatedContent =
            mode === "lean"
              ? { bmc: content.bmc, lean: value, items: content.items }
              : { bmc: value, lean: content.lean, items: content.items };
        }
        next.set(blockType, {
          ...existing!,
          blockType,
          content: updatedContent,
          state: existing?.state ?? "calm",
          aiAnalysis: existing?.aiAnalysis ?? null,
          confidenceScore: existing?.confidenceScore ?? 0,
          riskScore: existing?.riskScore ?? 0,
        });
        return next;
      });

      setSaveStatus("unsaved");

      const existing = saveTimers.current.get(blockType);
      if (existing) clearTimeout(existing);
      saveTimers.current.set(
        blockType,
        setTimeout(() => {
          saveBlock(blockType, updatedContent);
          saveTimers.current.delete(blockType);
        }, 800),
      );
    },
    [mode, saveBlock, readOnly],
  );

  const handleAnalyze = useCallback(
    async (blockType: BlockType) => {
      if (readOnly) return;
      setAnalyzingBlock(blockType);
      setBlocks((prev) => {
        const next = new Map(prev);
        const b = next.get(blockType);
        if (b) next.set(blockType, { ...b, state: "ai" });
        return next;
      });

      try {
        console.log(`[analyze] POST /api/canvas/${canvasId}/blocks/${blockType}/analyze`);
        const res = await fetch(
          `/api/canvas/${canvasId}/blocks/${blockType}/analyze`,
          { method: "POST" },
        );

        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.includes('"analyzeBlock"')) continue;
            try {
              const json = line.startsWith("data: ") ? line.slice(6) : line;
              const event = JSON.parse(json);
              const items: unknown[] = Array.isArray(event) ? event : [event];
              for (const item of items) {
                const e = item as Record<string, unknown>;
                if (e?.toolName === "analyzeBlock" && e?.result) {
                  const r = e.result as {
                    draft: string;
                    assumptions: string[];
                    risks: string[];
                    questions: string[];
                    confidenceScore?: number;
                    riskScore?: number;
                  };
                  setBlocks((prev) => {
                    const next = new Map(prev);
                    const b = next.get(blockType);
                    if (b) {
                      const updated: BlockData = {
                        ...b,
                        aiAnalysis: {
                          draft: r.draft,
                          assumptions: r.assumptions,
                          risks: r.risks,
                          questions: r.questions,
                          generatedAt: new Date().toISOString(),
                        },
                        confidenceScore: typeof r.confidenceScore === "number"
                          ? r.confidenceScore / 100
                          : b.confidenceScore,
                        riskScore: typeof r.riskScore === "number"
                          ? r.riskScore / 100
                          : b.riskScore,
                      };
                      updated.state = deriveBlockState(updated);
                      next.set(blockType, updated);
                    }
                    return next;
                  });
                }
              }
            } catch {
              // partial or non-JSON line
            }
          }
        }
      } catch {
        setBlocks((prev) => {
          const next = new Map(prev);
          const b = next.get(blockType);
          if (b) next.set(blockType, { ...b, state: deriveBlockState(b) });
          return next;
        });
      } finally {
        setAnalyzingBlock(null);
      }
    },
    [canvasId, readOnly],
  );

  const handleConsistencyCheck = useCallback(async () => {
    if (readOnly) return;
    setIsCheckingConsistency(true);
    const consistencyToolCallIds = new Set<string>();
    const looksLikeConsistencyData = (value: unknown): value is ConsistencyData => {
      if (!value || typeof value !== "object") return false;
      const record = value as Record<string, unknown>;
      return (
        Array.isArray(record.contradictions) &&
        Array.isArray(record.missingLinks)
      );
    };
    const extractConsistencyResult = (value: unknown): ConsistencyData | null => {
      if (!value || typeof value !== "object") return null;
      const record = value as Record<string, unknown>;
      if (
        record.toolName === "checkConsistency" &&
        typeof record.toolCallId === "string"
      ) {
        consistencyToolCallIds.add(record.toolCallId);
      }
      if (record.toolName === "checkConsistency" && record.result) {
        return record.result as ConsistencyData;
      }
      if (record.type === "tool-input-available" && record.toolName === "checkConsistency" && typeof record.toolCallId === "string") {
        consistencyToolCallIds.add(record.toolCallId);
      }
      if (
        record.type === "tool-output-available" &&
        typeof record.toolCallId === "string" &&
        consistencyToolCallIds.has(record.toolCallId) &&
        record.output
      ) {
        return record.output as ConsistencyData;
      }
      if (
        (record.type === "tool-checkConsistency" ||
          record.type === "dynamic-tool" ||
          record.toolName === "checkConsistency") &&
        record.output
      ) {
        return record.output as ConsistencyData;
      }
      if (looksLikeConsistencyData(record)) {
        return record;
      }
      if (looksLikeConsistencyData(record.output)) {
        return record.output;
      }
      if (looksLikeConsistencyData(record.result)) {
        return record.result;
      }
      if (Array.isArray(record.parts)) {
        for (const part of record.parts) {
          const result = extractConsistencyResult(part);
          if (result) return result;
        }
      }
      return null;
    };

    try {
      let foundConsistencyResult = false;
      const res = await fetch(`/api/canvas/${canvasId}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              id: `consistency-${Date.now()}`,
              role: "user",
              parts: [
                {
                  type: "text",
                  text:
                    "Run a full consistency check across all blocks. Use the checkConsistency tool to provide your structured analysis of contradictions, missing links, chain findings, and the tough questions the founder should be ready to answer.",
                },
              ],
            },
          ],
          persistAssistant: false,
        }),
      });

      if (!res.ok || !res.body) {
        const rawMessage = await res.text().catch(() => "");
        let message = rawMessage;
        try {
          const parsed = JSON.parse(rawMessage) as { error?: unknown };
          if (typeof parsed.error === "string") message = parsed.error;
        } catch {
          // keep raw text
        }
        throw new Error(message || "Consistency check failed");
      }

      // Parse streaming response for checkConsistency tool result
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim() || line === "data: [DONE]") continue;
          try {
            const json = line.startsWith("data: ") ? line.slice(6) : line;
            const event = JSON.parse(json);
            const items: unknown[] = Array.isArray(event) ? event : [event];
            for (const item of items) {
              const result = extractConsistencyResult(item);
              if (result) {
                foundConsistencyResult = true;
                setConsistencyData(result);
              }
            }
          } catch {
            // partial or non-JSON line
          }
        }
      }
      if (!foundConsistencyResult) {
        throw new Error("AI response did not include a consistency report");
      }
    } catch (error) {
      console.error("Consistency check failed:", error);
      setConsistencyData({
        contradictions: [
          {
            blocks: ["Consistency Checker"],
            issue:
              error instanceof Error
                ? error.message
                : "The consistency check failed before returning a report.",
            severity: "critical",
            suggestion:
              "Try again. If this repeats, check the browser console and server logs for the API error.",
          },
        ],
        missingLinks: [],
        chainFindings: [],
        hostQuestions: [],
      });
    } finally {
      setIsCheckingConsistency(false);
    }
  }, [canvasId, readOnly]);

  const handleNotesChange = useCallback(
    (value: string) => {
      if (readOnly) return;
      setNotes(value);
      const existing = saveTimers.current.get("__notes");
      if (existing) clearTimeout(existing);
      saveTimers.current.set(
        "__notes",
        setTimeout(() => {
          saveCanvas({ description: value });
          saveTimers.current.delete("__notes");
        }, 1000),
      );
    },
    [saveCanvas, readOnly],
  );

  const handleDelete = useCallback(async () => {
    if (readOnly) return;
    try {
      await fetch(`/api/canvas/${canvasId}`, { method: "DELETE" });
      router.push("/dashboard");
    } catch {
      // silently fail
    }
  }, [canvasId, router, readOnly]);

  const handleExplainViability = useCallback(() => {
    if (!viabilityData) return;

    // Open chat bar
    setChatMinimized(false);
    setChatTargetBlock(null); // System-level chat

    // Seeded with the concrete question and problems, never the 0-100 score.
    // This was the last place the old number still surfaced: it wrote
    // "Evidence score: 20/100" straight into the chat, so the invented
    // precision the badge had stopped showing reappeared the moment anyone
    // clicked "Ask AI".
    const counts = deriveQptpFromViability(viabilityData);
    const question = viabilityData.whatAbout?.trim();
    const problems = viabilityData.factorsDown ?? [];

    let seed: string;
    if (question) {
      const header = counts
        ? `${counts.questions} ${counts.questions === 1 ? "question" : "questions"} · ${counts.problems} potential ${counts.problems === 1 ? "problem" : "problems"} to prepare for.`
        : "Help me prepare for this.";
      const problemList = problems.length > 0 ? `\n\nPotential problems:\n${problems.map((p) => `- ${p}`).join("\n")}` : "";
      seed = `${header}\n\n${question}${problemList}`;
    } else if (problems.length > 0) {
      seed = `Help me get ready to answer these potential problems with my canvas:\n${problems.map((p) => `- ${p}`).join("\n")}`;
    } else {
      seed = "What are the weakest parts of my canvas right now, and what should I test first?";
    }

    setPendingChatMessage(seed);
  }, [viabilityData]);

  const handleDeepDiveDataChange = useCallback(
    (blockType: BlockType, data: MarketResearchData) => {
      if (readOnly) return;
      setBlocks((prev) => {
        const next = new Map(prev);
        const b = next.get(blockType);
        if (b) next.set(blockType, { ...b, deepDiveData: data });
        return next;
      });
    },
    [readOnly],
  );

  // ─── Segment Handlers ──────────────────────────────────────────────────────

  const handleSegmentCreate = useCallback(
    async (data: {
      name: string;
      description?: string;
      earlyAdopterFlag?: boolean;
      priorityScore?: number;
    }) => {
      if (readOnly) return null;
      try {
        const res = await fetch(`/api/canvas/${canvasId}/segments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) return null;
        const { segment: doc } = await res.json();
        const seg: Segment = {
          $id: doc.$id,
          name: doc.name,
          description: doc.description ?? "",
          earlyAdopterFlag: doc.earlyAdopterFlag ?? false,
          priorityScore: doc.priorityScore ?? 50,
          demographics: doc.demographics ?? "",
          psychographics: doc.psychographics ?? "",
          behavioral: doc.behavioral ?? "",
          geographic: doc.geographic ?? "",
          estimatedSize: doc.estimatedSize ?? "",
          colorHex: doc.colorHex ?? undefined,
        };
        setSegments((prev) => new Map(prev).set(seg.$id, seg));
        return seg;
      } catch {
        return null;
      }
    },
    [canvasId, readOnly],
  );

  const handleSegmentUpdate = useCallback(
    async (segmentId: string, updates: Partial<Segment>) => {
      if (readOnly) return;
      try {
        const res = await fetch(
          `/api/canvas/${canvasId}/segments/${segmentId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          },
        );
        if (!res.ok) return;
        const { segment: doc } = await res.json();
        const seg: Segment = {
          $id: doc.$id,
          name: doc.name,
          description: doc.description ?? "",
          earlyAdopterFlag: doc.earlyAdopterFlag ?? false,
          priorityScore: doc.priorityScore ?? 50,
          demographics: doc.demographics ?? "",
          psychographics: doc.psychographics ?? "",
          behavioral: doc.behavioral ?? "",
          geographic: doc.geographic ?? "",
          estimatedSize: doc.estimatedSize ?? "",
          colorHex: doc.colorHex ?? undefined,
        };
        setSegments((prev) => new Map(prev).set(seg.$id, seg));
        setBlocks((prev) => {
          const next = new Map(prev);
          for (const [bt, block] of next) {
            if (block.linkedSegments?.some((s) => s.$id === seg.$id)) {
              next.set(bt, {
                ...block,
                linkedSegments: block.linkedSegments.map((s) =>
                  s.$id === seg.$id ? seg : s,
                ),
              });
            }
          }
          return next;
        });
      } catch {
        // silently fail
      }
    },
    [canvasId, readOnly],
  );

  const handleSegmentDelete = useCallback(
    async (segmentId: string) => {
      if (readOnly) return;
      try {
        const res = await fetch(
          `/api/canvas/${canvasId}/segments/${segmentId}`,
          { method: "DELETE" },
        );
        if (!res.ok) return;
        setFocusSegmentId((cur) => (cur === segmentId ? null : cur));
        setSegments((prev) => {
          const next = new Map(prev);
          next.delete(segmentId);
          return next;
        });
        setBlocks((prev) => {
          const next = new Map(prev);
          for (const [bt, block] of next) {
            if (block.linkedSegments?.some((s) => s.$id === segmentId)) {
              next.set(bt, {
                ...block,
                linkedSegments: block.linkedSegments.filter(
                  (s) => s.$id !== segmentId,
                ),
              });
            }
          }
          return next;
        });
      } catch {
        // silently fail
      }
    },
    [canvasId, readOnly],
  );

  const handleSegmentLink = useCallback(
    async (
      blockType: BlockType,
      segmentId: string,
      segmentOverride?: Segment,
    ) => {
      if (readOnly) return;
      try {
        const res = await fetch(
          `/api/canvas/${canvasId}/blocks/${blockType}/segments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ segmentId }),
          },
        );
        if (!res.ok) return;
        const seg = segmentOverride ?? segments.get(segmentId);
        if (!seg) return;
        setBlocks((prev) => {
          const next = new Map(prev);
          const block = next.get(blockType);
          if (block) {
            const existing = block.linkedSegments ?? [];
            if (!existing.some((s) => s.$id === segmentId)) {
              next.set(blockType, {
                ...block,
                linkedSegments: [...existing, seg],
              });
            }
          }
          return next;
        });
      } catch {
        // silently fail
      }
    },
    [canvasId, segments, readOnly],
  );

  const handleSegmentUnlink = useCallback(
    async (blockType: BlockType, segmentId: string) => {
      if (readOnly) return;
      try {
        const res = await fetch(
          `/api/canvas/${canvasId}/blocks/${blockType}/segments?segmentId=${segmentId}`,
          { method: "DELETE" },
        );
        if (!res.ok) return;
        setBlocks((prev) => {
          const next = new Map(prev);
          const block = next.get(blockType);
          if (block) {
            next.set(blockType, {
              ...block,
              linkedSegments: (block.linkedSegments ?? []).filter(
                (s) => s.$id !== segmentId,
              ),
            });
          }
          return next;
        });
      } catch {
        // silently fail
      }
    },
    [canvasId, readOnly],
  );

  // ─── Block Item Handlers ───────────────────────────────────────────────────

  const debouncedSaveItems = useCallback(
    (
      blockType: BlockType,
      content: { bmc: string; lean: string; items?: BlockItem[] },
    ) => {
      if (readOnly) return;
      setSaveStatus("unsaved");
      const key = `__items_${blockType}`;
      const existing = saveTimers.current.get(key);
      if (existing) clearTimeout(existing);
      saveTimers.current.set(
        key,
        setTimeout(() => {
          saveBlock(blockType, content);
          saveTimers.current.delete(key);
        }, 800),
      );
    },
    [saveBlock, readOnly],
  );

  const updateBlockItems = useCallback(
    (blockType: BlockType, updater: (items: BlockItem[]) => BlockItem[]) => {
      if (readOnly) return;
      setBlocks((prev) => {
        const next = new Map(prev);
        const block = next.get(blockType);
        if (!block) return prev;
        const updatedItems = updater(block.content.items ?? []);
        // Deduplicate items by ID (prevent React Strict Mode double-creation)
        const items = updatedItems.filter(
          (item, index, arr) =>
            arr.findIndex((i) => i.id === item.id) === index,
        );
        const newContent = { ...block.content, items };
        next.set(blockType, { ...block, content: newContent });
        debouncedSaveItems(blockType, newContent);
        return next;
      });
    },
    [debouncedSaveItems, readOnly],
  );

  const handleItemCreate = useCallback(
    (blockType: BlockType) => {
      if (readOnly) return;
      const newItem: BlockItem = {
        id: crypto.randomUUID(),
        name: "New item",
        tags: [],
        linkedItemIds: [],
        linkedSegmentIds: [],
        createdAt: new Date().toISOString(),
      };
      updateBlockItems(blockType, (items) => [...items, newItem]);
    },
    [updateBlockItems, readOnly],
  );

  const handleItemUpdate = useCallback(
    (blockType: BlockType, itemId: string, updates: Partial<BlockItem>) => {
      if (readOnly) return;
      updateBlockItems(blockType, (items) =>
        items.map((item) =>
          item.id === itemId ? { ...item, ...updates } : item,
        ),
      );
    },
    [updateBlockItems, readOnly],
  );

  const handleItemDelete = useCallback(
    (blockType: BlockType, itemId: string) => {
      if (readOnly) return;
      updateBlockItems(blockType, (items) =>
        items.filter((item) => item.id !== itemId),
      );
    },
    [updateBlockItems, readOnly],
  );

  const handleItemToggleSegment = useCallback(
    (blockType: BlockType, itemId: string, segmentId: string) => {
      if (readOnly) return;
      updateBlockItems(blockType, (items) =>
        items.map((item) => {
          if (item.id !== itemId) return item;
          const linked = item.linkedSegmentIds.includes(segmentId);
          return {
            ...item,
            linkedSegmentIds: linked
              ? item.linkedSegmentIds.filter((id: string) => id !== segmentId)
              : [...item.linkedSegmentIds, segmentId],
          };
        }),
      );
    },
    [updateBlockItems, readOnly],
  );

  const handleItemToggleLink = useCallback(
    (blockType: BlockType, itemId: string, linkedItemId: string) => {
      if (readOnly) return;
      updateBlockItems(blockType, (items) =>
        items.map((item) => {
          if (item.id !== itemId) return item;
          const linked = item.linkedItemIds.includes(linkedItemId);
          return {
            ...item,
            linkedItemIds: linked
              ? item.linkedItemIds.filter((id) => id !== linkedItemId)
              : [...item.linkedItemIds, linkedItemId],
          };
        }),
      );
    },
    [updateBlockItems, readOnly],
  );

  // Track old content for revert/undo of accepted edits
  const revertMapRef = useRef<
    Map<string, { blockType: BlockType; oldContent: BlockContent }>
  >(new Map());

  // Handle accepted block edit from AI chat (single edit at a time)
  const handleAcceptEdit = useCallback(
    async (_proposalId: string, edit: BlockEditProposal) => {
      if (readOnly) return;
      const existing = blocks.get(edit.blockType);
      if (!existing) return;

      // Store old content for potential revert
      const revertKey = `${_proposalId}-${edit.blockType}`;
      revertMapRef.current.set(revertKey, {
        blockType: edit.blockType,
        oldContent: { ...existing.content },
      });

      let newContent = { ...existing.content };

      if (edit.mode === "both" || isSharedBlock(edit.blockType)) {
        newContent = {
          bmc: edit.newContent,
          lean: edit.newContent,
          items: existing.content.items,
        };
      } else if (edit.mode === "lean") {
        newContent = { ...newContent, lean: edit.newContent };
      } else {
        newContent = { ...newContent, bmc: edit.newContent };
      }

      // Update local state immediately (optimistic)
      setBlocks((prev) => {
        const next = new Map(prev);
        next.set(edit.blockType, { ...existing, content: newContent });
        return next;
      });

      // Persist to server, then re-analyze
      await saveBlock(edit.blockType, newContent);
      handleAnalyze(edit.blockType);
    },
    [blocks, saveBlock, handleAnalyze, readOnly],
  );

  const handleRejectEdit = useCallback(() => {
    // No-op — UI handles the visual feedback
  }, []);

  const handleRevertEdit = useCallback(
    async (proposalId: string) => {
      if (readOnly) return;
      // Find stored old content for this proposal
      for (const [key, entry] of revertMapRef.current) {
        if (key.startsWith(proposalId)) {
          const existing = blocks.get(entry.blockType);
          if (!existing) continue;

          // Restore old content
          setBlocks((prev) => {
            const next = new Map(prev);
            next.set(entry.blockType, {
              ...existing,
              content: entry.oldContent,
            });
            return next;
          });

          await saveBlock(entry.blockType, entry.oldContent);
          handleAnalyze(entry.blockType);
          revertMapRef.current.delete(key);
          break;
        }
      }
    },
    [blocks, saveBlock, handleAnalyze, readOnly],
  );

  // Handle accepted segment from AI chat — create in DB and link to expanded block
  const handleAcceptSegment = useCallback(
    async (_segKey: string, proposal: SegmentProposal) => {
      if (readOnly) return;
      const targetBlock = expandedBlock ?? "customer_segments";
      const seg = await handleSegmentCreate({
        name: proposal.name,
        description: proposal.description,
        priorityScore:
          proposal.priority === "high"
            ? 80
            : proposal.priority === "medium"
              ? 50
              : 20,
      });
      if (!seg) return;
      // Also persist the extra fields
      await handleSegmentUpdate(seg.$id, {
        demographics: proposal.demographics,
        psychographics: proposal.psychographics,
        behavioral: proposal.behavioral,
        geographic: proposal.geographic,
        estimatedSize: proposal.estimatedSize,
      });
      await handleSegmentLink(targetBlock, seg.$id, seg);
    },
    [
      expandedBlock,
      handleSegmentCreate,
      handleSegmentUpdate,
      handleSegmentLink,
      readOnly,
    ],
  );

  // Handle accepted block item from AI chat — create as BlockItem (legacy) + Card (normalized)
  const handleAcceptItem = useCallback(
    (_itemKey: string, proposal: BlockItemProposal) => {
      if (readOnly) return;
      const targetBlock = expandedBlock;
      if (!targetBlock) return;
      // Legacy: still write to contentJson items for backward compat
      const newItem: BlockItem = {
        id: crypto.randomUUID(),
        name: proposal.name,
        tags: [],
        linkedSegmentIds: [],
        linkedItemIds: [],
        createdAt: new Date().toISOString(),
      };
      updateBlockItems(targetBlock, (items) => [...items, newItem]);
    },
    [expandedBlock, updateBlockItems, readOnly],
  );

  // Check if any non-shared block has lean content (to show convert button)
  const hasLeanContent = (() => {
    for (const def of BLOCK_DEFINITIONS) {
      if (isSharedBlock(def.type)) continue;
      const b = blocks.get(def.type);
      if (b && b.content.lean.trim().length > 0) return true;
    }
    return false;
  })();

  // Convert Lean content into BMC fields using AI
  const [isConverting, setIsConverting] = useState(false);

  const handleConvertLeanToBmc = useCallback(async () => {
    if (readOnly) return;
    // Check if any BMC content would be overwritten
    const hasExistingBmc = BLOCK_DEFINITIONS.some((def) => {
      if (isSharedBlock(def.type)) return false;
      const b = blocks.get(def.type);
      return b && b.content.bmc.trim().length > 0;
    });

    if (
      hasExistingBmc &&
      !window.confirm(
        "AI will reinterpret your Lean Canvas content and overwrite existing BMC blocks. Continue?",
      )
    ) {
      return;
    }

    setIsConverting(true);
    try {
      const res = await fetch(`/api/canvas/${canvasId}/convert-lean-to-bmc`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        console.error("Conversion failed:", data.error);
        return;
      }

      const { updates } = (await res.json()) as {
        updates: {
          blockType: string;
          bmc: string;
          lean: string;
          reasoning: string;
        }[];
      };

      // Apply converted content to local state
      setBlocks((prev) => {
        const next = new Map(prev);
        for (const u of updates) {
          const existing = next.get(u.blockType as BlockType);
          if (!existing) continue;
          next.set(u.blockType as BlockType, {
            ...existing,
            content: {
              bmc: u.bmc,
              lean: u.lean,
              items: existing.content.items,
            },
          });
        }
        return next;
      });

      setSaveStatus("saved");
      setMode("bmc");
    } catch (err) {
      console.error("Conversion error:", err);
    } finally {
      setIsConverting(false);
    }
  }, [blocks, canvasId, readOnly]);

  // Check if all blocks have meaningful content (gate for deep-dive AI)
  const allBlocksFilled = (() => {
    for (const [type, b] of blocks) {
      const content = (
        isSharedBlock(type)
          ? b.content.bmc
          : mode === "lean"
            ? b.content.lean
            : b.content.bmc
      ).trim();
      if (content.length < 10) return false;
    }
    return blocks.size >= 9;
  })();

  const filledCount = (() => {
    let count = 0;
    for (const [type, b] of blocks) {
      const content = (
        isSharedBlock(type)
          ? b.content.bmc
          : mode === "lean"
            ? b.content.lean
            : b.content.bmc
      ).trim();
      if (content.length >= 10) count++;
    }
    return count;
  })();

  const expandedBlockData = expandedBlock
    ? blocks.get(expandedBlock)
    : undefined;

  const deepDiveBlockData = deepDiveBlock
    ? blocks.get(deepDiveBlock)
    : undefined;
  const activeChatBlock = expandedBlock ?? chatTargetBlock;
  const reservedRightSpace =
    !chatMinimized && isDesktop && !expandedBlock ? "460px" : undefined;
  const showPublicReadOnlyBanner = readOnly && canvasData.isPublic;

  useEffect(() => {
    if (readOnly && activeTab === "analysis") {
      const id = setTimeout(() => setActiveTab("canvas"), 0);
      return () => clearTimeout(id);
    }
  }, [activeTab, readOnly]);

  return (
    <div
      className="canvas-zoom-root flex flex-col min-h-screen p-5 pb-28 gap-3 transition-[padding-right] duration-300 ease-out"
      style={
        {
          paddingRight: reservedRightSpace,
          "--canvas-font-zoom": textZoom,
        } as CSSProperties
      }
    >
      {showPublicReadOnlyBanner && (
        <div
          style={{
            border: "1px solid color-mix(in srgb, var(--chroma-indigo) 30%, transparent)",
            borderRadius: "10px",
            padding: "0.5rem 0.75rem",
            background:
              "linear-gradient(90deg, color-mix(in srgb, var(--chroma-indigo) 16%, transparent), color-mix(in srgb, var(--chroma-pink) 10%, transparent))",
            color: "var(--foreground)",
            fontSize: "0.8rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.6rem",
          }}
        >
          <span>You are viewing this shared canvas in read-only mode.</span>
          <span
            className="mode-badge mode-badge-lean"
            style={{ padding: "0.2rem 0.45rem", fontSize: "0.68rem" }}
          >
            Shared
          </span>
        </div>
      )}
      <CanvasToolbar
        title={canvasData.title}
        mode={mode}
        saveStatus={saveStatus}
        readOnly={readOnly}
        onModeChange={setMode}
        onTitleChange={(title) => saveCanvas({ title })}
        onConvertLeanToBmc={handleConvertLeanToBmc}
        hasLeanContent={hasLeanContent}
        isConverting={isConverting}
        segments={segmentList}
        focusSegmentId={focusSegmentId}
        segmentItemCounts={segmentItemCounts}
        onFocusSegmentChange={setFocusSegmentId}
      />

      <CanvasTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSettingsClick={() => setShowSettings(true)}
        canvasId={canvasId}
        allBlocksFilled={allBlocksFilled}
        viabilityData={viabilityData}
        viabilityOutdated={viabilityOutdated}
        categoryCounts={categoryCounts}
        readOnly={readOnly}
        onExplainViability={handleExplainViability}
        onViabilityDataChange={(data) => {
          setViabilityData(data);
          setViabilityOutdated(false);
          viabilityBlocksFingerprintRef.current = blocksFingerprint;
          viabilityAssumptionsFingerprintRef.current = null;
        }}
        onNavigateToAssumption={handleNavigateToAssumption}
        economicsGenerating={economicsGenerating}
      />

      {/* Tab content */}
      {activeTab === "canvas" && !isMobile && !expandedBlock && (
        <BMCGrid
          mode={mode}
          blocks={blocks}
          focusedBlock={focusedBlock}
          readOnly={readOnly}
          analyzingBlock={analyzingBlock}
          chatTargetBlock={activeChatBlock}
          dimmed={false}
          allSegments={segmentList}
          focusSegmentId={focusSegmentId}
          focusSegmentColor={focusSegmentColor}
          hoveredItem={hoveredItem}
          onBlockChange={handleBlockChange}
          onBlockFocus={setFocusedBlock}
          onBlockBlur={() => setFocusedBlock(null)}
          onBlockExpand={setExpandedBlock}
          onBlockAddToChat={setChatTargetBlock}
          onBlockAnalyze={handleAnalyze}
          onSegmentClick={(segmentId) => {
            // Find which block owns this segment and expand it
            for (const [bt, block] of blocks) {
              if (block.linkedSegments?.some((s) => s.$id === segmentId)) {
                setExpandedBlock(bt);
                break;
              }
            }
          }}
          onAddSegment={async (name, description) => {
            const seg = await handleSegmentCreate({ name, description });
            if (seg) {
              await handleSegmentLink("customer_segments", seg.$id, seg);
            }
          }}
          onSegmentUpdate={async (segmentId, updates) => {
            await handleSegmentUpdate(segmentId, updates);
          }}
          onSegmentFocus={() => {
            setExpandedBlock("customer_segments");
          }}
          onItemCreate={handleItemCreate}
          onItemUpdate={handleItemUpdate}
          onItemDelete={handleItemDelete}
          onItemToggleSegment={handleItemToggleSegment}
          onItemToggleLink={handleItemToggleLink}
          onItemHover={setHoveredItem}
          riskHeatmap={riskHeatmap}
        />
      )}

      {activeTab === "canvas" && isMobile && (
        <MobileCanvasCarousel
          mode={mode}
          blocks={blocks}
          focusedBlock={mobileSheetBlock}
          analyzingBlock={analyzingBlock}
          chatTargetBlock={activeChatBlock}
          allSegments={Array.from(segments.values())}
          onBlockChange={handleBlockChange}
          onBlockFocus={setFocusedBlock}
          onBlockBlur={() => setFocusedBlock(null)}
          onBlockTap={setMobileSheetBlock}
          onBlockAddToChat={setChatTargetBlock}
          onBlockAnalyze={handleAnalyze}
          onSegmentClick={(segmentId) => {
            for (const [bt, block] of blocks) {
              if (block.linkedSegments?.some((s) => s.$id === segmentId)) {
                setMobileSheetBlock(bt);
                break;
              }
            }
          }}
          onAddSegment={async (name, description) => {
            const seg = await handleSegmentCreate({ name, description });
            if (seg) {
              await handleSegmentLink("customer_segments", seg.$id, seg);
            }
          }}
          onSegmentUpdate={async (segmentId, updates) => {
            await handleSegmentUpdate(segmentId, updates);
          }}
          onSegmentFocus={() => {
            setMobileSheetBlock("customer_segments");
          }}
          onItemCreate={handleItemCreate}
          onItemUpdate={handleItemUpdate}
          onItemDelete={handleItemDelete}
          onItemToggleSegment={handleItemToggleSegment}
          onItemToggleLink={handleItemToggleLink}
        />
      )}

      {activeTab === "analysis" && !readOnly && (
        <AnalysisView
          blocks={blocks}
          mode={mode}
          canvasId={canvasId}
          consistencyData={consistencyData}
          isCheckingConsistency={isCheckingConsistency}
          onRunConsistencyCheck={handleConsistencyCheck}
        />
      )}

      {activeTab === "market" && (
        <MarketView
          canvasId={canvasId}
          customerSegmentsBlock={blocks.get("customer_segments")}
          segments={segmentList}
          allBlocksFilled={allBlocksFilled}
          filledCount={filledCount}
          readOnly={readOnly}
          onDataChange={(data) =>
            handleDeepDiveDataChange("customer_segments", data)
          }
          onOpenCustomerSegments={() => {
            if (isMobile) {
              setMobileSheetBlock("customer_segments");
            } else {
              setExpandedBlock("customer_segments");
            }
          }}
        />
      )}

      {activeTab === "jtbd" && (
        <JTBDView
          canvasId={canvasId}
          customerSegmentsBlock={blocks.get("customer_segments")}
          segments={segmentList}
          allBlocksFilled={allBlocksFilled}
          filledCount={filledCount}
          readOnly={readOnly}
          onDataChange={(data) =>
            handleDeepDiveDataChange("customer_segments", data)
          }
          onOpenCustomerSegments={() => {
            if (isMobile) {
              setMobileSheetBlock("customer_segments");
            } else {
              setExpandedBlock("customer_segments");
            }
          }}
        />
      )}

      {activeTab === "assumptions" && (
        <AssumptionsView
          canvasId={canvasId}
          selectedAssumptionId={selectedAssumptionId}
          onAssumptionsChanged={handleAssumptionsChanged}
        />
      )}

      {activeTab === "economics" && (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <EconomicsView
            activeModule="unit_economics"
            economicsData={economicsData}
            canvasId={canvasId}
            blockType="revenue_streams"
            aiEnabled={allBlocksFilled}
            isGenerating={economicsGenerating}
            progress={economicsProgress}
            onGeneratingChange={(generating, progress) => {
              setEconomicsGenerating(generating);
              setEconomicsProgress(progress ?? null);
            }}
            onDataChange={(data) => setEconomicsData(data)}
          />
        </div>
      )}

      {activeTab === "notes" && (
        <NotesView
          value={notes}
          readOnly={readOnly}
          onChange={handleNotesChange}
        />
      )}

      {activeTab === "debug" && (
        <DebugPanel blocks={blocks} segments={Array.from(segments.values())} />
      )}

      {/* Mobile Focus Sheet */}
      {isMobile && mobileSheetBlock && blocks.get(mobileSheetBlock) && (
        <MobileFocusSheet
          blockType={mobileSheetBlock}
          block={blocks.get(mobileSheetBlock)!}
          mode={mode}
          canvasId={canvasId}
          isAnalyzing={analyzingBlock === mobileSheetBlock}
          allBlocksFilled={allBlocksFilled}
          filledCount={filledCount}
          allSegments={Array.from(segments.values())}
          onChange={(value) => handleBlockChange(mobileSheetBlock, value)}
          onClose={() => setMobileSheetBlock(null)}
          onAnalyze={() => handleAnalyze(mobileSheetBlock)}
          onDeepDive={() => setDeepDiveBlock(mobileSheetBlock)}
          onItemCreate={handleItemCreate}
          onItemUpdate={handleItemUpdate}
          onItemDelete={handleItemDelete}
          onItemToggleSegment={handleItemToggleSegment}
          chatSection={
            <BlockChatSection
              canvasId={canvasId}
              blockType={mobileSheetBlock}
              onAcceptEdit={handleAcceptEdit}
              onRejectEdit={handleRejectEdit}
              onRevertEdit={handleRevertEdit}
              onAcceptSegment={handleAcceptSegment}
              onAcceptItem={handleAcceptItem}
            />
          }
        />
      )}

      {/* Block Focus Panel (Desktop) */}
      {!isMobile && expandedBlock && expandedBlockData && (
        <BlockFocusPanel
          blockType={expandedBlock}
          block={expandedBlockData}
          mode={mode}
          canvasId={canvasId}
          isAnalyzing={analyzingBlock === expandedBlock}
          allBlocksFilled={allBlocksFilled}
          filledCount={filledCount}
          allSegments={Array.from(segments.values())}
          readOnly={readOnly}
          onChange={(value) => handleBlockChange(expandedBlock, value)}
          onClose={() => setExpandedBlock(null)}
          onAnalyze={() => handleAnalyze(expandedBlock)}
          onDeepDive={() => {
            if (!readOnly) setDeepDiveBlock(expandedBlock);
          }}
          onSegmentCreate={handleSegmentCreate}
          onSegmentUpdate={handleSegmentUpdate}
          onSegmentDelete={handleSegmentDelete}
          onSegmentLink={(segmentId, segmentOverride) =>
            handleSegmentLink(expandedBlock, segmentId, segmentOverride)
          }
          onSegmentUnlink={(segmentId) =>
            handleSegmentUnlink(expandedBlock, segmentId)
          }
          onItemCreate={handleItemCreate}
          onItemUpdate={handleItemUpdate}
          onItemDelete={handleItemDelete}
          onItemToggleSegment={handleItemToggleSegment}
          onItemToggleLink={handleItemToggleLink}
          onWidthChange={setFocusPanelWidth}
          chatSection={
            !readOnly ? (
              <BlockChatSection
                canvasId={canvasId}
                blockType={expandedBlock}
                onAcceptEdit={handleAcceptEdit}
                onRejectEdit={handleRejectEdit}
                onRevertEdit={handleRevertEdit}
                onAcceptSegment={handleAcceptSegment}
                onAcceptItem={handleAcceptItem}
              />
            ) : null
          }
        />
      )}

      {/* Expanded block detail — sits above backdrop (z-40) but below focus panel (z-50) */}
      {activeTab === "canvas" && !isMobile && expandedBlock && expandedBlockData && (
          <div className="fixed top-0 bottom-0 left-0 z-40 overflow-y-auto bg-background" style={{ right: `${focusPanelWidth}px` }}>
              <ExpandedCanvasOverview
                blocks={blocks}
                mode={mode}
                expandedBlock={expandedBlock}
                segments={Array.from(segments.values())}
                canvasId={canvasId}
                readOnly={readOnly}
                onBlockSelect={(bt) => setExpandedBlock(bt)}
                onDeepDiveDataChange={handleDeepDiveDataChange}
              />

              {/* Segment Evaluation (only for customer_segments) */}
              {expandedBlock === "customer_segments" &&
                !readOnly &&
                (expandedBlockData.linkedSegments?.length ?? 0) > 0 && (
                  <div className="px-6 pb-6 max-w-4xl mx-auto">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-display-small text-xs uppercase tracking-wider text-foreground-muted/70">
                        Segment Evaluation
                      </span>
                      <div className="flex-1 h-px bg-foreground/5" />
                    </div>
                    <InlineSegmentEval
                      canvasId={canvasId}
                      block={expandedBlockData}
                      segments={expandedBlockData.linkedSegments ?? []}
                      onDataChange={(data) =>
                        handleDeepDiveDataChange("customer_segments", data)
                      }
                    />
                  </div>
                )}
          </div>
        )}

      {/* Chat Bar */}
      {!readOnly && (
        <ChatBar
          canvasId={canvasId}
          chatBlock={activeChatBlock}
          minimized={chatMinimized}
          onMinimizedChange={(next) => setChatMinimized(next)}
          onAcceptEdit={handleAcceptEdit}
          onRejectEdit={handleRejectEdit}
          onRevertEdit={handleRevertEdit}
          pendingMessage={pendingChatMessage}
          onPendingMessageSent={() => setPendingChatMessage(null)}
        />
      )}

      {/* Deep Dive Overlay */}
      {!readOnly && deepDiveBlock && deepDiveBlockData && (
        <DeepDiveOverlay
          blockType={deepDiveBlock}
          canvasId={canvasId}
          deepDiveData={deepDiveBlockData.deepDiveData}
          segments={deepDiveBlockData.linkedSegments ?? []}
          allBlocksFilled={allBlocksFilled}
          filledCount={filledCount}
          onDataChange={(data) => handleDeepDiveDataChange(deepDiveBlock, data)}
          onClose={() => setDeepDiveBlock(null)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <CanvasSettingsModal
          open={showSettings}
          onOpenChange={setShowSettings}
          canvasSlug={canvasData.slug}
          description={canvasData.description}
          isPublic={canvasData.isPublic}
          textZoom={textZoom}
          onTextZoomChange={(value) => setTextZoom(clampTextZoom(value))}
          onSave={(updates) => saveCanvas(updates)}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
