"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingModal } from "../components/OnboardingModal";
import { CanvasCard } from "../components/dashboard/CanvasCard";
import { AIGuidedModal } from "../components/dashboard/AIGuidedModal";
import type { BlockType } from "@/lib/types/canvas";
import type { QptpCounts } from "@/lib/utils/evidence-counts";

interface DashboardClientProps {
  user: {
    $id: string;
    email: string;
    name: string;
  };
  onboardingCompleted: boolean;
  canvases: {
    $id: string;
    title: string;
    slug: string;
    description: string;
    isPublic: boolean;
    $updatedAt: string;
    $createdAt: string;
    blocksCount: number;
    filledBlocks: BlockType[];
    qptp: QptpCounts | null;
  }[];
}

type CanvasGroup = {
  label: string;
  items: DashboardClientProps["canvases"];
};

function groupCanvasesByRecency(
  canvases: DashboardClientProps["canvases"],
): CanvasGroup[] {
  const now = Date.now();
  const day = 86400000;
  const groups: Record<string, DashboardClientProps["canvases"]> = {
    Today: [],
    "This week": [],
    "This month": [],
    Older: [],
  };

  for (const canvas of canvases) {
    const age = now - new Date(canvas.$updatedAt).getTime();
    if (age < day) groups.Today.push(canvas);
    else if (age < day * 7) groups["This week"].push(canvas);
    else if (age < day * 30) groups["This month"].push(canvas);
    else groups.Older.push(canvas);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

export function DashboardClient({
  user,
  onboardingCompleted,
  canvases,
}: DashboardClientProps) {
  const [showOnboarding, setShowOnboarding] = useState(!onboardingCompleted);
  const [showGuidedModal, setShowGuidedModal] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const shareFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const clearShareFeedback = () => {
    if (shareFeedbackTimer.current) {
      clearTimeout(shareFeedbackTimer.current);
      shareFeedbackTimer.current = null;
    }
  };

  const showShareFeedbackMessage = (message: string) => {
    clearShareFeedback();
    setShareFeedback(message);
    shareFeedbackTimer.current = setTimeout(() => {
      setShareFeedback((current) => (current === message ? null : current));
    }, 2200);
  };

  const handleOnboardingComplete = async () => {
    try {
      const response = await fetch("/api/complete-onboarding", {
        method: "POST",
      });
      if (response.ok) {
        setShowOnboarding(false);
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
      setShowOnboarding(false);
    }
  };

  const handleNewCanvas = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled Canvas" }),
      });
      if (!res.ok) throw new Error("Failed to create canvas");
      const { slug } = await res.json();
      router.push(`/canvas/${slug}`);
    } catch (error) {
      console.error("Failed to create canvas:", error);
      setCreating(false);
    }
  };

  const handleDuplicate = async (canvasId: string) => {
    try {
      const res = await fetch(`/api/canvas/${canvasId}/duplicate`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to duplicate");
      router.refresh();
    } catch (error) {
      console.error("Failed to duplicate canvas:", error);
    }
  };

  const handleShare = async (slug: string) => {
    try {
      const url = `${window.location.origin}/canvas/${slug}`;
      await navigator.clipboard.writeText(url);
      showShareFeedbackMessage("Link copied");
    } catch (error) {
      console.error("Failed to copy link:", error);
      showShareFeedbackMessage("Couldn't copy link");
    }
  };

  const handleTogglePublic = async (canvasId: string, isPublic: boolean) => {
    try {
      const res = await fetch(`/api/canvas/${canvasId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic }),
      });
      if (!res.ok) throw new Error("Failed to update canvas visibility");
      showShareFeedbackMessage(isPublic ? "Canvas is public" : "Canvas is private");
      router.refresh();
    } catch (error) {
      console.error("Failed to update visibility:", error);
      showShareFeedbackMessage("Couldn't update visibility");
    }
  };

  const handleDelete = async (canvasId: string) => {
    if (!confirm("Delete this canvas? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/canvas/${canvasId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      router.refresh();
    } catch (error) {
      console.error("Failed to delete canvas:", error);
    }
  };

  const filteredCanvases = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return canvases;
    return canvases.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [canvases, search]);

  const groupedCanvases = useMemo(
    () => groupCanvasesByRecency(filteredCanvases),
    [filteredCanvases],
  );

  const totalBlocks = canvases.reduce((sum, c) => sum + c.blocksCount, 0);
  const avgCompletion =
    canvases.length > 0
      ? Math.round((totalBlocks / (canvases.length * 9)) * 100)
      : 0;

  useEffect(() => {
    return () => clearShareFeedback();
  }, []);

  let rowIndex = 0;

  return (
    <>
      {shareFeedback ? (
        <div className="dash-toast" role="status">
          <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14Zm3.78-9.22a.75.75 0 0 0-1.06-1.06L7.25 8.19 5.28 6.22a.75.75 0 0 0-1.06 1.06l2.5 2.5a.75.75 0 0 0 1.06 0l4.5-4.5Z" />
          </svg>
          {shareFeedback}
        </div>
      ) : null}

      <OnboardingModal
        isOpen={showOnboarding}
        onComplete={handleOnboardingComplete}
        onChatToCreate={() => setShowGuidedModal(true)}
      />
      <AIGuidedModal
        open={showGuidedModal}
        onOpenChange={setShowGuidedModal}
      />

      <div className="dash-page">
        <header className="dash-header">
          <div className="dash-header-main">
            <h1 className="dash-title">Canvases</h1>
            {canvases.length > 0 ? (
              <div className="dash-stats">
                <span className="dash-stat">
                  <span className="dash-stat-value">{canvases.length}</span>
                  <span className="dash-stat-label">total</span>
                </span>
                <span className="dash-stat-divider" />
                <span className="dash-stat">
                  <span className="dash-stat-value">{avgCompletion}%</span>
                  <span className="dash-stat-label">avg fill</span>
                </span>
              </div>
            ) : null}
          </div>

          <div className="dash-toolbar">
            {canvases.length > 0 ? (
              <div className="dash-search">
                <svg className="dash-search-icon" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85ZM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z" />
                </svg>
                <input
                  type="search"
                  className="dash-search-input"
                  placeholder="Filter canvases…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Filter canvases"
                />
                {search ? (
                  <button
                    type="button"
                    className="dash-search-clear"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="dash-actions">
              <button
                type="button"
                className="dash-btn dash-btn-ghost"
                onClick={() => setShowGuidedModal(true)}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                  <path d="M8 1.5a.5.5 0 0 1 .5.5v1.5a.5.5 0 0 1-1 0V2a.5.5 0 0 1 .5-.5ZM3.05 3.05a.5.5 0 0 1 .707 0l1.06 1.06a.5.5 0 1 1-.707.707L3.05 3.757a.5.5 0 0 1 0-.707ZM12.95 3.05a.5.5 0 0 1 0 .707l-1.06 1.06a.5.5 0 1 1-.707-.707l1.06-1.06a.5.5 0 0 1 .707 0ZM1.5 8a.5.5 0 0 1 .5-.5h1.5a.5.5 0 0 1 0 1H2a.5.5 0 0 1-.5-.5Zm12 0a.5.5 0 0 1 .5-.5h1.5a.5.5 0 0 1 0 1H14a.5.5 0 0 1-.5-.5ZM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
                </svg>
                AI guided
              </button>
              <button
                type="button"
                className="dash-btn dash-btn-primary"
                onClick={handleNewCanvas}
                disabled={creating}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                  <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4Z" />
                </svg>
                New canvas
              </button>
            </div>
          </div>
        </header>

        {canvases.length > 0 && filteredCanvases.length === 0 ? (
          <div className="dash-empty-filter">
            <p>No canvases match &ldquo;{search}&rdquo;</p>
            <button
              type="button"
              className="dash-btn dash-btn-ghost"
              onClick={() => setSearch("")}
            >
              Clear filter
            </button>
          </div>
        ) : filteredCanvases.length > 0 ? (
          <div className="canvas-list">
            {groupedCanvases.map((group) => (
              <section key={group.label} className="canvas-group">
                <h2 className="canvas-group-label">{group.label}</h2>
                <div className="canvas-group-list">
                  {group.items.map((canvas) => {
                    const idx = rowIndex++;
                    return (
                      <CanvasCard
                        key={canvas.$id}
                        canvas={canvas}
                        index={idx}
                        onShare={handleShare}
                        onTogglePublic={handleTogglePublic}
                        onDuplicate={handleDuplicate}
                        onDelete={handleDelete}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="dash-empty">
            <div className="dash-empty-visual" aria-hidden="true">
              <div className="dash-empty-grid">
                {Array.from({ length: 9 }).map((_, i) => (
                  <span
                    key={i}
                    className="dash-empty-cell"
                    style={{ animationDelay: `${i * 80}ms` }}
                  />
                ))}
              </div>
            </div>
            <h2 className="dash-empty-title">Start your first canvas</h2>
            <p className="dash-empty-text">
              Map assumptions, validate ideas, and stress-test your startup
              model — block by block.
            </p>
            <div className="dash-empty-actions">
              <button
                type="button"
                className="dash-btn dash-btn-primary"
                onClick={handleNewCanvas}
                disabled={creating}
              >
                New canvas
              </button>
              <button
                type="button"
                className="dash-btn dash-btn-ghost"
                onClick={() => setShowGuidedModal(true)}
              >
                Or start with AI
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
