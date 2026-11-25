import { z } from "zod";

const amount = z.number().finite().nonnegative();
const count = amount.int();
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().datetime({ offset: true });
const weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(7);
export const producerDaySchema = z.object({ day: dateKey, scheduled: z.boolean(), production_ap: amount, deals: count });
export type ProducerDay = z.infer<typeof producerDaySchema>;

export const producerWorkspaceSchema = z.object({
  agent_id: z.string(), today: dateKey, period_start: dateKey, period_end: dateKey,
  as_of: timestamp, timezone: z.literal("America/Phoenix"),
  target_ap: z.number().finite().positive(), target_source: z.string(),
  production_ap: amount, production_deals: count, production_updated_at: timestamp.nullable(),
  selling_days_total: count, selling_days_elapsed: count, selling_days_remaining: count,
  schedule: weekdays,
  next_schedule: z.object({ effective_on: dateKey, selling_days: weekdays }).nullable(),
  activity: z.object({ sample_days: count, sample_calls: count, sample_sold_calls: count,
    sample_policies: count, avg_policy_ap: amount.nullable(), completed_today: count, sold_calls_today: count }),
  carrier: z.object({ covered_policies: count, in_force_month_ap: amount.nullable(), active_90d_policies: count.nullable(),
    updated_at: timestamp.nullable(), oldest_seen_on: dateKey.nullable(), paid_ap: amount.nullable(), paid_reason: z.string() }),
  days: z.array(producerDaySchema),
}).superRefine((d, ctx) => {
  if (d.activity.sample_sold_calls > d.activity.sample_calls) ctx.addIssue({ code: "custom", message: "Call outcomes exceed the source sample." });
  if (d.selling_days_elapsed > d.selling_days_total) ctx.addIssue({ code: "custom", message: "Selling-day counts are inconsistent." });
});
export type ProducerWorkspace = z.infer<typeof producerWorkspaceSchema>;

/** Provider sale dispositions and posted policies are separate, unlinked samples. */
export function producerPace(d: ProducerWorkspace) {
  const remaining = Math.max(0, d.target_ap - d.production_ap);
  const fraction = d.selling_days_total > 0 ? d.selling_days_elapsed / d.selling_days_total : null;
  const targetToday = fraction === null ? null : d.target_ap * fraction;
  const a = d.activity;
  const avg = a.sample_policies >= 3 && a.avg_policy_ap !== null && a.avg_policy_ap > 0 ? a.avg_policy_ap : null;
  const dealsRemaining = remaining === 0 ? 0 : avg === null ? null : Math.ceil(remaining / avg);
  const saleDispositionRate = a.sample_calls > 0 && a.sample_sold_calls <= a.sample_calls
    ? Math.round(a.sample_sold_calls / a.sample_calls * 1000) / 10 : null;
  // A Completed Sale disposition is not evidence of one posted policy. Without
  // call-to-policy links there is no supported required-call calculation.
  const callsRemaining = remaining === 0 ? 0 : null;
  return {
    remaining, targetToday, averagePolicy: avg, dealsRemaining, callsRemaining, saleDispositionRate,
    completionPct: Math.min(100, d.production_ap / d.target_ap * 100),
    apPerSellingDay: d.selling_days_remaining > 0 ? remaining / d.selling_days_remaining : null,
    callsPerSellingDay: callsRemaining === null || d.selling_days_remaining === 0 ? null : Math.ceil(callsRemaining / d.selling_days_remaining),
    status: remaining === 0 ? "Goal hit" : targetToday === null || targetToday === 0 ? "Ready to start"
      : d.production_ap >= targetToday ? "On pace" : "Behind pace",
  };
}

/** Today stays open until midnight; a rest day neither earns nor breaks a streak. */
export function productionStreak(days: readonly ProducerDay[], today: string) {
  const scheduled = days.filter((d) => d.scheduled && d.day <= today).sort((a, b) => a.day.localeCompare(b.day));
  let current = 0;
  for (let i = scheduled.length - 1; i >= 0; i--) {
    const d = scheduled[i];
    if (d.production_ap > 0 && d.deals > 0) current++;
    else if (d.day !== today) break;
  }
  let best = 0;
  let run = 0;
  for (const d of scheduled) {
    run = d.production_ap > 0 && d.deals > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const todayRow = scheduled.find((d) => d.day === today);
  return { current, best, todayScheduled: Boolean(todayRow), todayEarned: Boolean(todayRow && todayRow.production_ap > 0 && todayRow.deals > 0) };
}

export function producerMilestones(production: number, target: number) {
  return [0.25, 0.5, 0.75, 1].map((fraction) => ({ amount: target * fraction, achieved: production >= target * fraction }));
}

export const CALL_CATEGORIES = [
  { value: "uncategorized", label: "Uncategorized" }, { value: "discovery", label: "Discovery" },
  { value: "presentation", label: "Presentation" }, { value: "objection", label: "Objections" },
  { value: "follow_up", label: "Follow-up" }, { value: "sale", label: "Sale" }, { value: "service", label: "Service" },
] as const;
export type ClientCallCategory = (typeof CALL_CATEGORIES)[number]["value"];
export const clientCallsSchema = z.object({
  client_id: z.string(), raw_provider_access: z.boolean(), ambiguous_phone: z.boolean(),
  calls: z.array(z.object({ key: z.string(), source_id: z.string(), source: z.enum(["readymode", "manual"]),
    happened_at: timestamp, category: z.enum(["uncategorized", "discovery", "presentation", "objection", "follow_up", "sale", "service"]),
    outcome: z.string().nullable(), duration_seconds: amount.nullable(), transcript: z.string().nullable(),
    audio_url: z.string().nullable(), transcript_access: z.enum(["available", "restricted", "not_available"]) })),
  next_cursor: z.object({ at: timestamp, key: z.string() }).nullable(),
});
export type ClientCall = z.infer<typeof clientCallsSchema>["calls"][number];
