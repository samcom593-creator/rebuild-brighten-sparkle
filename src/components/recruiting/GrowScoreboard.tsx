import { cn } from "@/lib/utils";

export interface ScoreTile {
  label: string;
  /** null renders "—": unknown is never shown as zero. */
  value: number | null;
  /** One short line saying what the number counts. Hidden on phones. */
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
 * and the list cannot disagree. Four across at every width; the hint line drops on
 * phones so the strip stays one row.
 */
export function GrowScoreboard({ label, tiles, className }: { label: string; tiles: ScoreTile[]; className?: string }) {
  return (
    <section aria-label={label} className={cn("grid grid-cols-4 overflow-hidden rounded-xl border border-border bg-card", className)}>
      {tiles.map((t) => {
        const body = (
          <>
            <span className="block text-[13px] font-medium leading-4 text-muted-foreground sm:text-sm">{t.label}</span>
            <span
              className={cn(
                "mt-1.5 block text-2xl font-semibold tabular-nums leading-none tracking-[-0.02em] sm:text-[2rem]",
                t.emphasis && (t.value ?? 0) > 0 ? "text-primary" : "text-foreground",
              )}
            >
              {t.value === null ? "—" : t.value.toLocaleString()}
            </span>
            <span className="mt-1.5 hidden text-[13px] leading-4 text-muted-foreground sm:block">{t.hint}</span>
          </>
        );
        const base = "min-w-0 border-b-2 border-r border-b-transparent border-r-border p-3 text-left last:border-r-0 sm:p-5";
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
