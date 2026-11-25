import { describe, expect, it } from "vitest";
import type { GoalScorecard } from "@/components/dashboard/GoalTrackerCard";
import { applyManagerGoalDemo, applyTarget20kDemo, managerGoalDemoFields, target20kDemoFields, type ManagerGoalDemoBoard, type ManagerGoalDemoRow, type Target20kDemoRow } from "@/lib/goalDemoModels";

function manager(id = "manager-a", patch: Partial<GoalScorecard> = {}): GoalScorecard {
  return {
    agent_id: id, name: "Demo manager", has_goal: true, period_label: "November 2026", upcoming: false, ended: false,
    own_pct: 60, days_remaining: 15, frac: 0.5, biz_days_remaining: 10,
    personal_ap_actual: 4000, team_ap_actual: 8000, team_deals_actual: 4, team_members: 8, recruit_actual: 1,
    team_ap_goal: 20000, recruit_goal: 4, projected_mgr_income: 12000, projected_total_income: 12000, projected_sam_override: 4000,
    pace_pct: 80, needed_per_day: 1200, projected_eom: 16000, status: "behind", avg_deal_size: 2000,
    deals_to_goal: 10, deals_remaining: 6, deals_per_week: 3, deals_per_day: 0.6, ap_per_day: 1200, recruits_needed: 3, ap_per_recruit: 5000,
    ...patch,
  };
}
function board() {
  return {
    period_label: "November 2026", period_start: "2026-11-01", period_end: "2026-11-30", saved_record_id: "unchanged-record",
    managers: [manager(), manager("manager-b", { team_ap_goal: 10000, team_ap_actual: 2000, projected_mgr_income: 6000, projected_total_income: 6000, projected_sam_override: 2000 })],
    total_team_goal: 30000, total_team_actual: 10000, total_projected_sam_override: 6000, total_projected_mgr_income: 18000,
  };
}
function target(id = "agent-a", patch: Partial<Target20kDemoRow> = {}): Target20kDemoRow {
  return { agent_id: id, name: "Demo producer", license_status: "licensed", hired: "2026-01-01", deals_mtd: 4, ap_mtd: 8000, deals_no_policy_mtd: 1, ap_at_risk_mtd: 2000, ap_to_20k: 12000, projected_eom_ap: 16000, pace_verdict: "below_pace", ...patch };
}
const managerKey = (field: string, id = "manager-a") => `manager:${id}:${field}`;
const targetKey = (field: string, id = "agent-a") => `target20k:${id}:${field}`;
const fieldValues = (fields: Array<{ key: string; value: number }>) => Object.fromEntries(fields.map((field) => [field.key, field.value]));

