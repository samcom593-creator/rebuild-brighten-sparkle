export type ScoreboardPeriod = "day" | "yesterday" | "week" | "past_week" | "past_30" | "month" | "last_month" | "year" | "custom";

const fromIso = (value: string) => new Date(`${value}T12:00:00Z`);
const addDays = (value: string, amount: number) => {
  const date = fromIso(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

const KEY_RX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Calendar windows anchored to the producer's selected business date. `end` is exclusive.
 * "custom" (MP-302) runs from `customStart` through the through-date; a missing, malformed or
 * later start falls back to the single through-date, never to an open-ended window.
 */
export function scoreboardWindow(period: ScoreboardPeriod, throughDate: string, customStart?: string | null) {
  const through = fromIso(throughDate);
  let start = throughDate;

  // Since the Day window rolls over at midnight (PL-BOOK-ROW-WORK-REVIEW), the
  // morning read of "what did we do yesterday" needs one tap, not the date picker:
  // the single business day before the through-date.
  if (period === "yesterday") {
    const y = addDays(throughDate, -1);
    return {
      start: y,
      end: throughDate,
      label: fromIso(y).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }),
    };
  }

  if (period === "week") {
    const day = through.getUTCDay();
    start = addDays(throughDate, -(day === 0 ? 6 : day - 1));
  } else if (period === "past_week") {
    start = addDays(throughDate, -6);
  } else if (period === "past_30") {
    start = addDays(throughDate, -29);
  } else if (period === "custom") {
    start = customStart && KEY_RX.test(customStart) && customStart <= throughDate ? customStart : throughDate;
  } else if (period === "month") {
    start = `${throughDate.slice(0, 7)}-01`;
  } else if (period === "year") {
    start = `${throughDate.slice(0, 4)}-01-01`;
  }

  // MP-372: "Last month" is the whole previous calendar month, independent of
  // the through-date's day. On the 1st/2nd of a month the book has nothing
  // posted yet, so every to-date window honestly reads $0 — this is the one
  // window that still shows the team's most recent full month of production.
  if (period === "last_month") {
    const firstOfThisMonth = `${throughDate.slice(0, 7)}-01`;
    const lastOfPrevMonth = addDays(firstOfThisMonth, -1);
    const prevStart = `${lastOfPrevMonth.slice(0, 7)}-01`;
    const fmt = (v: string) => fromIso(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    return { start: prevStart, end: firstOfThisMonth, label: `${fmt(prevStart)} – ${fmt(lastOfPrevMonth)}` };
  }

  const end = addDays(throughDate, 1);
  const label = period === "day" || start === throughDate
    ? through.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : `${fromIso(start).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} – ${through.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;

  return { start, end, label };
}

/** The last business day inside a window (its `end` is exclusive). */
export function windowLastDay(win: { end: string }): string {
  return addDays(win.end, -1);
}

/** Every period a link may carry. */
export const SCOREBOARD_PERIODS: readonly ScoreboardPeriod[] = [
  "day", "yesterday", "week", "past_week", "past_30", "month", "last_month", "year", "custom",
];

export function isScoreboardPeriod(value: unknown): value is ScoreboardPeriod {
  return typeof value === "string" && (SCOREBOARD_PERIODS as readonly string[]).includes(value);
}

export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && KEY_RX.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`));
}
