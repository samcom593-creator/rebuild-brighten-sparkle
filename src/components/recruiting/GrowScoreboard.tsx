import type { ReactNode } from "react";

import { CountUp } from "@/components/ui/delight/CountUp";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { TONE_CLASS, type Tone } from "@/lib/tones";
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
  /** The state this number stands for; colours the bubble, the selected tile and an emphasised number. */
  tone?: Tone;
  /** A lucide icon for the bubble beside the label. */
  icon?: ReactNode;
}

/**
 * The few numbers that matter, large and warm (Grow redesign, 2026-10-28). A tile with
 * `onSelect` is a button that opens exactly the people it counts, so the number and the list
 * cannot disagree. Four across at every width. The label and the hint each get a fixed
 * two-line box, so when one label wraps ("Worked today") the big numbers still sit on one line
 * across the strip, and the hint keeps its meaning on a phone instead of disappearing.
 * `notice` is a full-width line under the tiles for the one case the numbers are withheld, so
 * a dash is never left unexplained.
 *
 * Colour layer (2026-10-28): each tile carries a tone (src/lib/tones.ts) that colours its
 * icon bubble and its selected state; the number counts up when it changes; the four tiles
 * rise in one after the other on first paint (240ms each, 30ms apart) and a tile that is a
 * button presses in (scale 0.98, 120ms) so it answers the finger before its list changes.
 */
export function GrowScoreboard({ label, tiles, notice, className }: { label: string; tiles: ScoreTile[]; notice?: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className={cn("apex-rise-list grid grid-cols-2 overflow-hidden sm:grid-cols-4 rounded-2xl border border-border bg-card", className)}>
      {notice ? (
        <div role="status" className="col-span-2 flex sm:col-span-4 flex-col gap-2 border-b border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          {notice}
        </div>
      ) : null}
      {tiles.map((t, i) => {
        const tone: Tone = t.tone ?? "gold";
        const lit = t.emphasis && (t.value ?? 0) > 0;
        const body = (
          <>
            <span className="flex min-h-10 flex-row items-center gap-2 sm:min-h-12">
              {t.icon ? <ToneBubble tone={tone} size="sm">{t.icon}</ToneBubble> : null}
              <span className="block text-[13px] font-semibold leading-4 text-muted-foreground sm:text-[15px] sm:leading-5">{t.label}</span>
            </span>
            <CountUp
              value={t.value}
              className={cn(
                "mt-1.5 block text-[2rem] font-bold leading-none tracking-[-0.02em] sm:text-[2.5rem]",
                lit ? TONE_CLASS[tone].text : "text-foreground",
              )}
            />
            <span className="mt-2 block min-h-8 text-[13px] leading-4 text-muted-foreground sm:text-sm sm:leading-[18px]">{t.hint}</span>
          </>
        );
        // flex-col justify-start: a <button> centres its content vertically, so a tile whose hint
        // wrapped to more lines than its neighbours' lifted its number out of line with theirs.
        const base = "flex min-w-0 flex-col justify-start border-b-[3px] border-r border-b-transparent border-r-border p-3 text-left last:border-r-0 sm:p-5";
        // Phones get a 2x2 grid (four tiles of ~80px squeezed every label onto two or three lines
        // and set the numbers at different heights). The right column drops its right border,
        // the second row gets a top divider, and from sm up it is one row of four again.
        const cell = cn(base, i % 2 === 1 && i !== tiles.length - 1 && "border-r-0 sm:border-r", i % 2 === 1 && i === tiles.length - 1 && "border-r-0", i >= 2 && "border-t border-t-border sm:border-t-0");
        return t.onSelect ? (
          <button
            key={t.label}
            type="button"
            title={t.definition}
            aria-pressed={t.active ?? false}
            onClick={t.onSelect}
            className={cn(
              cell,
              // apex-lift (src/styles/delight.css) owns the tile's motion: a 1px lift for a real pointer,
              // scale(0.98) on press, and the background and border colour transitions, so there is no
              // second transition utility to disagree with it.
              "apex-lift hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
              t.active && TONE_CLASS[tone].activeTile,
            )}
          >
            {body}
          </button>
        ) : (
          <div key={t.label} title={t.definition} className={cell}>
            {body}
          </div>
        );
      })}
    </section>
  );
}
