/**
 * My Team contracting follow-up: the client half of ONE shared calculation.
 *
 * Everything that decides urgency lives in the database (team_contracting_status): the clock rule, the thresholds,
 * the eligibility rules, the state of every milestone, who is Priority 1 and in what order. This file fetches that one
 * payload and presents it. It contains no threshold, no day arithmetic and no eligibility rule, so the urgent section,
 * the roster badges, the filters, the counts and the expanded detail cannot disagree.
 *
 * Three failure modes are handled on purpose:
 *   - a failed or refused read is an ERROR STATE ("Contracting status unavailable"), never an empty list and never
 *     red flags built from missing data;
 *   - a clock rule that has not been confirmed arrives as `basis.confirmed = false`, and the UI shows no urgency;
 *   - a milestone write is guarded per person and per milestone, uses compare-and-set, and always re-reads the truth.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { phoenixDateKey } from "@/lib/contentWeek";

export type MilestoneKey = string;
export type MilestoneState =
  | "done" | "not_applicable" | "policy_pending" | "not_tracked" | "unknown" | "not_due_yet" | "due_soon" | "overdue";

export type Milestone = {
  key: MilestoneKey;
  label: string;
  state: MilestoneState;
  done: boolean;
  checked_at: string | null;
  checked_by_name: string | null;
  days_late: number | null;
  days_until_overdue: number | null;
  amber_day: number;
  deadline_day: number;
  red_day: number;
};

export type Followup = {
  last_at: string | null;
  last_outcome: string | null;
  call_count: number;
  next_on: string | null;
  next_action: string | null;
  waiting_on: string | null;
  blocker: string | null;
  /** True when no follow-up date is set or it is today or earlier. A future date is not "due". */
  due_now: boolean;
};

export type TeamPerson = {
  agent_id: string;
  alias_ids: string[];
  display_name: string;
  manager_id: string | null;
  manager_name: string | null;
  license_status: string | null;
  eligibility: "eligible" | "license_conflict" | "license_unknown";
  needs_review: boolean;
  license_review: boolean;
  review_reason: string | null;
  start: { date: string | null; validity: "ok" | "missing" | "future" | "invalid" | "policy_pending"; elapsed_days: number | null };
  milestones: Milestone[];
  p1: boolean;
  p1_rank: number | null;
  due_soon: boolean;
  max_days_late: number;
  overdue_keys: MilestoneKey[];
  due_soon_keys: MilestoneKey[];
  overdue_labels: string | null;
  followup: Followup;
  owner: { user_id: string | null; name: string; source: "follow_up_owner" | "manager" | "unassigned" };
};

export type TeamContractingStatus = {
  ok: true;
  as_of: string;
  timezone: string;
  basis: { key: string; label: string; confirmed: boolean; confirmed_at: string | null; window_days: number };
  policy: Record<string, { label: string; amber_day: number; deadline_day: number; red_day: number }>;
  checkoff_events_ever: number;
  counts: {
    p1_people: number;
    due_soon_people: number;
    eligible_people: number;
    timing_review_people: number;
    license_review_people: number;
    followup_due_people: number;
    total_people: number;
  };
  people: TeamPerson[];
};

export const TEAM_CONTRACTING_KEY = (userId: string | undefined) => ["team-contracting", userId ?? "anon"] as const;

// ── pure helpers (unit tested) ──────────────────────────────────────────────────────────────────────────────

export type ContractingFilter = "all" | "p1" | "due_soon" | "eligible" | "timing_review";

export const CONTRACTING_FILTERS: { key: ContractingFilter; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "p1", label: "Priority 1" },
  { key: "due_soon", label: "Due soon" },
  { key: "eligible", label: "All eligible people" },
  { key: "timing_review", label: "Timing needs review" },
];