describe("manager goal demo adapters", () => {
  it("uses stable agent IDs and offers only existing finite editable numbers", () => {
    const data: ManagerGoalDemoBoard = { ...board(), managers: [
      { ...manager(), projected_sam_override: null, projected_total_income: Infinity, team_members: NaN },
      { ...manager(null), unmatched: true, name: "Unmatched" },
    ] };
    const fields = managerGoalDemoFields(data);
    expect(fields.map((field) => field.key)).toContain(managerKey("team_ap_actual"));
    expect(fields.map((field) => field.key)).not.toContain(managerKey("projected_sam_override"));
    expect(fields.map((field) => field.key)).not.toContain(managerKey("projected_total_income"));
    expect(fields.map((field) => field.key)).not.toContain(managerKey("team_members"));
    expect(fields.every((field) => Number.isFinite(field.value) && field.min === 0)).toBe(true);
    expect(fields.some((field) => /period|days|frac|status|own_pct|pace_pct/.test(field.key))).toBe(false);
    const reordered = managerGoalDemoFields({ ...board(), managers: [...board().managers].reverse() });
    expect(new Set(reordered.map((field) => field.key))).toEqual(new Set(managerGoalDemoFields(board()).map((field) => field.key)));
  });

  it("updates goal progress, plan, estimates and board totals together without mutating the query result", () => {
    const data = board();
    const snapshot = structuredClone(data);
    Object.freeze(data.managers[0]); Object.freeze(data.managers[1]); Object.freeze(data.managers); Object.freeze(data);
    const values = { ...fieldValues(managerGoalDemoFields(data)), [managerKey("team_ap_goal")]: 40000, [managerKey("team_ap_actual")]: 12000, [managerKey("avg_deal_size")]: 4000, [managerKey("recruit_goal")]: 6, [managerKey("recruit_actual")]: 2 };
    const next = applyManagerGoalDemo(data, values);
    const row: GoalScorecard = next.managers[0]; // preserves the caller's concrete model
    expect(row).toMatchObject({ team_ap_goal: 40000, team_ap_actual: 12000, pace_pct: 60, status: "behind", projected_eom: 24000,
      deals_to_goal: 10, deals_remaining: 7, deals_per_day: 0.7, deals_per_week: 3.5, ap_per_day: 2800, needed_per_day: 2800,
      recruits_needed: 4, ap_per_recruit: 6667, projected_mgr_income: 24000, projected_total_income: 24000, projected_sam_override: 8000 });
    expect(row.team_ap_actual / row.team_ap_goal).toBe(0.3);
    expect(next).toMatchObject({ total_team_goal: 50000, total_team_actual: 14000, total_projected_sam_override: 10000, total_projected_mgr_income: 30000 });
    expect(next.total_team_actual).toBe(next.managers.reduce((sum, item) => sum + item.team_ap_actual, 0));
    expect(next.period_start).toBe(snapshot.period_start);
    expect(next.period_end).toBe(snapshot.period_end);
    expect(next.saved_record_id).toBe(snapshot.saved_record_id);
    expect(row.agent_id).toBe(snapshot.managers[0].agent_id);
    expect(row.name).toBe(snapshot.managers[0].name);
    expect(row.frac).toBe(snapshot.managers[0].frac);
    expect(row.biz_days_remaining).toBe(snapshot.managers[0].biz_days_remaining);
    expect(data).toEqual(snapshot);
    expect(next).not.toBe(data);
  });

  it("uses the server's status thresholds and keeps upcoming/ended period facts", () => {
    const data = board();
    expect(applyManagerGoalDemo(data, { [managerKey("team_ap_actual")]: 9500 }).managers[0].status).toBe("on_track");
    expect(applyManagerGoalDemo(data, { [managerKey("team_ap_actual")]: 11000 }).managers[0].status).toBe("ahead");
    const ended = { ...data, managers: [{ ...manager(), ended: true, status: "missed" as const }] };
    expect(applyManagerGoalDemo(ended, { [managerKey("team_ap_actual")]: 25000 }).managers[0]).toMatchObject({ status: "hit", ended: true });
    const upcoming = { ...data, managers: [{ ...manager(), upcoming: true, status: "upcoming" as const, pace_pct: null, projected_eom: null }] };
    expect(applyManagerGoalDemo(upcoming, { [managerKey("team_ap_actual")]: 25000 }).managers[0]).toMatchObject({ status: "upcoming", upcoming: true, pace_pct: null, projected_eom: null });
  });

  it("does not replace a custom income goal, and explicit estimate edits win over goal scaling", () => {
    const data = { ...board(), managers: [manager("manager-a", { projected_total_income: 75000 })] };
    const next = applyManagerGoalDemo(data, { ...fieldValues(managerGoalDemoFields(data)), [managerKey("team_ap_goal")]: 40000, [managerKey("projected_sam_override")]: 9000 });
    expect(next.managers[0]).toMatchObject({ projected_mgr_income: 24000, projected_total_income: 75000, projected_sam_override: 9000 });
    expect(next.total_projected_mgr_income).toBe(75000);
    expect(next.total_projected_sam_override).toBe(9000);
    const edited = applyManagerGoalDemo(data, { [managerKey("team_ap_goal")]: 40000, [managerKey("projected_total_income")]: 100000 });
    expect(edited.total_projected_mgr_income).toBe(100000);
  });

  it("preserves null/redacted outputs and adjusts a known aggregate by only the known row delta", () => {
    const managers: ManagerGoalDemoRow[] = [
      { ...manager(), pace_pct: null, deals_per_day: null, projected_sam_override: null },
      { ...manager("manager-b"), team_ap_actual: null },
    ];
    const data: ManagerGoalDemoBoard = { ...board(), managers, total_team_actual: 50000, total_projected_sam_override: null };
    const next = applyManagerGoalDemo(data, { [managerKey("team_ap_actual")]: 12000, [managerKey("projected_sam_override")]: 999999 });
    expect(next.managers[0]).toMatchObject({ pace_pct: null, deals_per_day: null, projected_sam_override: null });
    expect(next.managers[1].team_ap_actual).toBeNull();
    expect(next.total_projected_sam_override).toBeNull();
    expect(next.total_team_actual).toBe(54000);
  });

  it("keeps unmatched goals in the total without inventing an ID or a manager scorecard", () => {
    const unmatched: ManagerGoalDemoRow = { agent_id: null, name: "Unmatched subject", unmatched: true, status: "unmatched", team_ap_goal: 5000, recruit_goal: 2 };
    const data: ManagerGoalDemoBoard = { ...board(), managers: [manager(), unmatched], total_team_goal: 25000, total_team_actual: 8000, total_projected_mgr_income: 12000, total_projected_sam_override: 4000 };
    const next = applyManagerGoalDemo(data, { [managerKey("team_ap_goal")]: 40000, "manager:Unmatched subject:team_ap_goal": 500000 });
    expect(next.managers[1]).toBe(unmatched);
    expect(next.total_team_goal).toBe(45000);
    expect(next.total_team_actual).toBe(8000);
    expect(next.managers).toHaveLength(2);
  });

  it.each([-1, 1.5, Infinity, NaN, 1_000_000_001])("rejects invalid counts (%s) and retains complete-source identity for no edits", (value) => {
    const data = board();
    expect(applyManagerGoalDemo(data, { [managerKey("team_members")]: value })).toBe(data);
    expect(applyManagerGoalDemo(data, fieldValues(managerGoalDemoFields(data)))).toBe(data);
  });

  it("handles zero goals/divisors without infinity and cannot edit a period or saved identifier", () => {
    const data = board();
    const next = applyManagerGoalDemo(data, { [managerKey("team_ap_goal")]: 0, [managerKey("avg_deal_size")]: 0, [managerKey("days_remaining")]: 999, [managerKey("frac")]: 1 });
    expect(next.managers[0]).toMatchObject({ team_ap_goal: 0, avg_deal_size: 0, pace_pct: null, status: "no_goal", deals_to_goal: null, deals_remaining: null, days_remaining: 15, frac: 0.5 });
    expect(managerGoalDemoFields(null)).toEqual([]);
    expect(managerGoalDemoFields({ ...data, error: "forbidden" })).toEqual([]);
    expect(applyManagerGoalDemo(undefined, {})).toBeUndefined();
    expect(applyManagerGoalDemo(null, {})).toBeNull();
    const denied = { ...data, error: "forbidden" };
    expect(applyManagerGoalDemo(denied, { [managerKey("team_ap_actual")]: 100000 })).toBe(denied);
  });
});

