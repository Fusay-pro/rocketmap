"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

interface ErrorBannerProps {
  error: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "Authentication failed. Please try again.",
  session_expired: "Your session has expired. Please sign in again.",
  unauthorized: "Please sign in to continue.",
};

export function ErrorBanner({ error }: ErrorBannerProps) {
  const searchParams = useSearchParams();

  // Remember *which* error was dismissed rather than a bare visible flag reset
  // by an effect. Same intent — a new error re-shows the banner — but derived
  // during render instead of via a second render pass. It also fixes a real
  // edge case: the old effect didn't run when a different error arrived under
  // an unchanged `searchParams` identity, leaving the new error hidden.
  const dismissKey = `${error ?? ""}::${searchParams.toString()}`;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  if (!error || dismissedKey === dismissKey) {
    return null;
  }

  const message = ERROR_MESSAGES[error] || "An error occurred. Please try again.";

  return (
    <div className="w-full flex justify-center px-6 mb-8">
      <div
        role="alert"
        className="inline-flex items-center gap-2.5 rounded-full border border-state-critical/30 bg-state-critical/10 px-4 py-2 shadow-[0_8px_24px_rgba(var(--ink-shadow),0.08)]"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-state-critical"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" x2="12" y1="8" y2="12" />
          <line x1="12" x2="12.01" y1="16" y2="16" />
        </svg>
        <p className="text-sm font-medium text-foreground whitespace-nowrap">
          {message}
        </p>
        <button
          type="button"
          onClick={() => setDismissedKey(dismissKey)}
          aria-label="Dismiss error"
          className="shrink-0 -mr-1 p-1 rounded-full text-foreground-muted hover:text-foreground transition-colors"
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
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function ErrorBannerFromParams() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  return <ErrorBanner error={error} />;
}
