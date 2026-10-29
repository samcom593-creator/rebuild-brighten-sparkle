import { RECRUIT_STEPS } from "@/lib/recruitJourney";
import { TONE_CLASS, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

/**
 * A recruit's progress as seven segments, one per step of src/lib/recruitJourney.ts, filled up to
 * the step they are on in that step's tone (OVERHAUL-recruits, 2026-10-29). The step is always
 * written beside the bar, so the bar is hidden from assistive technology and never carries the
 * meaning alone. A closed person, or a stage with no step, draws an empty bar.
 */
export function JourneyBar({ index, tone, className }: { index: number | null; tone: Tone; className?: string }) {
  const filled = Math.max(0, Math.min(RECRUIT_STEPS.length, index ?? 0));
  return (
    <span aria-hidden="true" data-filled={filled} className={cn("inline-flex h-2 shrink-0 items-stretch gap-[3px]", className)}>
      {RECRUIT_STEPS.map((step, i) => (
        <span
          key={step.key}
          className={cn("flex-1 rounded-full transition-colors", i < filled ? TONE_CLASS[tone].dot : "bg-muted-foreground/20")}
        />
      ))}
    </span>
  );
}
