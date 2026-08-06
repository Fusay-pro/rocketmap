"use client";

/**
 * The `6Q · 1PTP` count pair: a display-font number with a small mono unit.
 *
 * This is the app's replacement for invented 0-100 scores — a count always
 * refers to items you can actually open and read. Extracted from
 * ConsistencyReport so every surface renders it identically.
 */

type CountBadgeSize = "sm" | "lg";

const NUMBER_SIZE: Record<CountBadgeSize, string> = {
  sm: "text-base",
  lg: "text-2xl",
};

const UNIT_SIZE: Record<CountBadgeSize, string> = {
  sm: "text-[10px]",
  lg: "text-xs",
};

interface CountBadgeProps {
  value: number;
  /** Short unit code, e.g. "Q" or "PTP". Rendered uppercase. */
  unit: string;
  color: string;
  size?: CountBadgeSize;
}

export function CountBadge({ value, unit, color, size = "lg" }: CountBadgeProps) {
  return (
    <span className="flex items-baseline gap-1">
      <span className={`${NUMBER_SIZE[size]} font-display leading-none`} style={{ color }}>
        {value}
      </span>
      <span
        className={`${UNIT_SIZE[size]} text-foreground-muted font-mono uppercase leading-none`}
      >
        {unit}
      </span>
    </span>
  );
}
