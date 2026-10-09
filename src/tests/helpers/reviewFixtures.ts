import type { ReviewAgent, ReviewCarrier, ReviewProfile } from "@/lib/contractReview";

export const CARRIERS: ReviewCarrier[] = [
  { key: "combine", label: "Combine", position: 1, mapped: false, portal_url: null },
  { key: "aflac", label: "AFLAC", position: 2, mapped: true, portal_url: "https://login.aflac.com/" },
  { key: "gto", label: "GTO", position: 3, mapped: false, portal_url: null },
  { key: "ethos", label: "Ethos", position: 4, mapped: true, portal_url: null },
];

export const emptyProfile = (over: Partial<ReviewProfile> = {}): ReviewProfile => ({
  npn: null, first_name: null, last_name: null, email: null, resident_state: null, state_hint: null, complete: false, ...over,
});

export function agent(over: Partial<ReviewAgent> & { id?: string; marked?: string[] } = {}): ReviewAgent {
  const id = over.id ?? over.agent_id ?? "a1";
  const marked = over.marked ?? [];
  const marks: ReviewAgent["marks"] = {};
  for (const c of CARRIERS) marks[c.key] = marked.includes(c.key) ? { at: "2026-10-08T18:00:00Z", by: "u1", by_name: "Mia Manager" } : null;
  const { marked: _m, id: _i, ...rest } = over;
  return {
    agent_id: id, display_name: `Agent ${id}`, email: `${id}@example.test`, manager_id: null, manager_name: null,
    profile: emptyProfile(), marks, marked_count: marked.length, level: null, ...rest,
  };
}

/** The shape contract_review_roster returns. */
export const rosterPayload = (agents: ReviewAgent[], over: Record<string, unknown> = {}) => ({
  ok: true, version: 1, as_of: "2026-10-09", carriers: CARRIERS,
  counts: {
    agents: agents.length, needs_review: agents.filter((a) => a.marked_count < 4).length, unmarked_all: agents.filter((a) => a.marked_count === 0).length,
    partial: agents.filter((a) => a.marked_count > 0 && a.marked_count < 4).length, all_four: agents.filter((a) => a.marked_count === 4).length,
    level_unset: agents.filter((a) => !a.level).length, intake_incomplete: agents.filter((a) => !a.profile.complete).length,
  },
  agents, ...over,
});

type Call = { name: string; args: Record<string, unknown> };

/**
 * An in-memory stand-in for the database functions. It enforces the same compare-and-set rule as the real ones, so a
 * test that taps a circle exercises the same contract the screen depends on.
 */
export function fakeBackend(initial: ReviewAgent[]) {
  const state = {
    agents: initial.map((a) => ({ ...a, marks: { ...a.marks } })),
    calls: [] as Call[],
    failNext: null as null | { name: string; error?: { message: string }; times?: number },
    gate: null as null | { name: string; promise: Promise<void> },
    rosterError: null as null | string,
    rosterShort: false,
    me: { ok: true, npn: null as string | null, first_name: "Ava", last_name: "Agent", email: "ava@example.test", resident_state: "AZ", saved: false } as Record<string, unknown>,
    profileResult: null as null | Record<string, unknown>,
  };
  const find = (id: unknown) => state.agents.find((a) => a.agent_id === id);
  const count = (a: ReviewAgent) => CARRIERS.filter((c) => a.marks[c.key]).length;

  async function rpc(name: string, args: Record<string, unknown> = {}) {
    state.calls.push({ name, args });
    if (state.gate && state.gate.name === name) await state.gate.promise;
    if (state.failNext && state.failNext.name === name) {
      const f = state.failNext;
      f.times = (f.times ?? 1) - 1;
      if (f.times <= 0) state.failNext = null;
      return { data: null, error: f.error ?? { message: "network down" } };
    }
    switch (name) {
      case "contract_review_roster": {
        if (state.rosterError) return { data: null, error: { message: state.rosterError } };
        const list = state.agents.map((a) => ({ ...a, marked_count: count(a) }));
        const p = rosterPayload(list);
        if (state.rosterShort) p.counts.agents = list.length + 5;
        return { data: p, error: null };
      }
      case "set_contract_review_mark": {
        const a = find(args.p_agent_id);
        if (!a) return { data: null, error: { message: "not found" } };
        const was = !!a.marks[String(args.p_carrier_key)];
        if (args.p_expected !== null && args.p_expected !== undefined && args.p_expected !== was) return { data: { ok: false, conflict: true, confirmed: was, confirmed_at: null }, error: null };
        if (args.p_confirmed && !was) a.marks[String(args.p_carrier_key)] = { at: "2026-10-09T17:00:00Z", by: "me", by_name: "Mia Manager" };
        if (!args.p_confirmed && was) a.marks[String(args.p_carrier_key)] = null;
        a.marked_count = count(a);
        return { data: { ok: true, confirmed: !!args.p_confirmed, changed: was !== !!args.p_confirmed, confirmed_at: args.p_confirmed ? "2026-10-09T17:00:00Z" : null }, error: null };
      }
      case "set_review_placement_level": {
        const a = find(args.p_agent_id);
        if (!a) return { data: null, error: { message: "not found" } };
        const cur = a.level ? a.level.pct : null;
        if (args.p_expect_unset && cur !== null) return { data: { ok: false, conflict: true, pct: cur }, error: null };
        if (args.p_expected !== undefined && args.p_expected !== cur) return { data: { ok: false, conflict: true, pct: cur }, error: null };
        a.level = args.p_pct === null ? null : { pct: Number(args.p_pct), source: "admin_ui", effective_from: null, updated_at: null };
        return { data: { ok: true, pct: args.p_pct, changed: true }, error: null };
      }
      case "save_contract_review_profile": {
        if (state.profileResult) return { data: state.profileResult, error: null };
        const a = find(args.p_agent_id);
        if (!a) return { data: null, error: { message: "not found" } };
        a.profile = { ...a.profile, npn: String(args.p_npn) || null, first_name: String(args.p_first), last_name: String(args.p_last), email: String(args.p_email), resident_state: String(args.p_state), complete: true };
        return { data: { ok: true, agent_id: a.agent_id }, error: null };
      }
      case "contract_review_history":
        return { data: { ok: true, events: [{ id: 1, event_type: "marked", carrier_key: "aflac", detail: {}, acted_at: "2026-10-08T18:00:00Z", acted_by_name: "Mia Manager" }] }, error: null };
      case "get_my_contracting_profile":
        return { data: state.me, error: null };
      case "save_my_contracting_profile":
        if (state.profileResult) return { data: state.profileResult, error: null };
        return { data: { ok: true }, error: null };
      default:
        return { data: null, error: { message: `unexpected rpc ${name}` } };
    }
  }
  return { state, rpc, calls: (name: string) => state.calls.filter((c) => c.name === name) };
}
