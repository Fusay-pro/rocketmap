"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type {
  BlockDefinition,
  BlockState,
  BlockType,
  CanvasMode,
  RiskMetrics,
  Segment,
} from "@/lib/types/canvas";
import { getRiskBorderClass } from "@/lib/utils/risk";
import { BlockTooltip } from "./BlockTooltip";
import { BlockCard } from "./BlockCard";
import { SegmentCard } from "./SegmentCard";
import { BLOCK_ZONE_COLOR } from "./constants";

const BLOCK_ABBREVIATIONS: Record<BlockType, { bmc: string; lean: string }> = {
  key_partnerships: { bmc: "KP", lean: "PROB" },
  key_activities: { bmc: "KA", lean: "SOL" },
  key_resources: { bmc: "KR", lean: "KM" },
  value_prop: { bmc: "VP", lean: "UVP" },
  customer_relationships: { bmc: "CR", lean: "UA" },
  channels: { bmc: "CH", lean: "CH" },
  customer_segments: { bmc: "CS", lean: "CS" },
  cost_structure: { bmc: "COST", lean: "COST" },
  revenue_streams: { bmc: "REV", lean: "REV" },
};

const BLOCK_STATE_SURFACE_CLASS: Record<BlockState, string> = {
  calm: "bmc-cell-state-calm",
  healthy: "bmc-cell-state-healthy",
  warning: "bmc-cell-state-warning",
  critical: "bmc-cell-state-critical",
  ai: "bmc-cell-state-ai",
};

const COMPACT_WIDTH_PX = 150;

function BlockTypeIcon({ type }: { type: BlockType }) {
  const common = {
    width: 11,
    height: 11,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (type) {
    case "key_partnerships":
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 1 0-7l2-2a5 5 0 1 1 7 7l-1 1" />
          <path d="M14 11a5 5 0 0 1 0 7l-2 2a5 5 0 1 1-7-7l1-1" />
        </svg>
      );
    case "key_activities":
      return (
        <svg {...common}>
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
        </svg>
      );
    case "key_resources":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="7" ry="3" />
          <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
          <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
        </svg>
      );
    case "value_prop":
      return (
        <svg {...common}>
          <path d="m12 3 1.7 4.4L18 9.1l-4.3 1.7L12 15l-1.7-4.2L6 9.1l4.3-1.7L12 3z" />
        </svg>
      );
    case "customer_relationships":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      );
    case "channels":
      return (
        <svg {...common}>
          <path d="M3 11v2a4 4 0 0 0 4 4h2" />
          <path d="M3 7v2a8 8 0 0 0 8 8h2" />
          <path d="M3 3v2a12 12 0 0 0 12 12h2" />
        </svg>
      );
    case "customer_segments":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="2.5" />
          <circle cx="16" cy="9.5" r="2" />
          <path d="M4.5 20a5 5 0 0 1 9 0" />
          <path d="M14 20a4 4 0 0 1 6 0" />
        </svg>
      );
    case "cost_structure":
      return (
        <svg {...common}>
          <path d="M3 7h18v10H3z" />
          <path d="M7 11h10" />
          <path d="M9 15h3" />
        </svg>
      );
    case "revenue_streams":
      return (
        <svg {...common}>
          <path d="M4 19h16" />
          <path d="M7 15v-3" />
          <path d="M12 15V9" />
          <path d="M17 15V6" />
        </svg>
      );
    default:
      return null;
  }
}

