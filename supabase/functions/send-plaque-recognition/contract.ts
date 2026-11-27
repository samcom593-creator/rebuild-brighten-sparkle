export const PRODUCTION_THRESHOLDS: Record<string, number> = {
  single_day_bronze: 1000, single_day: 3000, single_day_platinum: 5000,
  weekly: 10000, monthly: 25000,
};

export function validPlaqueDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

function shiftDay(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Period keys match the scoreboard: Monday weeks and Phoenix business days. */
export function recognitionPeriod(milestone: string, date: string, today: string) {
  if (!validPlaqueDate(date) || date > today) throw new Error("Choose a valid, non-future business date.");
  let start = date;
  let end = shiftDay(date, 1);
  if (milestone === "weekly") {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    start = shiftDay(date, -(day === 0 ? 6 : day - 1));
    end = shiftDay(start, 7);
  } else if (milestone === "monthly") {
    start = `${date.slice(0, 7)}-01`;
    const next = new Date(`${start}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    end = next.toISOString().slice(0, 10);
  }
  const tomorrow = shiftDay(today, 1);
  return { start, end: end < tomorrow ? end : tomorrow };
}

type ProviderResult = { data?: { id?: string } | null; error?: { message?: string } | null };
export type DeliveryResult = { status: "sent"; providerId: string }
  | { status: "failed" | "unknown"; error: string };

/** A transport exception may follow an accepted send. Never auto-retry it as a known rejection. */
export async function deliverWithReceipt(
  send: () => Promise<ProviderResult>,
  recordSent: (providerId: string) => Promise<void>,
): Promise<DeliveryResult> {
  let response: ProviderResult;
  try {
    response = await send();
  } catch {
    return { status: "unknown", error: "Email acceptance is unknown. Review the provider receipt before retrying." };
  }
  if (response.error) {
    return { status: "failed", error: response.error.message || "The email provider rejected this send." };
  }
  if (!response.data?.id) {
    return { status: "unknown", error: "The email provider returned no acceptance receipt. Review the attempt before retrying." };
  }
  try {
    await recordSent(response.data.id);
  } catch {
    return { status: "unknown", error: "The provider accepted the email, but its delivery record could not be saved. Review the receipt before retrying." };
  }
  return { status: "sent", providerId: response.data.id };
}

/** Missing evidence must not become zero through Number(null), blanks or booleans. */
export function validRecognitionAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function recognitionMetric(milestone: string, amount: number): string {
  if (!validRecognitionAmount(amount)) throw new Error("The recognition amount is unavailable.");
  if (["recruiter_rising", "hiring_champion", "team_builder"].includes(milestone)
    || /^(day_|month_)/.test(milestone)) {
    return `${amount.toLocaleString("en-US")} ${amount === 1 ? "hire" : "hires"}`;
  }
  if (["hot_streak", "on_fire", "unstoppable"].includes(milestone)) {
    return `${amount.toLocaleString("en-US")} ${amount === 1 ? "day" : "days"}`;
  }
  const currency = amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  // check-comeback-milestones records this week's premium minus last week's.
  return milestone === "comeback_champion" ? `+${currency}` : currency;
}
