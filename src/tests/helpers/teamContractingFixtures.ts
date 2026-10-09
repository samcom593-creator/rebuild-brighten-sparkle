import type { Milestone, TeamContractingStatus, TeamPerson } from "@/lib/teamContracting";
import type { RosterRow } from "@/lib/teamRoster";

/** Synthetic records only. Nothing here is a real person. */
export const ms = (key: string, state: Milestone["state"], o: Partial<Milestone> = {}): Milestone => ({
  key, label: key === "first_contract" ? "First contract" : key === "agentlink" ? "AgentLink" : key[0].toUpperCase() + key.slice(1), state,
  done: state === "done", checked_at: state === "done" ? "2026-10-08T15:00:00Z" : null, checked_by_name: state === "done" ? "Test Staffer" : null,
  days_late: null, days_until_overdue: null, amber_day: 3, deadline_day: 3, red_day: 4, ...o,
});

export const person = (o: Partial<TeamPerson> = {}): TeamPerson => ({
  agent_id: "a1", alias_ids: [], display_name: "Ann Lee", manager_id: "m1", manager_name: "Mia Manager", license_status: "licensed", eligibility: "eligible",
  needs_review: false, license_review: false, review_reason: null,
  start: { date: "2026-10-01", validity: "ok", elapsed_days: 6 },
  milestones: [ms("aflac", "overdue", { days_late: 3 }), ms("ethos", "not_due_yet"), ms("first_contract", "overdue", { days_late: 1 }), ms("agentlink", "done")],
  p1: true, p1_rank: 1, due_soon: false, max_days_late: 3, overdue_keys: ["aflac", "first_contract"], due_soon_keys: [], overdue_labels: "Aflac and First contract",
  followup: { last_at: null, last_outcome: null, call_count: 0, next_on: null, next_action: null, waiting_on: null, blocker: null, due_now: true },
  owner: { user_id: null, name: "Mia Manager", source: "manager" },
  ...o,
});

export const status = (people: TeamPerson[], o: Partial<TeamContractingStatus> = {}): TeamContractingStatus => ({
  ok: true, as_of: "2026-10-09", timezone: "America/Phoenix",
  basis: { key: "hired_or_licensed", label: "Day hired, or the day they got licensed if later", confirmed: true, confirmed_at: "2026-10-09T01:00:00Z", window_days: 60 },
  policy: {
    aflac: { label: "Aflac", amber_day: 3, deadline_day: 3, red_day: 4 },
    ethos: { label: "Ethos", amber_day: 3, deadline_day: 3, red_day: 4 },
    first_contract: { label: "First contract", amber_day: 4, deadline_day: 4, red_day: 5 },
    agentlink: { label: "AgentLink", amber_day: 4, deadline_day: 4, red_day: 5 },
  },
  checkoff_events_ever: 3,
  counts: { p1_people: people.filter((p) => p.p1).length, due_soon_people: 0, eligible_people: people.length, timing_review_people: 0, license_review_people: 0, followup_due_people: 0, total_people: people.length },
  people, ...o,
});

export const rosterRow = (o: Partial<RosterRow> = {}): RosterRow => ({
  agent_id: "a1", full_name: "Ann Lee", email: "ann@example.test", phone: "+15555550101", avatar_url: null, agent_code: "AL1", status: "active",
  is_deactivated: false, is_inactive: false, is_sync_only: false, license_status: "licensed", license_progress: "licensed", onboarding_stage: "live", training_stage: null,
  manager_id: "m1", manager_name: "Mia Manager", downline_count: 0, contracts_total: 0, contracts_active: 0, mtd_alp: 0, mtd_deals: 0, today_alp: 0, today_deals: 0,
  selling_streak_days: 0, free_leads_qualified: false, free_leads_reason: null, free_leads_needed_for_qual: null, l30_alp: 0, l30_deals: 0, lifetime_alp: 0, lifetime_deals: 0,
  first_posted_date: null, last_posted_date: null, last_contacted_at: null, created_at: "2026-10-01T00:00:00Z", tenure_days: 8, ...o,
});

/** A fake of the object useTeamContracting returns, enough for the components that read it. */
export const fakeQuery = (o: Record<string, unknown>) => ({
  isLoading: false, isError: false, isFetching: false, data: undefined, refetch: () => Promise.resolve(undefined), queryKey: ["team-contracting", "test"],
  byAgent: new Map<string, TeamPerson>(), ...o,
}) as never;
