/**
 * Team recovery (MP-TEAM-RECOVERY, 2026-11-27): the pure rules behind /dashboard/team-recovery.
 *
 * Sam: "combine team recovery and call sheet ... make it easy to filter states, or agents by states."
 * One page now holds the Ethos call sheet and the inactive-agent recovery queue behind a shared state
 * filter, plus a view of everyone grouped by state. Kept free of React and Supabase so the filter,
 * the counts and the grouping can be tested.
 */

export type RecoveryTab = "call-sheet" | "recovery" | "by-state";

export const RECOVERY_TABS: { key: RecoveryTab; label: string; hint: string }[] = [
  { key: "call-sheet", label: "Call sheet", hint: "Licensed people under you to call, Ethos contract holders first." },
  { key: "recovery", label: "Recovery queue", hint: "Agents with no recorded activity, by how long they have been quiet." },
  { key: "by-state", label: "By state", hint: "Everyone from both lists grouped by the states they can write in." },
];

export const DEFAULT_TAB: RecoveryTab = "call-sheet";

/** The `?tab=` value, tolerant of the old page names so bookmarks keep working. */
export function parseTab(value: string | null | undefined): RecoveryTab {
  switch ((value ?? "").trim().toLowerCase()) {
    case "call-sheet":
    case "callsheet":
    case "ethos":
    case "ethos-call-sheet":
      return "call-sheet";
    case "recovery":
    case "inactive":
    case "inactive-agents":
    case "queue":
      return "recovery";
    case "by-state":
    case "states":
    case "state":
      return "by-state";
    default:
      return DEFAULT_TAB;
  }
}

/** Sentinel for "no state on file" in a state filter. */
export const NO_STATE = "";

export const NO_STATE_LABEL = "No state on file";

/**
 * A state filter is the set of two-letter states picked, plus NO_STATE when the person asked to see
 * people with no state on file. An empty set means no filter: everyone shows.
 */
export type StateFilter = ReadonlySet<string>;

export const EMPTY_STATE_FILTER: StateFilter = new Set<string>();

/** Upper-cased, two-letter, unique, sorted. Anything else is dropped. */
export function normalizeStates(input: readonly (string | null | undefined)[] | null | undefined): string[] {
  if (!input) return [];
  const out = new Set<string>();
  for (const raw of input) {
    const s = (raw ?? "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(s)) out.add(s);
  }
  return [...out].sort();
}

export function isStateFilterActive(filter: StateFilter): boolean {
  return filter.size > 0;
}

export function toggleState(filter: StateFilter, state: string): StateFilter {
  const next = new Set(filter);
  if (next.has(state)) next.delete(state);
  else next.add(state);
  return next;
}

/**
 * No filter shows everyone. With a filter, a person shows when any of their states is picked, or when
 * they have no state on file and NO_STATE is picked.
 */
export function matchesStateFilter(states: readonly string[] | null | undefined, filter: StateFilter): boolean {
  if (filter.size === 0) return true;
  const mine = normalizeStates(states);
  if (mine.length === 0) return filter.has(NO_STATE);
  return mine.some((s) => filter.has(s));
}

export interface StateCount {
  state: string;
  n: number;
}

export interface StateCountSummary {
  /** Most people first, then alphabetical. A person licensed in three states counts once in each. */
  counts: StateCount[];
  /** People with no state on file. */
  unknown: number;
  /** People counted, with or without a state. */
  total: number;
}

export const EMPTY_STATE_COUNTS: StateCountSummary = { counts: [], unknown: 0, total: 0 };

export function countStates(rows: ReadonlyArray<readonly string[] | null | undefined>): StateCountSummary {
  const map = new Map<string, number>();
  let unknown = 0;
  for (const raw of rows) {
    const states = normalizeStates(raw);
    if (states.length === 0) {
      unknown += 1;
      continue;
    }
    for (const s of states) map.set(s, (map.get(s) ?? 0) + 1);
  }
  const counts = [...map.entries()].map(([state, n]) => ({ state, n })).sort((a, b) => b.n - a.n || a.state.localeCompare(b.state));
  return { counts, unknown, total: rows.length };
}

/** The two lists' counts side by side on one filter bar. */
export function mergeStateCounts(a: StateCountSummary, b: StateCountSummary): StateCountSummary {
  const map = new Map<string, number>();
  for (const c of [...a.counts, ...b.counts]) map.set(c.state, (map.get(c.state) ?? 0) + c.n);
  const counts = [...map.entries()].map(([state, n]) => ({ state, n })).sort((x, y) => y.n - x.n || x.state.localeCompare(y.state));
  return { counts, unknown: a.unknown + b.unknown, total: a.total + b.total };
}

export type RecoverySource = "call_sheet" | "recovery";

export const SOURCE_LABEL: Record<RecoverySource, string> = {
  call_sheet: "Call sheet",
  recovery: "Recovery queue",
};

/** One person as the By-state view needs them: who, how to reach them, where they can write, why they are listed. */
export interface RecoveryPerson {
  /** Stable across renders; prefixed by source so the same human on both lists stays two rows. */
  key: string;
  name: string;
  phone: string | null;
  states: string[];
  source: RecoverySource;
  /** One line: the reason they are on the list. */
  detail: string;
  /** In-app profile when there is one. */
  href?: string;
}

export interface StateGroup {
  /** Two-letter state, or NO_STATE for the no-state bucket (always last). */
  state: string;
  label: string;
  people: RecoveryPerson[];
}

/**
 * Everyone grouped by state. A person licensed in several states appears under each; people with no
 * state on file form the last group. Inside a group: call sheet first, then recovery queue, then name.
 */
export function groupPeopleByState(people: readonly RecoveryPerson[], filter: StateFilter = EMPTY_STATE_FILTER): StateGroup[] {
  const groups = new Map<string, RecoveryPerson[]>();
  for (const p of people) {
    const states = normalizeStates(p.states);
    if (!matchesStateFilter(states, filter)) continue;
    const keys = states.length === 0 ? [NO_STATE] : states.filter((s) => filter.size === 0 || filter.has(s));
    for (const k of keys) {
      const list = groups.get(k) ?? [];
      list.push(p);
      groups.set(k, list);
    }
  }
  const order = (p: RecoveryPerson) => (p.source === "call_sheet" ? 0 : 1);
  const out: StateGroup[] = [...groups.entries()]
    .filter(([k]) => k !== NO_STATE)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([state, list]) => ({
      state,
      label: state,
      people: [...list].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)),
    }));
  const unknown = groups.get(NO_STATE);
  if (unknown && unknown.length > 0) {
    out.push({ state: NO_STATE, label: NO_STATE_LABEL, people: [...unknown].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)) });
  }
  return out;
}
