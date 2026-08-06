"use client";

import { useTheme } from "next-themes";
import { useIsHydrated } from "@/lib/utils/useIsHydrated";

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

const THEMES = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const;

type ThemeValue = (typeof THEMES)[number]["value"];

type ThemeToggleProps = {
  variant?: "icon" | "segmented";
  showLabels?: boolean;
};

export function ThemeToggle({ variant = "icon", showLabels = true }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const mounted = useIsHydrated();

  const cycleTheme = () => {
    const order: ThemeValue[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(theme as ThemeValue) + 1) % order.length];
    setTheme(next);
  };

  const active = THEMES.find((t) => t.value === theme) ?? THEMES[0];
  const ActiveIcon = active.Icon;

  if (!mounted) {
    if (variant === "segmented") {
      return (
        <div className="theme-picker" aria-hidden="true">
          {THEMES.map((item) => (
            <span key={item.value} className="theme-picker-btn">
              <item.Icon />
              {showLabels ? <span>{item.label}</span> : null}
            </span>
          ))}
        </div>
      );
    }

    return (
      <button
        type="button"
        aria-label="Toggle theme"
        className="theme-toggle-icon"
      >
        <SunIcon />
      </button>
    );
  }

  if (variant === "segmented") {
    return (
      <div className="theme-picker" role="group" aria-label="Theme">
        {THEMES.map((item) => {
          const isActive = theme === item.value;
          return (
            <button
              key={item.value}
              type="button"
              className={`theme-picker-btn${isActive ? " is-active" : ""}`}
              onClick={() => setTheme(item.value)}
              aria-pressed={isActive}
              title={item.label}
            >
              <item.Icon />
              {showLabels ? <span>{item.label}</span> : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={`Theme: ${active.label}. Click to cycle.`}
      title={`Theme: ${active.label}`}
      className="theme-toggle-icon"
    >
      <ActiveIcon />
    </button>
  );
}
