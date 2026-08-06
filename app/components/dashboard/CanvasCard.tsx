import Link from "next/link";
import { DropdownMenu } from "@radix-ui/themes";
import { CanvasBmcPreview } from "./CanvasBmcPreview";
import { CountBadge } from "../ui/CountBadge";
import { severityColorFromCount, QUESTION_COLOR } from "@/lib/utils/qptp";
import type { QptpCounts } from "@/lib/utils/evidence-counts";
import type { BlockType, CanvasData } from "@/lib/types/canvas";

interface CanvasCardProps {
  canvas: CanvasData & {
    blocksCount: number;
    filledBlocks: BlockType[];
    qptp: QptpCounts | null;
  };
  onShare: (slug: string) => void;
  onTogglePublic: (canvasId: string, isPublic: boolean) => void;
  onDuplicate: (canvasId: string) => void;
  onDelete: (canvasId: string) => void;
  index?: number;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(dateStr));
}

export function CanvasCard({
  canvas,
  onShare,
  onTogglePublic,
  onDuplicate,
  onDelete,
  index = 0,
}: CanvasCardProps) {
  const progressPct = Math.round((canvas.blocksCount / 9) * 100);

  return (
    <article
      className="canvas-row"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <Link href={`/canvas/${canvas.slug}`} className="canvas-row-link">
        <CanvasBmcPreview filledBlocks={canvas.filledBlocks} />

        <div className="canvas-row-body">
          <div className="canvas-row-title-row">
            <span className="canvas-row-title">{canvas.title}</span>
            {canvas.isPublic ? (
              <span className="canvas-row-badge canvas-row-badge-public">
                Public
              </span>
            ) : null}
          </div>
          {canvas.description ? (
            <p className="canvas-row-desc">{canvas.description}</p>
          ) : (
            <p className="canvas-row-desc canvas-row-desc-empty">
              No description
            </p>
          )}
        </div>

        <div className="canvas-row-stats">
          <div className="canvas-row-progress">
            <div className="canvas-row-progress-track">
              <div
                className="canvas-row-progress-bar"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="canvas-row-progress-label">
              {canvas.blocksCount}/9
            </span>
          </div>

          {canvas.qptp ? (
            <span
              className="canvas-row-counts"
              aria-label={`${canvas.qptp.questions} questions, ${canvas.qptp.problems} potential problems`}
            >
              <CountBadge
                value={canvas.qptp.questions}
                unit="Q"
                color={QUESTION_COLOR}
                size="sm"
              />
              <CountBadge
                value={canvas.qptp.problems}
                unit="PTP"
                color={severityColorFromCount(canvas.qptp.problems)}
                size="sm"
              />
            </span>
          ) : null}

          {/* In-flow, not absolutely positioned — it used to overlap the counts. */}
          <time className="canvas-row-time" dateTime={canvas.$updatedAt}>
            <span className="canvas-row-time-relative">
              {timeAgo(canvas.$updatedAt ?? "")}
            </span>
            <span className="canvas-row-time-absolute">
              {formatDate(canvas.$updatedAt ?? "")}
            </span>
          </time>
        </div>
      </Link>

      <div className="canvas-row-actions">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <button
              className="canvas-row-menu-btn"
              aria-label="Canvas options"
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm5.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM13 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
              </svg>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content size="1" variant="soft" align="end">
            <DropdownMenu.Item asChild>
              <Link
                href={`/canvas/${canvas.slug}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                Open
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => onShare(canvas.slug)}>
              Copy link
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => onTogglePublic(canvas.$id, !canvas.isPublic)}
            >
              {canvas.isPublic ? "Make private" : "Make public"}
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => onDuplicate(canvas.$id)}>
              Duplicate
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item color="red" onSelect={() => onDelete(canvas.$id)}>
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </article>
  );
}