interface BlockCellProps {
  definition: BlockDefinition;
  mode: CanvasMode;
  value: string;
  state: BlockState;
  isFocused: boolean;
  isAnalyzing: boolean;
  isChatTarget: boolean;
  confidenceScore: number;
  hasAnalysis: boolean;
  linkedSegments?: Segment[];
  blocks?: Array<{
    $id: string;
    blockType: BlockType;
    contentJson: string;
    confidenceScore: number;
    riskScore: number;
    segments: Segment[];
    state: BlockState;
  }>;
  allSegments?: Segment[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allBlockItems?: Map<BlockType, any[]>;
  focusSegmentId?: string | null;
  focusColor?: string;
  focusHasMatch?: boolean;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onExpand: () => void;
  onAddToChat: () => void;
  onAnalyze: () => void;
  onSegmentClick?: (segmentId: string) => void;
  onAddSegment?: (name: string, description?: string) => Promise<void>;
  onSegmentUpdate?: (
    segmentId: string,
    updates: Partial<Pick<Segment, "name" | "description">>,
  ) => Promise<void>;
  onSegmentFocus?: (segmentId: string) => void;
  onBlockCreate?: () => void;
  onBlockUpdate?: (blockId: string, updates: { contentJson: string }) => void;
  onBlockDelete?: (blockId: string) => void;
  onBlockToggleSegment?: (blockId: string, segmentId: string) => void;
  onBlockHover?: (blockId: string | null) => void;
  highlightedSegmentId?: string | null;
  onSegmentHover?: (segmentId: string | null) => void;
  blockRefCallback?: (blockId: string, el: HTMLElement | null) => void;
  segmentRefCallback?: (segmentId: string, el: HTMLElement | null) => void;
  riskMetrics?: RiskMetrics;
}

export function BlockCell({
  definition,
  mode,
  value,
  state,
  isFocused,
  isAnalyzing,
  isChatTarget,
  confidenceScore,
  hasAnalysis,
  linkedSegments,
  blocks,
  allSegments,
  allBlockItems,
  focusSegmentId,
  focusColor,
  focusHasMatch = false,
  readOnly = false,
  onFocus,
  onBlur,
  onExpand,
  onAddToChat,
  onAnalyze,
  onSegmentClick,
  onAddSegment,
  onSegmentUpdate,
  onSegmentFocus,
  onBlockCreate,
  onBlockUpdate,
  onBlockDelete,
  onBlockToggleSegment,
  onBlockHover,
  highlightedSegmentId,
  onSegmentHover,
  blockRefCallback,
  segmentRefCallback,
  riskMetrics,
}: BlockCellProps) {
  const cellRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);
  const [newSegmentName, setNewSegmentName] = useState("");
  const [newSegmentDesc, setNewSegmentDesc] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [addingNew, setAddingNew] = useState(false);

  const isSegmentBlock =
    definition.type === "customer_segments" && !!onAddSegment;

  const dedupedBlocks = useMemo(() => {
    if (!blocks) return [];
    const seenIds = new Set<string>();
    return blocks.reduce(
      (
        acc: Array<{ block: (typeof blocks)[number]; renderKey: string }>,
        block,
        index,
      ) => {
        const rawId = block.$id?.trim();
        if (!rawId) {
          acc.push({ block, renderKey: `block-${index}` });
          return acc;
        }
        if (seenIds.has(rawId)) return acc;
        seenIds.add(rawId);
        acc.push({ block, renderKey: rawId });
        return acc;
      },
      [],
    );
  }, [blocks]);

  const linkedSegmentById = useMemo(
    () =>
      new Map(
        (allSegments ?? []).map((segment) => [segment.$id, segment] as const),
      ),
    [allSegments],
  );

  const resolvedLinkedSegments = useMemo(() => {
    // For customer_segments block, show ALL segments regardless of linking
    if (isSegmentBlock) {
      return allSegments ?? [];
    }
    return (linkedSegments ?? []).map((seg) => {
      const fullSegment = linkedSegmentById.get(seg.$id);
      return fullSegment ?? seg;
    });
  }, [isSegmentBlock, allSegments, linkedSegments, linkedSegmentById]);

  const handleCreateSegment = useCallback(async () => {
    if (readOnly || !newSegmentName.trim() || !onAddSegment || isSaving) return;
    setIsSaving(true);
    await onAddSegment(
      newSegmentName.trim(),
      newSegmentDesc.trim() || undefined,
    );
    setNewSegmentName("");
    setNewSegmentDesc("");
    setAddingNew(false);
    setIsSaving(false);
  }, [newSegmentName, newSegmentDesc, onAddSegment, isSaving, readOnly]);

