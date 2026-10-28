import { cn } from "@/lib/utils";
import type { RowStatus, StatusTone } from "@/components/pipeline/worklist/worklistStatus";
import { TONE_CLASS, type Tone } from "@/lib/tones";

/**
 * The status vocabulary of src/components/pipeline/worklist/worklistStatus.ts in the shared
 * tones (src/lib/tones.ts, 2026-10-28): late or unreadable is "act now", due today "needs a
 * nudge", new is "new or scheduled", everything else quiet.
 */
export const STATUS_TONE: Record<StatusTone, Tone> = {
  danger: "hot",
  warning: "warm",
  primary: "cool",
  neutral: "slate",
};

/** A status in words with a tint behind it. The words carry the meaning; the tint only helps. */
export function StatusPill({ status, className }: { status: RowStatus; className?: string }) {
  if (!status.label) return null;
  const tone = TONE_CLASS[STATUS_TONE[status.tone]];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[13px] font-semibold leading-5",
        tone.soft,
        tone.text,
        tone.border,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
      {status.label}
    </span>
  );
}
