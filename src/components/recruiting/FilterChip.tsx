import { X } from "lucide-react";

/**
 * An active filter, visible and removable in one tap, so hidden state never surprises
 * anyone. The one chip for the Call list, Pipeline and New hires pages (Grow review
 * 2026-10-28, finding 36); it used to be written out in each.
 *
 * The whole chip is the button, 44px tall, so the tap target is never a 24px cross. Its
 * tint is the same "chosen" tint as an active list button, so on these screens a tinted
 * pill always means "this is switched on", and a plain bordered one always opens a list.
 */
export function FilterChip({ label, count, onRemove }: {
  /** What is filtered, in words: "License: Pending", "Board view". */
  label: string;
  /** The rows behind the filter, when the page knows the number. */
  count?: number;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${label} filter`}
      className="inline-flex h-11 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 pl-4 pr-3 text-sm font-medium text-foreground transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
    >
      {label}
      {typeof count === "number" && <span className="tabular-nums text-muted-foreground">{count.toLocaleString()}</span>}
      <X aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
