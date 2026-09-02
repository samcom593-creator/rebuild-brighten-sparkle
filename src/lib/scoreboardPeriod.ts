export type ScoreboardPeriod = "day" | "week" | "past_week" | "month" | "last_month" | "year";

const fromIso = (value: string) => new Date(`${value}T12:00:00Z`);
const addDays = (value: string, amount: number) => {
  const date = fromIso(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

/** Calendar windows anchored to the producer's selected business date. */
export function scoreboardWindow(period: ScoreboardPeriod, throughDate: string) {
  const through = fromIso(throughDate);
  let start = throughDate;

  if (period === "week") {
    const day = through.getUTCDay();
    start = addDays(throughDate, -(day === 0 ? 6 : day - 1));
  } else if (period === "past_week") {
    start = addDays(throughDate, -6);
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
  const label = period === "day"
    ? through.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : `${fromIso(start).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} – ${through.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;

  return { start, end, label };
}
