import { scoreboardWindow } from "@/lib/scoreboardPeriod";

export const RECOGNITION_MILESTONES = {
  bronze: "single_day_bronze",
  gold: "single_day",
  platinum: "single_day_platinum",
  weekly: "weekly",
  monthly: "monthly",
} as const;

export interface PlaqueCandidate {
  agentId: string;
  agentName: string;
  achievement: keyof typeof RECOGNITION_MILESTONES;
  amount: number;
  period: string;
  periodLabel: string;
}

export interface RecognitionProductionRow {
  agent_id: string;
  name: string;
  ap: number;
  external?: boolean;
}

export interface RecognitionAward {
  agent_id: string;
  milestone_type: string;
  milestone_date: string;
  email_sent_at: string | null;
  email_delivery_status: string | null;
}

export function recognitionWindows(today: string) {
  return {
    day: scoreboardWindow("day", today),
    week: scoreboardWindow("week", today),
    month: scoreboardWindow("month", today),
  };
}

export function readRecognitionProduction(value: unknown): RecognitionProductionRow[] {
  const rows = (value as { by_agent?: unknown } | null)?.by_agent;
  if (!Array.isArray(rows)) throw new Error("Recognition production is unavailable. Retry to load the book.");
  return rows.filter((row): row is RecognitionProductionRow => {
    if (row.external === true) return false;
    if (typeof row.agent_id !== "string" || !row.agent_id || typeof row.name !== "string"
      || !row.name.trim() || typeof row.ap !== "number" || !Number.isFinite(row.ap)) {
      throw new Error("Recognition production contains an incomplete agent record.");
    }
    return true;
  });
}

/** All periods come from the same scoped, canonical posted-production book. */
export function buildRecognitionCandidates(
  today: string,
  production: Record<"day" | "week" | "month", RecognitionProductionRow[]>,
  awards: RecognitionAward[],
): PlaqueCandidate[] {
  const windows = recognitionWindows(today);
  const delivered = new Set(awards.filter((award) => award.email_sent_at || award.email_delivery_status === "sent")
    .map((award) => {
      const period = award.milestone_type === "weekly" ? "week" : award.milestone_type === "monthly" ? "month" : "day";
      const date = scoreboardWindow(period, award.milestone_date).start;
      return `${award.agent_id}:${award.milestone_type}:${date}`;
    }));
  const candidates: PlaqueCandidate[] = [];
  for (const period of ["day", "week", "month"] as const) {
    for (const row of production[period]) {
      if (row.external || !Number.isFinite(row.ap)) continue;
      const achievement = period === "week" ? (row.ap >= 10000 ? "weekly" : null)
        : period === "month" ? (row.ap >= 25000 ? "monthly" : null)
        : row.ap >= 5000 ? "platinum" : row.ap >= 3000 ? "gold" : row.ap >= 1000 ? "bronze" : null;
      if (!achievement) continue;
      const date = windows[period].start;
      if (delivered.has(`${row.agent_id}:${RECOGNITION_MILESTONES[achievement]}:${date}`)) continue;
      candidates.push({
        agentId: row.agent_id, agentName: row.name, achievement,
        amount: row.ap, period: date, periodLabel: windows[period].label,
      });
    }
  }
  return candidates.sort((a, b) => b.amount - a.amount);
}

/** A generated image is not evidence that an email left the provider. */
export function assertRecognitionSent(value: unknown): void {
  const result = value as { success?: boolean; email_status?: string; error?: string } | null;
  if (result?.success !== true || !["sent", "already_sent"].includes(result.email_status ?? "")) {
    throw new Error(result?.error || "Plaque delivery was not confirmed. Check the email delivery log before retrying.");
  }
}
