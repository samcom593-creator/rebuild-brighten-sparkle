// My Day -> Todoist planning. PURE: no network, no Deno globals, shared by the edge function and vitest.
//
// One Todoist task per DISTINCT block (title + start time), recurring on exactly the weekdays that carry it,
// so a block that repeats Monday to Friday is one task, not five. Explicit weekday lists only: in a live test
// Todoist's "every weekday at 7:30" skipped the very next morning, while "every mon,tue,... at 7:30" did not.

export interface PlanTask {
  weekday: number;       // 1 = Mon .. 7 = Sun
  start_min: number;     // minutes after midnight, Arizona
  duration_min: number;
  title: string;
  detail: string | null;
  category: string;
  active: boolean;
  /** Blocks with the phone alert switched off are not pushed either: alert = "this is a calendar item". */
  alert?: boolean;
}

export interface DesiredTask {
  key: string;
  content: string;
  description: string;
  due_string: string;
}

const DAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function clock24(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

export function rangeLabel(start: number, dur: number): string {
  const f = (n: number) => {
    const m = ((n % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  };
  return `${f(start)} to ${f(start + dur)}`;
}

/** Stable identity for a block across weekdays. Renaming or retiming a block makes a new key on purpose. */
export function blockKey(t: Pick<PlanTask, "title" | "start_min">): string {
  return `${t.start_min}|${t.title.trim().toLowerCase()}`;
}

/**
 * Sam already has recurring Todoist tasks for these, made by hand on 2026-10-06. Pushing them again would put
 * the same item twice on his list and his calendar.
 */
export const ALREADY_IN_TODOIST = /^shutdown|week review/i;

/** Only real, timed, alert-worthy blocks become Todoist tasks. Sleep, meals and free time stay in My Day. */
export function isSyncable(t: PlanTask): boolean {
  return t.active && t.alert !== false && t.category !== "rest"
    && t.title.trim() !== "" && !ALREADY_IN_TODOIST.test(t.title.trim()) && t.weekday >= 1 && t.weekday <= 7;
}

export function buildDesired(tasks: PlanTask[]): DesiredTask[] {
  const groups = new Map<string, PlanTask[]>();
  for (const t of tasks) {
    if (!isSyncable(t)) continue;
    const k = blockKey(t);
    const g = groups.get(k);
    if (g) g.push(t); else groups.set(k, [t]);
  }
  const out: DesiredTask[] = [];
  for (const [key, g] of groups) {
    const days = [...new Set(g.map((t) => t.weekday))].sort((a, b) => a - b);
    const first = g[0];
    const detail = (g.find((t) => t.detail)?.detail ?? "").trim();
    out.push({
      key,
      content: first.title.trim(),
      description: [`${rangeLabel(first.start_min, first.duration_min)} Arizona`, detail, "Synced from My Day. Edit it there."]
        .filter(Boolean).join("\n"),
      due_string: `every ${days.map((d) => DAY[d - 1]).join(",")} at ${clock24(first.start_min)}`,
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
}

export interface MapRow { key: string; todoist_id: string; content: string; due_string: string }
export interface SyncPlan {
  create: DesiredTask[];
  update: Array<DesiredTask & { todoist_id: string }>;
  remove: MapRow[];
  unchanged: number;
}

/** Diff what we want against what we last pushed. Only tasks in the map are ever updated or deleted. */
export function planSync(desired: DesiredTask[], existing: MapRow[]): SyncPlan {
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const want = new Set(desired.map((d) => d.key));
  const plan: SyncPlan = { create: [], update: [], remove: [], unchanged: 0 };
  for (const d of desired) {
    const e = byKey.get(d.key);
    if (!e) plan.create.push(d);
    else if (e.content !== d.content || e.due_string !== d.due_string) plan.update.push({ ...d, todoist_id: e.todoist_id });
    else plan.unchanged += 1;
  }
  for (const e of existing) if (!want.has(e.key)) plan.remove.push(e);
  return plan;
}
