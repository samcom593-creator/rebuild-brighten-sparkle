import type { GoalScorecard } from "@/components/dashboard/GoalTrackerCard";
import type { DemoNumberField } from "@/hooks/useDemoNumberFields";

type Values = Readonly<Record<string, number>>;
type NumericGoalKey = { [K in keyof GoalScorecard]: NonNullable<GoalScorecard[K]> extends number ? K : never }[keyof GoalScorecard];
export type ManagerGoalDemoRow = Omit<Partial<GoalScorecard>, NumericGoalKey> & {
  [K in NumericGoalKey]?: number | null;
} & { agent_id: string | null; unmatched?: boolean };
export type ManagerGoalDemoBoard = {
  managers: readonly ManagerGoalDemoRow[];
  total_team_goal: number | null;
  total_team_actual: number | null;
  total_projected_sam_override: number | null;
  total_projected_mgr_income: number | null;
  period_label?: string | null;
  period_start?: string | null;
  error?: string;
};
export type Target20kDemoRow = {
  agent_id: string;
  name: string;
  license_status: string | null;
  hired: string | null;
  deals_mtd: number | null;
  ap_mtd: number | null;
  deals_no_policy_mtd: number | null;
  ap_at_risk_mtd: number | null;
  ap_to_20k: number | null;
  projected_eom_ap: number | null;
  pace_verdict: "hit_20k" | "on_pace_20k" | "below_pace" | "new_hire_grace" | "zero_mtd";
};

const MAX_MONEY = 1_000_000_000_000;
const MAX_COUNT = 1_000_000_000;
const TARGET_20K = 20_000;
const known = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const valid = (value: unknown, count = false): value is number => known(value)
  && value <= (count ? MAX_COUNT : MAX_MONEY) && (!count || Number.isInteger(value));
const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
const hasId = (id: unknown): id is string => typeof id === "string" && id.trim().length > 0;

function field(key: string, label: string, value: unknown, kind: DemoNumberField["kind"]): DemoNumberField[] {
  return valid(value, kind === "count") ? [{ key, label, value, kind, min: 0, max: kind === "count" ? MAX_COUNT : MAX_MONEY }] : [];
}
function edit(values: Values, key: string, source: unknown, count = false): number | undefined {
  const proposed = values[key];
  if (!valid(source, count) || !valid(proposed, count)) return undefined;
  const value = count ? proposed : round(proposed);
  return value !== source ? value : undefined;
}

const MANAGER_FIELDS = [
  ["team_ap_actual", "Team production · AP", "money"],
  ["team_ap_goal", "Team goal · AP", "money"],
  ["team_members", "Team members", "count"],
  ["recruit_actual", "Recruits this period", "count"],
  ["recruit_goal", "Recruit goal", "count"],
  ["avg_deal_size", "Average deal size · plan", "money"],
  ["projected_total_income", "Manager income at goal · estimate", "money"],
  ["projected_sam_override", "Owner override at goal · estimate", "money"],
] as const;

/** Only existing, identified rows and known displayed values are editable. */
export function managerGoalDemoFields(board: ManagerGoalDemoBoard | null | undefined): DemoNumberField[] {
  if (!board || board.error || !Array.isArray(board.managers)) return [];
  return board.managers.flatMap((row) => {
    if (!hasId(row.agent_id) || row.unmatched || row.status === "unmatched") return [];
    const label = row.name?.trim() || "Manager";
    return MANAGER_FIELDS.flatMap(([key, title, kind]) => field(`manager:${row.agent_id}:${key}`, `${label} · ${title}`, row[key], kind));
  });
}

/** Never fill a redacted/null/missing output merely because other fields would let us estimate it. */
function derived(next: ManagerGoalDemoRow, source: ManagerGoalDemoRow, key: NumericGoalKey, value: number | null, places = 2): void {
  if (!known(source[key])) return;
  next[key] = value !== null && known(value) ? round(value, places) : null;
}

