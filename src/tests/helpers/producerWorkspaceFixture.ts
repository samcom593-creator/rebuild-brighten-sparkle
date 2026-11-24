import type { ProducerWorkspace } from "@/lib/producerWorkspace";

/** Synthetic records only; never a fallback for a live dashboard. */
export function producerWorkspaceFixture(): ProducerWorkspace {
  return {
    agent_id: "producer-a", today: "2026-11-24", period_start: "2026-11-01", period_end: "2026-11-30",
    as_of: "2026-11-24T18:00:00Z", timezone: "America/Phoenix",
    target_ap: 20000, target_source: "agency_standard", production_ap: 5000, production_deals: 4,
    production_updated_at: "2026-11-24T17:00:00Z", selling_days_total: 21, selling_days_elapsed: 17,
    selling_days_remaining: 5, schedule: [1, 2, 3, 4, 5], next_schedule: null,
    activity: { sample_days: 60, sample_calls: 60, sample_sold_calls: 6, sample_policies: 6, avg_policy_ap: 1500, completed_today: 5, sold_calls_today: 0 },
    carrier: { covered_policies: 0, in_force_month_ap: null, active_90d_policies: null, updated_at: null, oldest_seen_on: null, paid_ap: null, paid_reason: "No verified payment receipt is supplied by this view" },
    days: [
      { day: "2026-11-20", scheduled: true, production_ap: 1000, deals: 1 },
      { day: "2026-11-21", scheduled: false, production_ap: 0, deals: 0 },
      { day: "2026-11-22", scheduled: false, production_ap: 0, deals: 0 },
      { day: "2026-11-23", scheduled: true, production_ap: 1500, deals: 1 },
      { day: "2026-11-24", scheduled: true, production_ap: 0, deals: 0 },
    ],
  };
}
