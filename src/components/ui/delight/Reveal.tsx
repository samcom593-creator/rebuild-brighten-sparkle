import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type RevealTag = "div" | "section" | "ul" | "ol" | "li" | "article";

/**
 * Entrance animations in CSS, not JavaScript (2026-10-28): nothing to measure, nothing to
 * schedule, and the global prefers-reduced-motion rule switches them off.
 *
 * `Reveal` rises once when it mounts; `index` staggers siblings by 40ms each.
 * `RevealList` staggers its direct children by position, for rows and tiles.
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
  const vars = { ...style, "--rise-i": index } as CSSProperties;
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