function managerRow<T extends ManagerGoalDemoRow>(row: T, values: Values): T {
  if (!hasId(row.agent_id) || row.unmatched || row.status === "unmatched") return row;
  const next = { ...row };
  let changed = false;
  const changedKeys = new Set<string>();
  for (const [key, , kind] of MANAGER_FIELDS) {
    const value = edit(values, `manager:${row.agent_id}:${key}`, row[key], kind === "count");
    if (value === undefined) continue;
    next[key] = value;
    changed = true;
    changedKeys.add(key);
  }
  if (!changed) return row;

  const goal = next.team_ap_goal;
  const actual = next.team_ap_actual;
  // Retain the response's existing contract/trailing-production mix. A
  // separately supplied income goal stays independent of the computed model.
  if (changedKeys.has("team_ap_goal") && known(goal) && known(row.team_ap_goal) && row.team_ap_goal > 0) {
    const ratio = goal / row.team_ap_goal;
    if (known(row.projected_mgr_income)) derived(next, row, "projected_mgr_income", row.projected_mgr_income * ratio);
    if (known(row.projected_sam_override) && !changedKeys.has("projected_sam_override")) derived(next, row, "projected_sam_override", row.projected_sam_override * ratio);
    if (!changedKeys.has("projected_total_income") && known(row.projected_total_income) && row.projected_total_income === row.projected_mgr_income) {
      derived(next, row, "projected_total_income", row.projected_total_income * ratio);
    }
  }

  if (row.has_goal === true && known(goal) && known(actual)) {
    const gap = Math.max(goal - actual, 0);
    const average = next.avg_deal_size;
    const days = row.biz_days_remaining;
    const remaining = known(average) && average > 0 ? Math.ceil(gap / average) : null;
    derived(next, row, "deals_to_goal", known(average) && average > 0 ? Math.ceil(goal / average) : null, 0);
    derived(next, row, "deals_remaining", remaining, 0);
    derived(next, row, "deals_per_day", remaining !== null && known(days) && days > 0 ? remaining / days : null, 1);
    derived(next, row, "deals_per_week", remaining !== null && known(days) && days > 0 ? remaining * 5 / days : null, 1);
    derived(next, row, "ap_per_day", known(days) && days > 0 ? gap / days : null, 0);
    derived(next, row, "needed_per_day", known(days) && days > 0 ? gap / days : null, 0);

    if (row.upcoming === true) next.status = "upcoming";
    else if (row.ended === true) next.status = actual >= goal ? "hit" : "missed";
    else if (row.upcoming === false && row.ended === false && known(row.frac) && row.frac <= 1) {
      const pace = goal > 0 && row.frac > 0 ? round(actual / (goal * row.frac) * 100, 1) : null;
      derived(next, row, "pace_pct", pace, 1);
      derived(next, row, "projected_eom", row.frac > 0 ? actual / row.frac : null);
      next.status = pace === null ? "no_goal" : pace >= 105 ? "ahead" : pace >= 90 ? "on_track" : "behind";
    }
  }
  if (row.has_goal === true && known(next.recruit_goal) && known(next.recruit_actual)) {
    derived(next, row, "recruits_needed", Math.max(next.recruit_goal - next.recruit_actual, 0), 0);
    derived(next, row, "ap_per_recruit", known(goal) && next.recruit_goal > 0 ? goal / next.recruit_goal : null, 0);
  }
  return next;
}

function boardTotal(source: number | null, before: readonly ManagerGoalDemoRow[], after: readonly ManagerGoalDemoRow[], key: NumericGoalKey): number | null {
  if (!known(source)) return source;
  const included = (row: ManagerGoalDemoRow) => key === "team_ap_goal" || !row.unmatched;
  const complete = after.every((row) => !included(row) || known(row[key]));
  const total = complete
    ? after.reduce((sum, row) => sum + (included(row) && known(row[key]) ? row[key] : 0), 0)
    : source + after.reduce((delta, row, index) => {
      const old = before[index][key];
      const value = row[key];
      return delta + (included(row) && known(old) && known(value) ? value - old : 0);
    }, 0);
  return known(total) ? round(total) : source;
}

export function applyManagerGoalDemo<T extends ManagerGoalDemoBoard | null | undefined>(board: T, values: Values): T {
  if (!board || board.error || !Array.isArray(board.managers)) return board;
  const managers = board.managers.map((row) => managerRow(row, values));
  if (managers.every((row, index) => row === board.managers[index])) return board;
  return {
    ...board,
    managers,
    total_team_goal: boardTotal(board.total_team_goal, board.managers, managers, "team_ap_goal"),
    total_team_actual: boardTotal(board.total_team_actual, board.managers, managers, "team_ap_actual"),
    total_projected_sam_override: boardTotal(board.total_projected_sam_override, board.managers, managers, "projected_sam_override"),
    total_projected_mgr_income: boardTotal(board.total_projected_mgr_income, board.managers, managers, "projected_total_income"),
  };
}