describe("$20K pace demo adapters", () => {
  it("exposes stable finite source values, never the fixed target or identifying/period facts", () => {
    const rows = [target("a"), target("b", { ap_at_risk_mtd: null, deals_no_policy_mtd: NaN })];
    const fields = target20kDemoFields(rows);
    expect(fields.some((field) => field.key.includes("ap_to_20k"))).toBe(false);
    expect(fields.some((field) => /hired|license|name|verdict/.test(field.key))).toBe(false);
    expect(fields.some((field) => field.key === targetKey("ap_at_risk_mtd", "b"))).toBe(false);
    expect(fields.every((field) => Number.isFinite(field.value))).toBe(true);
    expect(new Set(target20kDemoFields([...rows].reverse()).map((field) => field.key))).toEqual(new Set(fields.map((field) => field.key)));
    expect(target20kDemoFields(undefined)).toEqual([]);
  });

  it("changes a row and its gap/verdict/board totals consistently, without altering saved rows", () => {
    const rows = [target("agent-b", { ap_mtd: 15000, projected_eom_ap: 30000, deals_mtd: 10, deals_no_policy_mtd: 0, ap_at_risk_mtd: 0, ap_to_20k: 5000, pace_verdict: "on_pace_20k" }), target()];
    const before = structuredClone(rows);
    rows.forEach(Object.freeze); Object.freeze(rows);
    const next = applyTarget20kDemo(rows, { ...fieldValues(target20kDemoFields(rows)), [targetKey("ap_mtd")]: 25000, [targetKey("deals_mtd")]: 12, [targetKey("deals_no_policy_mtd")]: 6, [targetKey("ap_at_risk_mtd")]: 5000 });
    expect(next[0]).toMatchObject({ agent_id: "agent-a", ap_mtd: 25000, projected_eom_ap: 50000, ap_to_20k: 0, pace_verdict: "hit_20k", deals_mtd: 12, deals_no_policy_mtd: 6, ap_at_risk_mtd: 5000 });
    expect(next.reduce((sum, row) => sum + row.ap_mtd!, 0)).toBe(40000);
    expect(next.reduce((sum, row) => sum + row.deals_mtd!, 0)).toBe(22);
    expect(next.reduce((sum, row) => sum + row.ap_at_risk_mtd!, 0)).toBe(5000);
    expect(next.filter((row) => row.pace_verdict === "hit_20k")).toHaveLength(1);
    expect(next.filter((row) => row.pace_verdict === "on_pace_20k")).toHaveLength(1);
    expect(next[0].hired).toBe(before[1].hired);
    expect(next[0].license_status).toBe(before[1].license_status);
    expect(rows).toEqual(before);
  });

  it("honors an explicit projection, while retaining the $20,000 standard", () => {
    const next = applyTarget20kDemo([target()], { [targetKey("ap_mtd")]: 10000, [targetKey("projected_eom_ap")]: 90000, [targetKey("ap_to_20k")]: 1000000 });
    expect(next[0]).toMatchObject({ projected_eom_ap: 90000, ap_to_20k: 10000, pace_verdict: "on_pace_20k" });
    expect(applyTarget20kDemo([target()], { [targetKey("projected_eom_ap")]: 1000 })[0]).toMatchObject({ projected_eom_ap: 8000, pace_verdict: "below_pace" });
  });

  it("bounds missing-policy counts and risk money by their own totals", () => {
    const next = applyTarget20kDemo([target()], { [targetKey("deals_mtd")]: 2, [targetKey("deals_no_policy_mtd")]: 9, [targetKey("ap_at_risk_mtd")]: 100000 });
    expect(next[0]).toMatchObject({ deals_mtd: 2, deals_no_policy_mtd: 2, ap_at_risk_mtd: 8000 });
    expect(applyTarget20kDemo([target()], { [targetKey("deals_no_policy_mtd")]: 0 })[0].ap_at_risk_mtd).toBe(0);
    expect(applyTarget20kDemo([target()], { [targetKey("ap_mtd")]: 0 })[0]).toMatchObject({ ap_at_risk_mtd: 0, ap_to_20k: 20000, projected_eom_ap: 0, pace_verdict: "zero_mtd" });
  });

  it("preserves unknowns and does not manufacture policies, history, or hire-age facts from money", () => {
    const hidden = target("agent-a", { ap_mtd: null, ap_at_risk_mtd: null, ap_to_20k: null, projected_eom_ap: null, deals_no_policy_mtd: null });
    const next = applyTarget20kDemo([hidden], { [targetKey("ap_mtd")]: 500000, [targetKey("ap_at_risk_mtd")]: 10000, [targetKey("projected_eom_ap")]: 900000, [targetKey("deals_mtd")]: 50 });
    expect(next[0]).toMatchObject({ ap_mtd: null, ap_at_risk_mtd: null, ap_to_20k: null, projected_eom_ap: null, deals_no_policy_mtd: null, deals_mtd: 50 });
    const fresh = target("agent-a", { ap_mtd: 0, projected_eom_ap: 0, deals_mtd: 0, ap_at_risk_mtd: 0, deals_no_policy_mtd: 0, pace_verdict: "new_hire_grace" });
    const boosted = applyTarget20kDemo([fresh], { [targetKey("ap_mtd")]: 500000 });
    expect(boosted[0]).toMatchObject({ ap_mtd: 500000, projected_eom_ap: 500000, deals_mtd: 0, pace_verdict: "hit_20k", hired: fresh.hired });
    const countOnly = applyTarget20kDemo([fresh], { [targetKey("deals_mtd")]: 5 });
    expect(countOnly[0].pace_verdict).toBe("new_hire_grace");
    expect(boosted).toHaveLength(1);
  });

  it.each([-1, 2.5, Infinity, NaN, 1_000_000_001])("ignores invalid count edits (%s) without creating another row", (value) => {
    const row = target();
    const next = applyTarget20kDemo([row], { [targetKey("deals_mtd")]: value });
    expect(next).toHaveLength(1);
    expect(next[0]).toBe(row);
  });

  it("rejects nonfinite or oversized money and rounds accepted money to cents", () => {
    const row = target();
    for (const value of [-1, Infinity, NaN, 1_000_000_000_001]) expect(applyTarget20kDemo([row], { [targetKey("ap_mtd")]: value })[0]).toBe(row);
    expect(applyTarget20kDemo([row], { [targetKey("ap_mtd")]: 10000.126 })[0]).toMatchObject({ ap_mtd: 10000.13, ap_to_20k: 9999.87 });
    const extreme = target("agent-a", { ap_mtd: Number.MIN_VALUE, projected_eom_ap: 1000 });
    expect(Number.isFinite(applyTarget20kDemo([extreme], { [targetKey("ap_mtd")]: 1000000 })[0].projected_eom_ap)).toBe(true);
  });
});
