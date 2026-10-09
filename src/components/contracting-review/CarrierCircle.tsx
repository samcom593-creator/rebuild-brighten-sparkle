import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { circleAriaLabel, markSentence, type MarkInfo, type ReviewCarrier } from "@/lib/contractReview";

/**
 * One carrier circle: a real button with a real name. Empty ring = Not yet reviewed. Filled with a check = confirmed
 * by hand. It is never red, never "late", and pressing it records a manual confirmation only; it does not talk to
 * the carrier. While a save is in flight it cannot be pressed again.
 */
export function CarrierCircle({ carrier, mark, canEdit, saving, onToggle, showLabel = false }: {
  carrier: ReviewCarrier;
  mark: MarkInfo | null;
  canEdit: boolean;
  saving: boolean;
  onToggle: (confirmed: boolean) => void;
  /** Printed under the circle on phones; from md up the table's column header carries the name and this becomes screen-reader-only. */
  showLabel?: boolean;
}) {
  const confirmed = !!mark;
  return (
    <button
      type="button"
      data-circle={carrier.key}
      aria-pressed={confirmed}
      aria-busy={saving}
      aria-label={circleAriaLabel(carrier.label, mark, canEdit)}
      title={markSentence(mark)}
      disabled={!canEdit || saving}
      onClick={() => onToggle(!confirmed)}
      className={cn(
        "group inline-flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-md px-1 py-1",
        "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] disabled:cursor-default",
        canEdit && !saving ? "hover:bg-muted/60" : "",
      )}
    >
      <span
        className={cn(
          "grid h-7 w-7 place-items-center rounded-full border-2 transition-colors",
          confirmed ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60 bg-transparent text-transparent",
          saving ? "opacity-70" : "",
        )}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin text-current" aria-hidden /> : confirmed ? <Check className="h-4 w-4" aria-hidden /> : null}
      </span>
      {showLabel ? (
        <span className="text-xs font-medium text-foreground md:sr-only">
          {carrier.label}
          <span className="block text-[11px] font-normal text-muted-foreground">{confirmed ? "Confirmed" : "Not yet reviewed"}</span>
        </span>
      ) : null}
    </button>
  );
}
