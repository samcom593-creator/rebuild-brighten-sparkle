import type { RosterRow } from "@/lib/teamRoster";

/** Synthetic records only. Nothing here is a real person. */
export const rosterRow = (o: Partial<RosterRow> = {}): RosterRow => ({
  agent_id: "a1", full_name: "Ann Lee", email: "ann@example.test", phone: "+15555550101", avatar_url: null, agent_code: "AL1", status: "active",
  is_deactivated: false, is_inactive: false, is_sync_only: false, license_status: "licensed", license_progress: "licensed", onboarding_stage: "live", training_stage: null,
  manager_id: "m1", manager_name: "Mia Manager", downline_count: 0, contracts_total: 0, contracts_active: 0, mtd_alp: 0, mtd_deals: 0, today_alp: 0, today_deals: 0,
  selling_streak_days: 0, free_leads_qualified: false, free_leads_reason: null, free_leads_needed_for_qual: null, l30_alp: 0, l30_deals: 0, lifetime_alp: 0, lifetime_deals: 0,
  first_posted_date: null, last_posted_date: null, last_contacted_at: null, created_at: "2026-10-01T00:00:00Z", tenure_days: 8, ...o,
});
