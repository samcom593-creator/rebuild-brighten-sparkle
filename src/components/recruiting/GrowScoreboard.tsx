import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ScoreTile {
  label: string;
  /** null renders "—": unknown is never shown as zero. */
  value: number | null;
  /** One short line saying what the number counts. Shown at every width; keep it to two lines on a phone. */
  hint: string;
  /** Full definition for the tooltip. */
  definition?: string;
  /** Picks this tile's list; omit for a number that has no list of its own. */
  onSelect?: () => void;
  active?: boolean;
  /** Draws attention when the number needs action (e.g. people waiting on a call). */
  emphasis?: boolean;
}

/**
 * The few numbers that matter, large and calm (Grow redesign, 2026-10-28). A tile
 * with `onSelect` is a button that opens exactly the people it counts, so the number
 * and the list cannot disagree. Four across at every width. The label and the hint
 * each get a fixed two-line box, so when one label wraps ("Worked today") the big
 * numbers still sit on one line across the strip, and the hint keeps its meaning on a
 * phone instead of disappearing. `notice` is a full-width line under the tiles for the
 * one case the numbers are withheld, so a dash is never left unexplained.
 */
export function GrowScoreboard({ label, tiles, notice, className }: { label: string; tiles: ScoreTile[]; notice?: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className={cn("grid grid-cols-4 overflow-hidden rounded-xl border border-border bg-card", className)}>
      {notice ? (
        <div role="status" className="col-span-4 flex flex-col gap-2 border-b border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          {notice}
        </div>
      ) : null}
      {tiles.map((t) => {
        const body = (
          <>
            <span className="block min-h-8 text-[13px] font-medium leading-4 text-muted-foreground sm:min-h-10 sm:text-sm sm:leading-5">{t.label}</span>
            <span
              className={cn(
                "mt-1 block text-2xl font-semibold tabular-nums leading-none tracking-[-0.02em] sm:text-[2rem]",
                t.emphasis && (t.value ?? 0) > 0 ? "text-primary" : "text-foreground",
              )}
            >
              {t.value === null ? "—" : t.value.toLocaleString()}
            </span>
            <span className="mt-1.5 block min-h-8 text-[13px] leading-4 text-muted-foreground">{t.hint}</span>
          </>
        );
        // flex-col justify-start: a <button> centres its content vertically, so a tile whose hint
        // wrapped to more lines than its neighbours' lifted its number out of line with theirs.
        const base = "flex min-w-0 flex-col justify-start border-b-2 border-r border-b-transparent border-r-border p-3 text-left last:border-r-0 sm:p-5";
        return t.onSelect ? (
          <button
            key={t.label}
            type="button"
            title={t.definition}
            aria-pressed={t.active ?? false}
            onClick={t.onSelect}
            className={cn(
              base,
              "transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
              t.active && "border-b-primary bg-primary/5",
            )}
          >
            {body}
          </button>
        ) : (
          <div key={t.label} title={t.definition} className={base}>
            {body}
          </div>
        );
      })}
    </section>
  );
}
