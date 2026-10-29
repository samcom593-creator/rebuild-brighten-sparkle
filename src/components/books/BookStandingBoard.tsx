import type { ReactNode } from "react";
import { ChevronRight, CircleDashed, Hourglass, ShieldCheck, TriangleAlert, UserX } from "lucide-react";

import { GrowScoreboard, type ScoreTile } from "@/components/recruiting/GrowScoreboard";
import { Button } from "@/components/ui/button";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { BOOK_STANDINGS, STANDING_META, type BookStanding, type StandingSummary } from "@/lib/bookStanding";
import { TONE_CLASS } from "@/lib/tones";
import { cn } from "@/lib/utils";

const ICON: Record<BookStanding, ReactNode> = {
  active: <ShieldCheck />,
  pending: <Hourglass />,
  lapsing: <TriangleAlert />,
  gone: <UserX />,
  unknown: <CircleDashed />,
};

const policies = (n: number) => `${n.toLocaleString()} ${n === 1 ? "policy" : "policies"}`;

/**
 * The top of the Book of Business (OVERHAUL-book, 2026-10-29): who is still on the books and who is
 * not. Four tiles, Active, Pending, Lapsing and Gone, each a button that lists exactly the policies it
 * counts, and one line under them for the policies the carrier has not reported a status for, so the
 * four never pretend to be the whole book. Until the counts arrive every number is a dash; a failed
 * read says so with Try again and never shows zeros.
 */
export function BookStandingBoard({
  summary,
  notice,
  onRetry,
  selected,
  onSelect,
}: {
  /** null while the counts load or after they failed with nothing to show. */
  summary: StandingSummary | null;
  /** Why the counts are missing or old (a failed read), or null when they are current. */
  notice: string | null;
  onRetry: () => void;
  selected: BookStanding | null;
  onSelect: (standing: BookStanding | null) => void;
}) {
  const tiles: ScoreTile[] = BOOK_STANDINGS.map((key) => {
    const meta = STANDING_META[key];
    return {
      label: meta.label,
      value: summary ? summary.byStanding[key] : null,
      hint: meta.hint,
      definition: meta.definition,
      tone: meta.tone,
      icon: ICON[key],
      // Lapsing is the one that needs a call today; its number takes its colour when there is any.
      emphasis: key === "lapsing",
      active: selected === key,
      onSelect: summary ? () => onSelect(selected === key ? null : key) : undefined,
    };
  });

  const unknown = summary ? summary.byStanding.unknown : null;
  const unknownSelected = selected === "unknown";
  const unknownTone = STANDING_META.unknown.tone;

  return (
    <div className="space-y-2">
      <GrowScoreboard
        label="Who is on the books"
        tiles={tiles}
        notice={
          notice ? (
            <>
              <span role="alert">{notice}</span>
              <Button type="button" size="sm" variant="outline" className="h-9 shrink-0" onClick={onRetry}>
                Try again
              </Button>
            </>
          ) : undefined
        }
      />
      {unknown !== null && (unknown > 0 || unknownSelected) ? (
        <button
          type="button"
          aria-pressed={unknownSelected}
          onClick={() => onSelect(unknownSelected ? null : "unknown")}
          title={STANDING_META.unknown.definition}
          className={cn(
            "apex-lift flex w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] sm:px-4",
            unknownSelected && TONE_CLASS[unknownTone].activeTile,
          )}
        >
          {/* The bubble is decoration; on a phone its width is better spent on the words. */}
          <ToneBubble tone={unknownTone} size="sm" className="hidden sm:inline-flex">{ICON.unknown}</ToneBubble>
          <span className="min-w-0 flex-1">
            <span className="block text-balance text-[15px] font-semibold leading-5 text-foreground">
              <span className="tabular-nums">{policies(unknown)}</span> with no status yet
            </span>
            <span className="block text-[13px] leading-[18px] text-muted-foreground">
              Not counted above. The carrier has not reported on them yet.
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-0.5 text-sm font-semibold text-foreground">
            {unknownSelected ? "Showing" : "Show"}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </span>
        </button>
      ) : null}
    </div>
  );
}
