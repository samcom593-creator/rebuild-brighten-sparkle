import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type RevealTag = "div" | "section" | "ul" | "ol" | "li" | "article";

/** The stagger stops here: index 8 and above all rise together, 240ms after the first. */
export const MAX_STAGGER_INDEX = 8;

/** The stagger slot a section takes: its index, never below 0, never past MAX_STAGGER_INDEX. */
export function clampStagger(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.floor(index)), MAX_STAGGER_INDEX);
}

/**
 * Entrance animations in CSS, not JavaScript (2026-10-28): nothing to measure, nothing to
 * schedule, and under prefers-reduced-motion the rise becomes a 200ms fade.
 *
 * `Reveal` rises once when it mounts; `index` staggers siblings by 30ms each, capped at
 * MAX_STAGGER_INDEX so a long run of sections never keeps the last one invisible while it
 * waits its turn. `RevealList` staggers its direct children by position, for rows and tiles,
 * and the CSS (src/styles/delight.css) stops at the 14th child: rows below the fold appear at
 * once, and a list of 500 rows never animates 500 of them.
 */
export function Reveal({
  as: Tag = "div",
  index = 0,
  className,
  style,
  children,
  ...rest
}: {
  as?: RevealTag;
  index?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "style" | "children">) {
  const vars = { ...style, "--rise-i": clampStagger(index) } as CSSProperties;
  return (
    <Tag className={cn("apex-rise", className)} style={vars} {...rest}>
      {children}
    </Tag>
  );
}

export function RevealList({
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  as?: RevealTag;
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag className={cn("apex-rise-list", className)} {...rest}>
      {children}
    </Tag>
  );
}