/** Lookup by ANY id a roster row may carry: the canonical id or a duplicate twin's id. */
export function indexPeople(people: TeamPerson[]): Map<string, TeamPerson> {
  const m = new Map<string, TeamPerson>();
  for (const p of people) {
    m.set(p.agent_id, p);
    for (const a of p.alias_ids) m.set(a, p);
  }
  return m;
}

/** Does this person pass the contracting filter, optionally narrowed to one milestone? */
export function matchesContractingFilter(p: TeamPerson, f: ContractingFilter, milestone: MilestoneKey | "all" = "all"): boolean {
  const states = (m: Milestone[]) => (milestone === "all" ? m : m.filter((x) => x.key === milestone));
  switch (f) {
    case "all": return true;
    case "p1": return states(p.milestones).some((m) => m.state === "overdue");
    case "due_soon": return states(p.milestones).some((m) => m.state === "due_soon");
    case "eligible": return p.eligibility === "eligible";
    case "timing_review": return p.needs_review;
  }
}

/** Priority 1 people in the order the server ranked them. */
export function priorityOne(people: TeamPerson[]): TeamPerson[] {
  return people.filter((p) => p.p1).sort((a, b) => (a.p1_rank ?? 1e9) - (b.p1_rank ?? 1e9));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Aflac and Ethos overdue — 6 days since hired" (the clock source comes from the server's own label). */
export function reasonSentence(p: TeamPerson, basisShort: string): string {
  const late = p.max_days_late;
  const elapsed = p.start.elapsed_days;
  const parts = [`${p.overdue_labels ?? "Contracting"} overdue`];
  if (elapsed != null) parts.push(`${plural(elapsed, "day")} since ${basisShort}`);
  if (late > 0) parts.push(`${plural(late, "day")} past the deadline`);
  return parts.join(" · ");
}

/** Short wording for "day 0", used beside the elapsed days. */
export function basisShortLabel(key: string): string {
  switch (key) {
    case "hired": return "hired";
    case "hired_or_licensed": return "hired or licensed";
    case "expected_start": return "expected start";
    case "contracting_request": return "contracting request";
    default: return "start";
  }
}

export type NextAction = { kind: "call" | "open_profile" | "review_blocker"; label: string };

/** One obvious next action. A missing phone number never produces a dead Call button. */
export function nextActionFor(p: TeamPerson, hasPhone: boolean): NextAction {
  if (p.followup.blocker && p.followup.blocker !== "none" && p.followup.waiting_on && p.followup.waiting_on !== "agent") {
    return { kind: "review_blocker", label: "Review blocker" };
  }
  if (hasPhone) return { kind: "call", label: "Call" };
  return { kind: "open_profile", label: "Open profile" };
}

export const WAITING_ON_LABEL: Record<string, string> = { agent: "Waiting on the agent", staff: "Waiting on staff", carrier: "Waiting on the carrier", upline: "Waiting on the upline" };
export const BLOCKER_LABEL: Record<string, string> = {
  none: "No blocker", login_access: "Login or access", wrong_agency: "Wrong agency", missing_documents: "Missing documents",
  missing_comp_upline: "Missing comp or upline", release_required: "Release required", existing_carrier_relationship: "Existing carrier relationship",
  upline_approval: "Upline approval", carrier_issue: "Carrier issue",
};
export const OUTCOME_LABEL: Record<string, string> = { talked: "Talked", no_answer: "No answer", voicemail: "Voicemail", texted: "Texted", wrong_number: "Wrong number" };

export function msUntilNextPhoenixMidnight(now: Date = new Date()): number {
  const key = phoenixDateKey(now);
  const [y, m, d] = key.split("-").map(Number);
  // Phoenix never observes daylight saving time, so its midnight is a fixed UTC-7 offset.
  const nextMidnightUtc = Date.UTC(y, m - 1, d + 1, 7, 0, 0);
  return Math.max(1000, nextMidnightUtc - now.getTime());
}

// ── the one read ────────────────────────────────────────────────────────────────────────────────────────────

export function useTeamContracting(enabled = true) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = TEAM_CONTRACTING_KEY(user?.id);
  const query = useQuery({
    queryKey: key,
    enabled: enabled && Boolean(user?.id),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: async (): Promise<TeamContractingStatus> => {
      const { data, error } = await supabase.rpc("team_contracting_status");
      if (error) throw new Error(error.message);
      const payload = data as unknown as TeamContractingStatus | null;
      if (!payload || payload.ok !== true || !Array.isArray(payload.people)) throw new Error("Unexpected response from team_contracting_status");
      return payload;
    },
  });

  // Date-based urgency changes when the Phoenix date changes, not only when something is edited. Re-read at Phoenix
  // midnight and whenever the tab becomes active on a different date than the data was computed for.
  const asOf = query.data?.as_of;
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setTimeout(() => { void qc.invalidateQueries({ queryKey: key }); }, msUntilNextPhoenixMidnight());
    const onVisible = () => {
      if (document.visibilityState === "visible" && asOf && asOf !== phoenixDateKey()) void qc.invalidateQueries({ queryKey: key });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
    // key is derived from user id and is stable per render for a given user
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, asOf, user?.id, qc]);

  const people = query.data?.people;
  const byAgent = useMemo(() => indexPeople(people ?? []), [people]);
  return { ...query, byAgent, queryKey: key };
}

