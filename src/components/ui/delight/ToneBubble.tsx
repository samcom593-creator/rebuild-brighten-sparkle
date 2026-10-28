import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_CLASS, type Tone } from "@/lib/tones";

const BUBBLE_SIZE = {
  sm: "h-8 w-8 [&>svg]:h-4 [&>svg]:w-4",
  md: "h-10 w-10 [&>svg]:h-5 [&>svg]:w-5",
  lg: "h-12 w-12 [&>svg]:h-6 [&>svg]:w-6",
} as const;

/**
 * A round, softly tinted holder for an icon: the "bubble" beside a title, a tile label or a
 * row (2026-10-28). Decorative by itself, so it is hidden from assistive technology; the
 * words next to it carry the meaning.
 */
export function ToneBubble({
  tone = "gold",
  size = "md",
  pulse = false,
  className,
  children,
}: {
  tone?: Tone;
  size?: keyof typeof BUBBLE_SIZE;
  /** Breathes slowly. Only for a live state, never for decoration. */
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = TONE_CLASS[tone];
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full border", t.soft, t.text, t.border, BUBBLE_SIZE[size], pulse && "apex-breathe", className)}
    >
      {children}
    </span>
  );
}

/**
 * A pill that says a state in words and shows it in a tone. The dot is optional and
 * decorative; the text is the content.
 */
export function TonePill({
  tone,
  dot = false,
  className,
  children,
}: {
  tone: Tone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = TONE_CLASS[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-semibold leading-5", t.soft, t.text, t.border, className)}>
      {dot && <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", t.dot)} />}
      {children}
    </span>
  );
}
