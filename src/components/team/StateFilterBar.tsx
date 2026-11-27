import { MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  NO_STATE,
  NO_STATE_LABEL,
  isStateFilterActive,
  toggleState,
  type StateCountSummary,
  type StateFilter,
} from "@/lib/teamRecovery";

/**
 * StateFilterBar (MP-TEAM-RECOVERY): one row of state chips with counts, shared by every list on the
 * Team recovery page. Tap a state to show only people who can write there; tap several to widen; the
 * "No state on file" chip shows the people a state filter would otherwise hide. Counts are the people
 * on the lists, before the filter, so the bar never shrinks as it is used.
 */
export function StateFilterBar({
  counts,
  value,
  onChange,
  compact = false,
}: {
  counts: StateCountSummary;
  value: StateFilter;
  onChange: (next: StateFilter) => void;
  compact?: boolean;
}) {
  const active = isStateFilterActive(value);
  const shown = compact ? counts.counts.slice(0, 12) : counts.counts;
  const hidden = counts.counts.length - shown.length;
  if (counts.total === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by state">
      <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
        State
      </span>
      {shown.map((c) => (
        <button
          key={c.state}
          type="button"
          aria-pressed={value.has(c.state)}
          onClick={() => onChange(toggleState(value, c.state))}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[13px] font-semibold tabular-nums focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
            value.has(c.state)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-foreground hover:bg-muted",
          )}
        >
          {c.state} <span className="opacity-75">{c.n}</span>
        </button>
      ))}
      {hidden > 0 && <span className="text-xs text-muted-foreground">and {hidden} more</span>}
      {counts.unknown > 0 && (
        <button
          type="button"
          aria-pressed={value.has(NO_STATE)}
          onClick={() => onChange(toggleState(value, NO_STATE))}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[13px] font-medium tabular-nums focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
            value.has(NO_STATE)
              ? "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : "border-dashed border-border bg-card text-muted-foreground hover:bg-muted",
          )}
        >
          {NO_STATE_LABEL} <span className="opacity-75">{counts.unknown}</span>
        </button>
      )}
      {active && (
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onChange(new Set())}>
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Clear
        </Button>
      )}
    </div>
  );
}