// ── writes ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Tick or untick one milestone. A second tap on the same milestone while the first is in flight is ignored (the
 * ref is checked synchronously, so two taps in the same tick cannot both pass). The write sends what the screen
 * believes the current state is; if another session changed it, the server answers with the truth instead of
 * writing. Whatever happens, the next thing done is a re-read, so the screen always ends on the stored state.
 */
export function useCheckoffToggle(queryKey: readonly unknown[]) {
  const qc = useQueryClient();
  const inFlight = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  const toggle = useCallback(async (agentId: string, milestone: string, currentlyDone: boolean, name: string) => {
    const k = `${agentId}:${milestone}`;
    if (inFlight.current.has(k)) return;
    inFlight.current.add(k);
    setPending(new Set(inFlight.current));
    try {
      const { data, error } = await supabase.rpc("set_contract_checkoff", {
        p_agent_id: agentId, p_contract_key: milestone, p_checked: !currentlyDone, p_expected: currentlyDone,
      });
      const res = data as unknown as { ok?: boolean; conflict?: boolean } | null;
      if (error) toast.error(`Couldn't save ${milestone.replace("_", " ")} for ${name}: ${error.message.slice(0, 120)}`);
      else if (res?.conflict) toast.message(`${name}'s checklist was just changed somewhere else. Showing the saved state.`);
      else if (!res?.ok) toast.error(`Couldn't save ${milestone.replace("_", " ")} for ${name}.`);
    } finally {
      inFlight.current.delete(k);
      setPending(new Set(inFlight.current));
      await qc.invalidateQueries({ queryKey });
    }
  }, [qc, queryKey]);

  return { toggle, isPending: (agentId: string, milestone: string) => pending.has(`${agentId}:${milestone}`) };
}

export type FollowupPatch = Partial<{
  follow_up_on: string | null; next_action: string | null; owner_user_id: string | null; waiting_on: string | null; blocker: string | null;
}>;

export async function saveFollowup(agentId: string, patch: FollowupPatch): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("set_contracting_followup", { p_agent_id: agentId, p_patch: patch });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Records that a contact ACTUALLY happened, with its outcome. Opening a phone link records nothing. */
export async function logContactOutcome(agentId: string, outcome: keyof typeof OUTCOME_LABEL): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("set_contracting_checkin" as never, {
    p_checkin_id: null, p_agent_id: agentId, p_step: "call", p_done: true, p_note: outcome,
  } as never);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function confirmClockBasis(basis: string, windowDays?: number): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("set_contracting_followup_config", { p_basis: basis, ...(windowDays ? { p_window_days: windowDays } : {}) });
  return error ? { ok: false, error: error.message } : { ok: true };
}
