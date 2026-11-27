import type { ProducerDay } from "@/lib/producerWorkspace";
import { recognitionWindows } from "@/lib/recognitionQueue";
import { shiftDateKey } from "@/lib/businessClock";

export const TROPHY_LEVELS = [
  { key: "bronze", title: "Bronze", period: "day", threshold: 1000, caption: "$1K in a day", tone: "bronze" },
  { key: "gold", title: "Gold", period: "day", threshold: 3000, caption: "$3K in a day", tone: "gold" },
  { key: "platinum", title: "Platinum", period: "day", threshold: 5000, caption: "$5K in a day", tone: "platinum" },
  { key: "weekly", title: "Diamond Week", period: "week", threshold: 10000, caption: "$10K in a week", tone: "diamond" },
  { key: "monthly", title: "Elite Producer", period: "month", threshold: 25000, caption: "$25K in a month", tone: "elite" },
] as const;

/** Missing calendar rows are unknown evidence, never zero production. */
export function trophyProgression(days: readonly ProducerDay[], today: string) {
  const windows = recognitionWindows(today);
  const byDay = new Map(days.map((day) => [day.day, day]));
  if (byDay.size !== days.length) throw new Error("The trophy timeline contains duplicate dates.");
  const totals: Record<keyof typeof windows, number> = { day: 0, week: 0, month: 0 };
  for (const period of ["day", "week", "month"] as const) {
    for (let date = windows[period].start; date < windows[period].end; date = shiftDateKey(date, 1)) {
      const record = byDay.get(date);
      if (!record || !Number.isFinite(record.production_ap) || record.production_ap < 0) {
        throw new Error("The complete production timeline is needed to verify trophy progress.");
      }
      totals[period] += record.production_ap;
    }
  }
  return TROPHY_LEVELS.map((level) => ({
    ...level, amount: totals[level.period], reached: totals[level.period] >= level.threshold,
    remaining: Math.max(0, level.threshold - totals[level.period]),
    percent: Math.min(100, totals[level.period] / level.threshold * 100),
    window: windows[level.period].label,
  }));
}

export type TrophyProgress = ReturnType<typeof trophyProgression>;
