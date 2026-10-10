import type { AttendancePerson, PersonFacts } from "@/lib/teamStage";

/** Synthetic records only. Nothing here is a real person. */
export const personFacts = (o: Partial<PersonFacts> & { id?: string } = {}): PersonFacts => {
  const { id, ...rest } = o;
  return { agent_id: id ?? "a1", stage: null, stage_label: null, stage_source: null, schedule_set: false, weekdays: null, next_schedule: null, access: { has_login: false, invitation: "none" }, ...rest };
};
export const attPerson = (o: Partial<AttendancePerson> & { id?: string } = {}): AttendancePerson => {
  const { id, ...rest } = o;
  return { agent_id: id ?? "a1", display_name: `Agent ${id ?? "a1"}`, email: null, stage: null, stage_label: null, expected: "yes", weekdays: [1, 2, 3, 4, 5], status: "unmarked", marked_by_name: null, marked_at: null, note: null, ...rest };
};

/** In-memory stand-in for the stage, work-commitment and attendance functions, with the same compare-and-set rules. */
export function fakeTeamBackend(facts: PersonFacts[], attendance: AttendancePerson[], today = "2026-10-09") {
  const state = {
    facts: facts.map((p) => ({ ...p })), att: attendance.map((p) => ({ ...p })), today,
    calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
    failNext: null as null | { name: string; times?: number },
    readError: null as null | string,
    gate: null as null | { name: string; promise: Promise<void> },
  };
  const summary = () => ({
    total: state.att.length, expected: state.att.filter((p) => p.expected === "yes").length,
    present: state.att.filter((p) => p.status === "present").length, absent: state.att.filter((p) => p.status === "absent").length,
    excused: state.att.filter((p) => p.status === "excused").length, unmarked: state.att.filter((p) => p.expected === "yes" && p.status === "unmarked").length,
    not_scheduled: state.att.filter((p) => p.expected === "no").length, schedule_not_set: state.att.filter((p) => p.expected === "unknown").length,
  });
  async function rpc(name: string, args: Record<string, unknown> = {}) {
    state.calls.push({ name, args });
    if (state.gate && state.gate.name === name) await state.gate.promise;
    if (state.failNext && state.failNext.name === name) {
      state.failNext.times = (state.failNext.times ?? 1) - 1;
      if (state.failNext.times <= 0) state.failNext = null;
      return { data: null, error: { message: "network down" } };
    }
    switch (name) {
      case "team_people_facts":
        if (state.readError) return { data: null, error: { message: state.readError } };
        return { data: { ok: true, as_of: today, people: state.facts, counts: { people: state.facts.length, stage_unset: state.facts.filter((p) => !p.stage).length, schedule_unset: state.facts.filter((p) => !p.schedule_set).length } }, error: null };
      case "set_agent_stage": {
        const p = state.facts.find((x) => x.agent_id === args.p_agent_id); if (!p) return { data: null, error: { message: "not found" } };
        if (args.p_expect_unset && p.stage) return { data: { ok: false, conflict: true, stage: p.stage }, error: null };
        if (args.p_expected !== undefined && args.p_expected !== p.stage) return { data: { ok: false, conflict: true, stage: p.stage }, error: null };
        const changed = p.stage !== args.p_stage; p.stage = args.p_stage as PersonFacts["stage"]; p.stage_source = "staff";
        return { data: { ok: true, stage: p.stage, changed }, error: null };
      }
      case "set_work_commitment": {
        const p = state.facts.find((x) => x.agent_id === args.p_agent_id); if (!p) return { data: null, error: { message: "not found" } };
        const cur = p.schedule_set ? p.weekdays ?? [] : null;
        if (args.p_expect_unset && cur !== null) return { data: { ok: false, conflict: true, weekdays: cur }, error: null };
        if (args.p_expected !== undefined && JSON.stringify(args.p_expected) !== JSON.stringify(cur)) return { data: { ok: false, conflict: true, weekdays: cur }, error: null };
        const days = [...new Set(args.p_weekdays as number[])].sort();
        if (!args.p_effective_from || args.p_effective_from === today) { p.schedule_set = true; p.weekdays = days; }
        else p.next_schedule = { effective_from: String(args.p_effective_from), weekdays: days };
        return { data: { ok: true, weekdays: days, effective_from: args.p_effective_from ?? today, changed: true }, error: null };
      }
      case "team_attendance_day":
        if (state.readError) return { data: null, error: { message: state.readError } };
        return { data: { ok: true, date: args.p_date ?? today, is_today: (args.p_date ?? today) === today, weekday: 5, people: state.att, summary: summary() }, error: null };
      case "set_workday_attendance": {
        const p = state.att.find((x) => x.agent_id === args.p_agent_id); if (!p) return { data: null, error: { message: "not found" } };
        if (args.p_expected !== undefined && args.p_expected !== p.status) return { data: { ok: false, conflict: true, status: p.status }, error: null };
        const changed = p.status !== args.p_status; p.status = args.p_status as AttendancePerson["status"]; p.marked_by_name = p.status === "unmarked" ? null : "Mia Manager"; p.note = (args.p_note as string) ?? null;
        return { data: { ok: true, status: p.status, changed }, error: null };
      }
      case "set_workday_attendance_bulk": {
        let applied = 0, skipped = 0;
        for (const id of args.p_agent_ids as string[]) { const p = state.att.find((x) => x.agent_id === id); if (!p) continue; if (p.status === "unmarked") { p.status = args.p_status as AttendancePerson["status"]; applied += 1; } else skipped += 1; }
        return { data: { ok: true, applied, skipped_already_marked: skipped, denied: 0 }, error: null };
      }
      case "contract_review_roster":
        return { data: { ok: true, version: 1, as_of: today, carriers: [{ key: "combine", label: "Combine", position: 1, mapped: false, portal_url: null }, { key: "aflac", label: "AFLAC", position: 2, mapped: true, portal_url: null }, { key: "gto", label: "GTO", position: 3, mapped: false, portal_url: null }, { key: "ethos", label: "Ethos", position: 4, mapped: true, portal_url: null }], counts: { agents: 0, needs_review: 0, unmarked_all: 0, partial: 0, all_four: 0, level_unset: 0, intake_incomplete: 0 }, agents: [] }, error: null };
      default:
        return { data: null, error: { message: `unexpected rpc ${name}` } };
    }
  }
  return { state, rpc, calls: (n: string) => state.calls.filter((c) => c.name === n) };
}