  const handleSaveSegmentEdit = useCallback(
    async (segId: string, updates: { name: string; description: string }) => {
      if (readOnly || !onSegmentUpdate) return;
      const original = resolvedLinkedSegments.find((s) => s.$id === segId);
      if (!original) return;
      const payload: Partial<Pick<Segment, "name" | "description">> = {};
      if (updates.name.trim() && updates.name.trim() !== original.name)
        payload.name = updates.name.trim();
      if (updates.description.trim() !== (original.description || ""))
        payload.description = updates.description.trim();
      if (Object.keys(payload).length > 0) {
        await onSegmentUpdate(segId, payload);
      }
    },
    [onSegmentUpdate, readOnly, resolvedLinkedSegments],
  );

  useEffect(() => {
    const node = cellRef.current;
    if (!node) return;

    const updateCompact = () => {
      setIsCompact(node.clientWidth < COMPACT_WIDTH_PX);
    };
    updateCompact();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateCompact);
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateCompact);
    return () => window.removeEventListener("resize", updateCompact);
  }, []);

  const label =
    mode === "lean" && definition.leanLabel
      ? definition.leanLabel
      : definition.bmcLabel;
  const abbreviatedLabel =
    mode === "lean"
      ? BLOCK_ABBREVIATIONS[definition.type].lean
      : BLOCK_ABBREVIATIONS[definition.type].bmc;
  const zoneColor = BLOCK_ZONE_COLOR[definition.type];
  const useAbbreviation = isCompact;
  const displayLabel = useAbbreviation ? abbreviatedLabel : label;

  const showLeanChip = mode === "lean" && definition.leanLabel !== null;
  const showActions = isFocused || isChatTarget || isAnalyzing;
  const stateSurfaceClass = BLOCK_STATE_SURFACE_CLASS[state];
  const riskBorderClass = riskMetrics
    ? getRiskBorderClass(riskMetrics.riskScore, riskMetrics.confidenceScore)
    : "";

  return (
    <div
      ref={cellRef}
      className={`bmc-cell bmc-cell-panel group relative state-transition ${stateSurfaceClass} ${riskBorderClass} ${
        isFocused ? "ring-1 ring-chroma-indigo/30" : ""
      }`}
      style={{
        gridColumn: definition.gridCol,
        gridRow: definition.gridRow,
      }}
      onClick={(e) => {
        // Only trigger focus if not clicking an action button or card
        if (e.target === e.currentTarget) {
          onFocus();
        }
      }}
    >
      {/* Segment focus accent — thin top bar tinted with the focused segment color */}
      {focusColor && focusHasMatch && (
        <span
          className="absolute top-0 left-2 right-2 h-[2px] rounded-full pointer-events-none z-10 transition-opacity duration-300 motion-reduce:transition-none"
          style={{ background: `color-mix(in srgb, ${focusColor} 70%, transparent)` }}
          aria-hidden="true"
        />
      )}

      <div className={`block-cell-actions ${showActions ? "is-visible" : ""} `}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          className="block-action-btn"
          aria-label={`Expand ${label}`}
          title="Expand"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
          <span>Expand</span>
        </button>
        {!readOnly && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddToChat();
              }}
              className={`block-action-btn ${isChatTarget ? "is-active" : ""}`}
              aria-label={`Add ${label} to chat`}
              title="Add to Canvas Chat"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                <line x1="8" y1="11" x2="16" y2="11" />
              </svg>
              <span>{isChatTarget ? "In Chat" : "Add to Chat"}</span>
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onAnalyze();
              }}
              className="block-action-btn"
              disabled={isAnalyzing}
              aria-label={`Test ${label} with AI`}
              title="Test with AI"
            >
              {isAnalyzing ? (
                <span className="w-3 h-3 rounded-full border border-current border-t-transparent animate-spin" />
              ) : (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3l1.7 4.4L18 9.1l-4.3 1.7L12 15l-1.7-4.2L6 9.1l4.3-1.7L12 3z" />
                  <path d="M18 14l.9 2.2L21 17l-2.1.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z" />
                </svg>
              )}
              <span>{isAnalyzing ? "Testing..." : "Test with AI"}</span>
            </button>
          </>
        )}
      </div>

      {/* Content wrapper with overflow handling */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 flex-shrink-0">
          <span
            className="inline-flex items-center gap-1.5 font-display-small uppercase tracking-wider text-[12.5px]"
            style={{ color: `color-mix(in srgb, ${zoneColor} 78%, var(--foreground))` }}
          >
            <span
              className="w-[18px] h-[18px] rounded-md shrink-0 inline-flex items-center justify-center"
              style={{
                color: zoneColor,
                backgroundColor: `color-mix(in srgb, ${zoneColor} 14%, transparent)`,
                border: `1px solid color-mix(in srgb, ${zoneColor} 28%, transparent)`,
              }}
            >
              <BlockTypeIcon type={definition.type} />
            </span>
            <span>{displayLabel}</span>
          </span>
        {showLeanChip && (
          <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-px rounded-full bg-chroma-indigo/10 text-chroma-indigo border border-chroma-indigo/20">
            Lean
          </span>
        )}
        <div className="flex-1" />
        {riskMetrics &&
          (riskMetrics.untestedHighRisk > 0 ||
            riskMetrics.untestedMediumRisk > 0) && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1 py-px rounded-full shrink-0"
              style={{
                backgroundColor:
                  riskMetrics.riskScore >= 70
                    ? "color-mix(in srgb, var(--state-critical) 15%, transparent)"
                    : "color-mix(in srgb, var(--state-warning) 15%, transparent)",
                color:
                  riskMetrics.riskScore >= 70
                    ? "var(--state-critical)"
                    : "var(--state-warning)",
              }}
              title={`Risk: ${riskMetrics.riskScore} | ${riskMetrics.untestedHighRisk} high, ${riskMetrics.untestedMediumRisk} med untested`}
            >
              <span
                className="w-1 h-1 rounded-full shrink-0"
                style={{
                  background:
                    riskMetrics.riskScore >= 70
                      ? "var(--state-critical)"
                      : "var(--state-warning)",
                }}
              />
              {riskMetrics.confidenceScore > 0 &&
                `${riskMetrics.confidenceScore}`}
            </span>
          )}
        {hasAnalysis && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              background:
                confidenceScore >= 0.7
                  ? "var(--state-healthy)"
                  : confidenceScore >= 0.4
                    ? "var(--state-warning)"
                    : "var(--state-critical)",
            }}
            title={`${Math.round(confidenceScore * 100)} confidence`}
          />
        )}
      </div>

      {/* Block cards - skip for customer_segments (segments are primary) */}
      {!isSegmentBlock && ((blocks && blocks.length > 0) || onBlockCreate) && (
        <div className="block-items-container">
          {dedupedBlocks.map(({ block, renderKey }) => (
            <BlockCard
              key={renderKey}
              block={block}
              allSegments={allSegments ?? []}
              allBlockItems={allBlockItems}
              highlightedSegmentId={highlightedSegmentId}
              onUpdate={(blockId, updates) => onBlockUpdate?.(blockId, updates)}
              onDelete={(blockId) => onBlockDelete?.(blockId)}
              onSegmentToggle={(blockId, segmentId) =>
                onBlockToggleSegment?.(blockId, segmentId)
              }
              onSegmentHover={onSegmentHover}
              onMouseEnter={() => onBlockHover?.(block.$id)}
              onMouseLeave={() => onBlockHover?.(null)}
              focusSegmentId={focusSegmentId}
              ref={(el) => blockRefCallback?.(block.$id, el)}
            />
          ))}
          {onBlockCreate && (
            <button
              onClick={onBlockCreate}
              className="w-full rounded-md border border-dashed border-border hover:border-foreground/20 px-2 py-1 text-[10px] text-foreground-muted/70 hover:text-foreground-muted/70 hover:bg-foreground/5 transition-colors text-left"
            >
              + Add block
            </button>
          )}
        </div>
      )}

      {/* Segment cards - customer_segments block */}
      {isSegmentBlock && (
        <div
          className="flex-1 min-h-0 overflow-y-auto px-2 pb-1.5 space-y-1"
          onClick={(e) => e.stopPropagation()}
        >
          {resolvedLinkedSegments.map((seg) => (
            <div
              key={seg.$id}
              className={`transition-opacity duration-300 motion-reduce:transition-none ${
                focusSegmentId && seg.$id !== focusSegmentId ? "opacity-40" : ""
              }`}
            >
              <SegmentCard
                segment={seg}
                mode="full"
                onSave={(updates) => handleSaveSegmentEdit(seg.$id, updates)}
                onFocus={() => onSegmentFocus?.(seg.$id)}
                onLink={() => onSegmentClick?.(seg.$id)}
                segmentRefCallback={(el) => segmentRefCallback?.(seg.$id, el)}
              />
            </div>
          ))}

          {/* New segment button */}
          {addingNew ? (
            <div className="rounded-md border border-border bg-canvas-surface p-1.5 space-y-1">
              <input
                value={newSegmentName}
                onChange={(e) => setNewSegmentName(e.target.value)}
                className="w-full bg-foreground/5 rounded px-1.5 py-0.5 text-[10px] font-medium text-foreground outline-none border border-border focus:border-foreground/25"
                placeholder="Segment name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newSegmentName.trim())
                    handleCreateSegment();
                  if (e.key === "Escape") {
                    setNewSegmentName("");
                    setNewSegmentDesc("");
                    setAddingNew(false);
                  }
                }}
                onFocus={(e) => e.stopPropagation()}
              />
              <textarea
                value={newSegmentDesc}
                onChange={(e) => setNewSegmentDesc(e.target.value)}
                className="w-full bg-foreground/5 rounded px-1.5 py-0.5 text-[10px] text-foreground-muted outline-none border border-border focus:border-foreground/25 resize-none"
                placeholder="Description..."
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setNewSegmentName("");
                    setNewSegmentDesc("");
                    setAddingNew(false);
                  }
                }}
                onFocus={(e) => e.stopPropagation()}
              />
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleCreateSegment()}
                  disabled={isSaving || !newSegmentName.trim()}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/8 text-foreground hover:bg-foreground/12 transition-colors disabled:opacity-40"
                >
                  {isSaving ? "..." : "Create"}
                </button>
                <button
                  onClick={() => {
                    setNewSegmentName("");
                    setNewSegmentDesc("");
                    setAddingNew(false);
                  }}
                  className="text-[9px] px-1.5 py-0.5 rounded text-foreground-muted/50 hover:text-foreground-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            !readOnly && (
              <button
                onClick={() => setAddingNew(true)}
                className="w-full rounded-md border border-dashed border-border hover:border-foreground/20 px-2 py-1.5 text-[10px] text-foreground-muted/70 hover:text-foreground-muted/70 hover:bg-foreground/5 transition-colors text-left"
              >
                + New segment
              </button>
            )
          )}
        </div>
      )}

      {/* Segment sub-rows for non-segment blocks */}
      {!isSegmentBlock &&
        resolvedLinkedSegments &&
        resolvedLinkedSegments.length > 0 && (
          <div className="px-2 pb-0.5 space-y-0.5">
            {resolvedLinkedSegments.slice(0, 4).map((seg) => (
              <div
                key={seg.$id}
                className={`transition-opacity duration-300 motion-reduce:transition-none ${
                  focusSegmentId && seg.$id !== focusSegmentId ? "opacity-40" : ""
                }`}
              >
                <SegmentCard
                  segment={seg}
                  mode="compact"
                  onLink={() => onSegmentClick?.(seg.$id)}
                  segmentRefCallback={(el) => segmentRefCallback?.(seg.$id, el)}
                />
              </div>
            ))}
            {resolvedLinkedSegments.length > 4 && (
              <span className="text-[9px] text-foreground-muted/70 px-1.5">
                +{resolvedLinkedSegments.length - 4} more
              </span>
            )}
          </div>
        )}
      </div>
      {/* End content wrapper */}

      {/* Help tooltip - bottom right */}
      <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
        <BlockTooltip definition={definition} mode={mode}>
          <button
            type="button"
            className="w-4 h-4 rounded-full flex items-center justify-center text-foreground-muted/70 hover:text-foreground-muted/70 hover:bg-foreground/5 transition-all"
            aria-label={`Help for ${label}`}
          >
            <span className="font-mono text-[9px] font-bold">?</span>
          </button>
        </BlockTooltip>
      </div>
    </div>
  );
}
