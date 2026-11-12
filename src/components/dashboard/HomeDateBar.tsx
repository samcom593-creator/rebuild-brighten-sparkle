/**
 * HomeDateBar (MP-302, 2026-11-12): the ONE date range on the owner Home.
 *
 * Before this the conversion strip answered for "today" and "the last 7 days" while the
 * production scoreboard beside it answered for whatever its own dropdown said, so two cards
 * on one screen reported two periods. Home now owns one range; this bar is the only place
 * it is chosen, and the strip, the scoreboard and Total IMO by agency all read it.
 *
 * The range lives in the address (?period=&through=&from=), so opening a person and coming
 * back, or sharing the link, keeps the same dates. Days are America/Phoenix business days.
 */
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ScoreboardPeriod } from "@/lib/scoreboardPeriod";

const PRESETS: ReadonlyArray<{ key: ScoreboardPeriod; label: string }> = [
  { key: "day", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "past_week", label: "Last 7 days" },
  { key: "past_30", label: "Last 30 days" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "custom", label: "Custom" },
];

export interface HomeDateBarProps {
  period: ScoreboardPeriod;
  /** The exact dates in words, from scoreboardWindow. */
  label: string;
  todayKey: string;
  throughDate: string;
  customStart: string;
  onPeriodChange: (period: ScoreboardPeriod) => void;
  onCustomChange: (start: string, through: string) => void;
}

export function HomeDateBar({ period, label, todayKey, throughDate, customStart, onPeriodChange, onCustomChange }: HomeDateBarProps) {
  return (
    <section aria-label="Date range for this page" className="rounded-2xl border border-border bg-card px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-foreground">
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate" aria-live="polite">{label}</span>
        </p>
        <p className="text-[13px] text-muted-foreground">Phoenix time · every dated number on this page</p>
      </div>
      {/* One row that scrolls sideways inside itself on a phone; the page never does. */}
      <div role="radiogroup" aria-label="Date range" className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {PRESETS.map((preset) => {
          const selected = preset.key === period;
          return (
            <button
              key={preset.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onPeriodChange(preset.key)}
              className={cn(
                "min-h-11 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      {period === "custom" ? (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-md">
          <label className="text-[13px] font-medium text-muted-foreground">
            From
            <Input
              type="date"
              className="mt-1 h-11"
              max={throughDate}
              value={customStart}
              onChange={(event) => event.target.value && onCustomChange(event.target.value, throughDate)}
            />
          </label>
          <label className="text-[13px] font-medium text-muted-foreground">
            To
            <Input
              type="date"
              className="mt-1 h-11"
              min={customStart}
              max={todayKey}
              value={throughDate}
              onChange={(event) => event.target.value && onCustomChange(customStart, event.target.value)}
            />
          </label>
        </div>
      ) : null}
    </section>
  );
}
