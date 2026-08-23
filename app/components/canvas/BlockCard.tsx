"use client";

import { useState, useCallback, useEffect, useRef, forwardRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type { BlockType, Segment } from "@/lib/types/canvas";

/** Internal content shape for BlockCard (separate from main BlockContent) */
interface CardContent {
  text: string;
  tags?: string[];
}

interface BlockCardProps {
  block: {
    $id: string;
    blockType: BlockType;
    contentJson: string;
    confidenceScore: number;
    riskScore: number;
    segments: Segment[];
  };
  allSegments: Segment[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allBlockItems?: Map<BlockType, any[]>;
  highlightedSegmentId?: string | null;
  focusSegmentId?: string | null;
  onUpdate: (blockId: string, updates: { contentJson: string }) => void;
  onDelete: (blockId: string) => void;
  onSegmentToggle: (blockId: string, segmentId: string) => void;
  onSegmentHover?: (segmentId: string | null) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const BlockCard = forwardRef<HTMLDivElement, BlockCardProps>(
  function BlockCard(
    { block, allSegments, onUpdate, onDelete, onSegmentToggle, onSegmentHover, highlightedSegmentId, focusSegmentId, onMouseEnter, onMouseLeave },
    ref
  ) {
    // Parse contentJson with fallback
    const content: CardContent = useMemo(() => {
      try {
        return JSON.parse(block.contentJson);
      } catch {
        return { text: block.contentJson || '', tags: [] };
      }
    }, [block.contentJson]);

    const [showLinkPicker, setShowLinkPicker] = useState(false);
    const textRef = useRef<HTMLDivElement>(null);
    const savedTextRef = useRef(content.text);

    const linkBtnRef = useRef<HTMLButtonElement>(null);
    const floatingRef = useRef<HTMLDivElement>(null);
    const [floatingPos, setFloatingPos] = useState<{ top: number; left: number } | null>(null);

    const linkedSegmentIds = useMemo(
      () => new Set(block.segments.map(s => s.$id)),
      [block.segments],
    );

    const hasSegments = block.segments.length > 0;
    const hasTags = content.tags && content.tags.length > 0;

    // Position the floating menu when it opens
    useEffect(() => {
      if (!showLinkPicker || !linkBtnRef.current) return;
      const rect = linkBtnRef.current.getBoundingClientRect();
      setFloatingPos({
        top: rect.bottom + 4,
        left: Math.max(8, rect.left - 60),
      });
    }, [showLinkPicker]);

    // Close on outside click
    useEffect(() => {
      if (!showLinkPicker) return;
      const handler = (e: MouseEvent) => {
        if (
          floatingRef.current && !floatingRef.current.contains(e.target as Node) &&
          linkBtnRef.current && !linkBtnRef.current.contains(e.target as Node)
        ) {
          setShowLinkPicker(false);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [showLinkPicker]);

    // Close on escape
    useEffect(() => {
      if (!showLinkPicker) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === "Escape") setShowLinkPicker(false);
      };
      document.addEventListener("keydown", handler);
      return () => document.removeEventListener("keydown", handler);
    }, [showLinkPicker]);

    // Sync text when it changes externally
    useEffect(() => {
      if (textRef.current && document.activeElement !== textRef.current) {
        textRef.current.innerText = content.text;
        savedTextRef.current = content.text;
      }
    }, [content.text]);

    const handleTextFocus = useCallback(() => {
      savedTextRef.current = textRef.current?.innerText || '';
    }, []);

    const handleTextBlur = useCallback(() => {
      const currentText = textRef.current?.innerText?.trim() || '';
      if (currentText !== savedTextRef.current.trim()) {
        onUpdate(block.$id, {
          contentJson: JSON.stringify({ text: currentText, tags: content.tags })
        });
      }
    }, [block.$id, content.tags, onUpdate]);

    // Whether this card contains the globally-hovered segment
    const cardHasHighlightedSegment = highlightedSegmentId
      ? linkedSegmentIds.has(highlightedSegmentId)
      : false;

    // Confidence color
    const confidenceColor =
      block.confidenceScore >= 70 ? 'var(--state-healthy)' :
      block.confidenceScore >= 40 ? 'var(--state-warning)' :
      'var(--state-critical)';

    // Segment focus lens emphasis for this item.
    // 'match' → linked to focused segment (normal); 'other' → linked only to
    // other segments (dimmed); 'unassigned' → no segments (intermediate + hint).
    const focusEmphasis: 'none' | 'match' | 'other' | 'unassigned' =
      !focusSegmentId
        ? 'none'
        : block.segments.length === 0
          ? 'unassigned'
          : linkedSegmentIds.has(focusSegmentId)
            ? 'match'
            : 'other';
    const focusOpacityClass =
      focusEmphasis === 'other'
        ? 'opacity-40'
        : focusEmphasis === 'unassigned'
          ? 'opacity-80'
          : '';

    return (
      <div
        ref={ref}
        className={`block-item-card group group/card relative transition-opacity duration-300 motion-reduce:transition-none ${focusOpacityClass}${cardHasHighlightedSegment ? ' ring-1 ring-foreground/20' : ''}`}
        style={cardHasHighlightedSegment ? { transition: 'box-shadow 150ms ease, ring 150ms ease, opacity 300ms ease' } : undefined}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Delete button — revealed on card hover/focus. Kept out of the resting
            state so ~20 red glyphs aren't the most saturated thing on the canvas. */}
        <button
          onClick={() => {
            if (confirm('Delete this block? This cannot be undone.')) {
              onDelete(block.$id);
            }
          }}
          className="absolute top-1 right-1 text-[11px] px-1 py-0.5 rounded text-state-critical/70 hover:text-state-critical opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none transition-opacity duration-150 cursor-pointer z-10"
          title="Delete block"
        >
          ×
        </button>

        <div className="p-1.5 space-y-1">
          {/* Text content — inline contenteditable */}
          <div
            ref={textRef}
            contentEditable
            suppressContentEditableWarning
            onFocus={handleTextFocus}
            onBlur={handleTextBlur}
            onClick={(e) => {
              // Place caret at click position (browser handles this natively for contenteditable)
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-[13px] text-foreground/90 text-left w-full transition-colors whitespace-pre-wrap break-words leading-relaxed cursor-text outline-none hover:text-foreground line-clamp-3 group-hover/card:line-clamp-none focus:line-clamp-none [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-foreground/30"
            data-placeholder="Enter block content..."
            spellCheck={false}
            style={{ minHeight: '20px' }}
          >
            {content.text}
          </div>

          {/* Tags — always visible, styled as primary pills */}
          {hasTags && (
            <div className="flex items-center gap-1 flex-wrap">
              {content.tags!.map((tag, i) => (
                <span
                  key={i}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-chroma-indigo/12 text-chroma-indigo border border-chroma-indigo/15"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Linked segments — always visible as colored pills */}
          {hasSegments && (
            <div className="flex items-center gap-1 flex-wrap">
              {block.segments.map(seg => {
                const isHighlighted = highlightedSegmentId === seg.$id;
                const segColor = seg.colorHex || 'var(--state-calm)';
                return (
                  <span
                    key={seg.$id}
                    className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border transition-all duration-150 cursor-default ${
                      isHighlighted
                        ? 'border-foreground/30 text-foreground/90 bg-foreground/10'
                        : 'border-border text-foreground-muted/80 bg-canvas-surface'
                    }`}
                    style={{
                      borderColor: isHighlighted ? `${segColor}60` : undefined,
                      boxShadow: isHighlighted ? `0 0 6px ${segColor}40` : undefined,
                    }}
                    onMouseEnter={() => onSegmentHover?.(seg.$id)}
                    onMouseLeave={() => onSegmentHover?.(null)}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: segColor }}
                    />
                    {seg.name}
                  </span>
                );
              })}
            </div>
          )}

          {/* Footer: link button + confidence (only when > 0) + delete (hover only) */}
          <div className="flex items-center gap-1.5">
            {/* Link to segments button */}
            <button
              ref={linkBtnRef}
              onClick={() => setShowLinkPicker(!showLinkPicker)}
              className={`flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded transition motion-reduce:transition-none duration-150 ${
                // Persistent only when it carries information (a link count) or
                // while its picker is open. Otherwise it's one hover away — an
                // unlabelled 9px chain on every item read as noise, not a control.
                hasSegments || showLinkPicker
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100'
              } ${
                showLinkPicker
                  ? 'text-foreground-muted bg-foreground/8'
                  : 'text-foreground-muted/70 hover:text-foreground-muted hover:bg-foreground/5'
              }`}
              title="Link to segments"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span>{block.segments.length || ''}</span>
            </button>

            {/* Unassigned hint — surfaced only while a segment lens is active */}
            {focusEmphasis === 'unassigned' && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-1 py-px rounded border border-dashed border-foreground/25 text-foreground-muted/50">
                unassigned
              </span>
            )}

            {/* Confidence score — only when meaningful */}
            {block.confidenceScore > 0 && (
              <span
                className="text-[10px] font-mono ml-auto"
                style={{ color: confidenceColor }}
              >
                {block.confidenceScore}
              </span>
            )}

          </div>
        </div>

        {/* Floating segment picker (portalled to body) */}
        {showLinkPicker && floatingPos && allSegments.length > 0 && createPortal(
          <div
            ref={floatingRef}
            className="fixed z-[100] rounded-lg border border-border bg-canvas-surface shadow-[0_20px_25px_-5px_rgba(var(--ink-shadow),0.1),0_8px_10px_-6px_rgba(var(--ink-shadow),0.1)] p-1 space-y-0.5 max-h-[180px] w-[180px] overflow-y-auto"
            style={{ top: floatingPos.top, left: floatingPos.left }}
          >
            <div className="text-[10px] text-foreground-muted/70 uppercase tracking-wider px-1.5 py-0.5 font-mono">
              Link segments
            </div>
            {allSegments.map(seg => {
              const isLinked = linkedSegmentIds.has(seg.$id);
              return (
                <button
                  key={seg.$id}
                  onClick={() => onSegmentToggle(block.$id, seg.$id)}
                  className={`flex items-center gap-1.5 w-full text-left px-1.5 py-1 rounded transition-colors ${
                    isLinked ? 'bg-foreground/8' : 'hover:bg-foreground/5'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: seg.colorHex || 'var(--state-calm)' }}
                  />
                  <span className={`text-[10px] truncate flex-1 ${
                    isLinked ? 'text-foreground/80' : 'text-foreground-muted/60'
                  }`}>
                    {seg.name}
                  </span>
                  {isLinked && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-state-healthy/80 shrink-0">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
      </div>
    );
  }
);