const TARGET_FIELDS = [
  ["ap_mtd", "Month-to-date AP", "money"],
  ["deals_mtd", "Deals this month", "count"],
  ["projected_eom_ap", "End-of-month AP · estimate", "money"],
  ["deals_no_policy_mtd", "Deals missing a policy number", "count"],
  ["ap_at_risk_mtd", "AP at risk · missing policy number", "money"],
] as const;

export function target20kDemoFields(rows: readonly Target20kDemoRow[] | null | undefined): DemoNumberField[] {
  return (rows ?? []).flatMap((row) => hasId(row.agent_id)
    ? TARGET_FIELDS.flatMap(([key, label, kind]) => field(`target20k:${row.agent_id}:${key}`, `${row.name?.trim() || "Agent"} · ${label}`, row[key], kind))
    : []);
}

function targetRow<T extends Target20kDemoRow>(row: T, values: Values): T {
  if (!hasId(row.agent_id)) return row;
  const next = { ...row };
  const changed = new Set<string>();
  for (const [key, , kind] of TARGET_FIELDS) {
    const value = edit(values, `target20k:${row.agent_id}:${key}`, row[key], kind === "count");
    if (value === undefined) continue;
    next[key] = value;
    changed.add(key);
  }
  if (!changed.size) return row;

  if (known(next.ap_mtd)) {
    if (known(row.ap_to_20k)) next.ap_to_20k = round(Math.max(TARGET_20K - next.ap_mtd, 0));
    if (known(next.projected_eom_ap)) {
      if (changed.has("ap_mtd") && !changed.has("projected_eom_ap") && known(row.ap_mtd) && row.ap_mtd > 0 && known(row.projected_eom_ap)) {
        // The returned ratio embodies the period's pace; never invent a new
        // day/month or a history series. Zero baselines use only the known AP.
        const projected = round(row.projected_eom_ap * next.ap_mtd / row.ap_mtd, 0);
        if (known(projected)) next.projected_eom_ap = projected;
      }
      next.projected_eom_ap = Math.max(next.ap_mtd, next.projected_eom_ap);
    }
    if (known(next.ap_at_risk_mtd)) next.ap_at_risk_mtd = Math.min(next.ap_mtd, next.ap_at_risk_mtd);
    if (changed.has("ap_mtd") || changed.has("projected_eom_ap")) {
      next.pace_verdict = next.ap_mtd >= TARGET_20K ? "hit_20k"
        : next.ap_mtd > 0 ? known(next.projected_eom_ap) && next.projected_eom_ap >= TARGET_20K ? "on_pace_20k" : "below_pace"
          : row.pace_verdict === "new_hire_grace" ? "new_hire_grace" : "zero_mtd";
    }
  }
  if (known(next.deals_mtd) && known(next.deals_no_policy_mtd)) next.deals_no_policy_mtd = Math.min(next.deals_mtd, next.deals_no_policy_mtd);
  if (next.deals_no_policy_mtd === 0 && known(next.ap_at_risk_mtd)) next.ap_at_risk_mtd = 0;
  return next;
}

/** Returns copied display rows; the component's totals automatically read the same adjusted rows. */
export function applyTarget20kDemo<T extends Target20kDemoRow>(rows: readonly T[], values: Values): T[] {
  const next = rows.map((row) => targetRow(row, values));
  if (next.every((row, index) => row === rows[index])) return next;
  // Keep the existing leaderboard's AP/projection ordering after a display edit.
  return next.sort((left, right) => {
    if (known(left.ap_mtd) && known(right.ap_mtd)) return right.ap_mtd - left.ap_mtd || (known(left.projected_eom_ap) && known(right.projected_eom_ap) ? right.projected_eom_ap - left.projected_eom_ap : 0);
    return known(right.ap_mtd) ? 1 : known(left.ap_mtd) ? -1 : 0;
  });
}
