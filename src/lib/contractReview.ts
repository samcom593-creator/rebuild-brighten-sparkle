/**
 * The manual portal tracker: four carrier circles per active agent, one agent-wide placement level and five intake
 * fields. Carrier contracting happens in the carriers' own portals; the website only records what a person confirmed
 * by hand. A circle is therefore either Unmarked ("Not yet reviewed") or confirmed. Unmarked is NOT late, NOT failed
 * and NOT "uncontracted": it means nobody has looked yet.
 *
 * Everything here is pure except the three writers at the bottom. The database function `contract_review_roster`
 * returns the whole review in one read with an explicit `ok` flag and a count, so a failed or truncated read can never
 * be mistaken for "everyone is unmarked": parseReviewRoster refuses anything that does not add up.
 */
import { supabase } from "@/integrations/supabase/client";

export interface ReviewCarrier { key: string; label: string; position: number; mapped: boolean; portal_url: string | null }
export interface MarkInfo { at: string; by: string | null; by_name: string }
export interface ReviewProfile {
  npn: string | null; first_name: string | null; last_name: string | null; email: string | null; resident_state: string | null;
  state_hint: string | null; complete: boolean;
}
export interface ReviewLevel { pct: number; source: string | null; effective_from: string | null; updated_at: string | null }
export interface ReviewAgent {
  agent_id: string; display_name: string; email: string | null; manager_id: string | null; manager_name: string | null;
  profile: ReviewProfile; marks: Record<string, MarkInfo | null>; marked_count: number; level: ReviewLevel | null;
}
export interface ReviewCounts { agents: number; needs_review: number; unmarked_all: number; partial: number; all_four: number; level_unset: number; intake_incomplete: number }
export interface ReviewRoster { version: number; as_of: string; carriers: ReviewCarrier[]; counts: ReviewCounts; agents: ReviewAgent[] }

export type ReviewFilter = "needs_review" | "partial" | "all_four";
export const REVIEW_FILTERS: ReadonlyArray<{ key: ReviewFilter; label: string }> = [
  { key: "needs_review", label: "Needs review" },
  { key: "partial", label: "Partially marked" },
  { key: "all_four", label: "All four marked" },
];

export const UNMARKED_LABEL = "Not yet reviewed";

/** Turns the raw RPC payload into a roster, or throws. A throw is shown as an error, never as an empty list. */
export function parseReviewRoster(raw: unknown): ReviewRoster {
  const r = raw as Partial<ReviewRoster> & { ok?: boolean } | null;
  if (!r || typeof r !== "object" || r.ok !== true) throw new Error("The contracting review did not load completely.");
  if (!Array.isArray(r.agents) || !Array.isArray(r.carriers) || r.carriers.length === 0 || !r.counts) throw new Error("The contracting review came back incomplete.");
  if (r.counts.agents !== r.agents.length) throw new Error("The contracting review was cut short, so nothing is shown as unmarked.");
  const carriers = [...r.carriers].sort((a, b) => a.position - b.position);
  const agents = r.agents.map((a) => normalizeAgent(a, carriers));
  return { version: Number(r.version ?? 1), as_of: String(r.as_of ?? ""), carriers, counts: r.counts, agents };
}

function normalizeAgent(a: ReviewAgent, carriers: ReviewCarrier[]): ReviewAgent {
  const marks: Record<string, MarkInfo | null> = {};
  for (const c of carriers) marks[c.key] = a.marks?.[c.key] ?? null;
  return { ...a, marks, marked_count: carriers.filter((c) => marks[c.key]).length };
}

export const markedCountOf = (a: ReviewAgent, carriers: readonly ReviewCarrier[]): number => carriers.filter((c) => a.marks[c.key]).length;

export function matchesFilter(a: ReviewAgent, filter: ReviewFilter, carrierCount: number): boolean {
  const n = a.marked_count;
  if (filter === "needs_review") return n < carrierCount;
  if (filter === "partial") return n >= 1 && n < carrierCount;
  return n >= carrierCount;
}

const norm = (s: string | null | undefined): string => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();

export function matchesSearch(a: ReviewAgent, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  const hay = [a.display_name, a.email, a.profile.email, a.profile.first_name, a.profile.last_name, a.profile.npn, a.manager_name].map(norm).join(" ");
  return q.split(/\s+/).every((t) => hay.includes(t));
}

export interface ReviewQuery { filter: ReviewFilter; search: string; managerId: string }

/**
 * The visible list. `pinned` people stay in the list even after their last mark moves them out of the current filter,
 * so a row does not vanish under the user's finger; they leave only when the user advances.
 */
export function visibleAgents(agents: readonly ReviewAgent[], q: ReviewQuery, carrierCount: number, pinned: ReadonlySet<string> = new Set()): ReviewAgent[] {
  return agents.filter((a) => {
    if (q.managerId !== "all" && a.manager_id !== q.managerId) return false;
    if (!matchesSearch(a, q.search)) return false;
    return pinned.has(a.agent_id) || matchesFilter(a, q.filter, carrierCount);
  });
}

/** Counts of distinct people (the roster already has one row per person) for the filter chips. */
export function reviewCounts(agents: readonly ReviewAgent[], carrierCount: number) {
  let needs = 0, partial = 0, all = 0, none = 0;
  for (const a of agents) {
    if (a.marked_count >= carrierCount) all += 1;
    else { needs += 1; if (a.marked_count === 0) none += 1; else partial += 1; }
  }
  return { total: agents.length, needsReview: needs, partial, allFour: all, unmarkedAll: none };
}

/** The next person after `currentId` (in list order) who still has an Unmarked circle; wraps once; null if nobody does. */
export function nextToReview(ordered: readonly ReviewAgent[], currentId: string | null, carrierCount: number): ReviewAgent | null {
  const todo = (a: ReviewAgent) => a.marked_count < carrierCount;
  const at = currentId ? ordered.findIndex((a) => a.agent_id === currentId) : -1;
  // The two slices exclude the current person by construction, so they can never be handed back to themselves.
  return ordered.slice(at + 1).find(todo) ?? ordered.slice(0, Math.max(at, 0)).find(todo) ?? null;
}

/** Managers/owners present in the roster, for the existing team filter. */
export function teamOptions(agents: readonly ReviewAgent[]): Array<{ id: string; name: string; count: number }> {
  const m = new Map<string, { id: string; name: string; count: number }>();
  for (const a of agents) {
    if (!a.manager_id) continue;
    const cur = m.get(a.manager_id) ?? { id: a.manager_id, name: a.manager_name ?? "Name not on file", count: 0 };
    cur.count += 1; m.set(a.manager_id, cur);
  }
  return [...m.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/** A copy of the agent with one circle changed. Used for the optimistic update; the server read replaces it. */
export function withMark(a: ReviewAgent, carriers: readonly ReviewCarrier[], key: string, mark: MarkInfo | null): ReviewAgent {
  const marks = { ...a.marks, [key]: mark };
  return { ...a, marks, marked_count: markedCountOf({ ...a, marks }, carriers) };
}

export function withLevel(a: ReviewAgent, level: ReviewLevel | null): ReviewAgent { return { ...a, level }; }

const phoenixDay = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric" }).format(d);
};

/** "Confirmed by Name on Oct 9" or "Not yet reviewed". Never "pending", "late" or "failed". */
export function markSentence(m: MarkInfo | null): string {
  if (!m) return UNMARKED_LABEL;
  const day = phoenixDay(m.at);
  return `Confirmed by ${m.by_name || "a team member"}${day ? ` on ${day}` : ""}`;
}

/** Accessible name for a circle: what it is, its state, and what pressing it will do. */
export function circleAriaLabel(label: string, m: MarkInfo | null, canEdit: boolean): string {
  const state = markSentence(m);
  if (!canEdit) return `${label}: ${state}. View only.`;
  return `${label}: ${state}. ${m ? "Press to clear and return to Not yet reviewed." : "Press to confirm."}`;
}

/** Unknown level is visibly unset. It is never shown as 0. */
export function levelText(l: ReviewLevel | null): string {
  return l && Number.isFinite(l.pct) ? `${Number.isInteger(l.pct) ? l.pct : l.pct.toFixed(1)}%` : "Not set";
}

export const INTAKE_FIELDS = ["npn", "first_name", "last_name", "email", "resident_state"] as const;
export type IntakeField = typeof INTAKE_FIELDS[number];
export const INTAKE_LABEL: Record<IntakeField, string> = {
  npn: "NPN number", first_name: "First name", last_name: "Last name", email: "Email", resident_state: "Resident state",
};

export function missingIntake(p: ReviewProfile): IntakeField[] {
  return INTAKE_FIELDS.filter((f) => !(p[f] ?? "").toString().trim());
}

export const US_STATES: ReadonlyArray<readonly [string, string]> = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"],
  ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"],
  ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ["PR", "Puerto Rico"], ["GU", "Guam"], ["VI", "U.S. Virgin Islands"], ["AS", "American Samoa"], ["MP", "Northern Mariana Islands"],
];

/** Client-side mirror of the server's NPN rule, to explain a problem before a round trip. The server decides. */
export function npnProblem(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  return /^[0-9]{5,10}$/.test(v) ? null : "The NPN is 5 to 10 digits, with nothing else.";
}

// ── writers ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Flat result shapes: this repo does not compile in strict mode, where a union discriminated on `ok` would not narrow.

export interface MarkResult { ok: boolean; conflict: boolean; confirmed: boolean; confirmedAt: string | null; error: string | null }
export interface LevelResult { ok: boolean; conflict: boolean; pct: number | null; changed: boolean; error: string | null }
export interface ProfileResult { ok: boolean; field: string | null; conflict: string | null; otherName: string | null; error: string | null }

const msg = (e: unknown): string => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "save failed").slice(0, 160);
type Json = Record<string, unknown> | null;

export async function saveMark(agentId: string, carrierKey: string, confirmed: boolean, expected: boolean): Promise<MarkResult> {
  const { data, error } = await supabase.rpc("set_contract_review_mark", { p_agent_id: agentId, p_carrier_key: carrierKey, p_confirmed: confirmed, p_expected: expected });
  const r = data as unknown as Json;
  if (error) return { ok: false, conflict: false, confirmed: expected, confirmedAt: null, error: msg(error) };
  if (!r) return { ok: false, conflict: false, confirmed: expected, confirmedAt: null, error: "The save did not come back." };
  return { ok: r.ok === true, conflict: r.conflict === true, confirmed: r.confirmed === true, confirmedAt: (r.confirmed_at as string | null) ?? null, error: r.ok === true || r.conflict === true ? null : "The save was not accepted." };
}

export async function saveLevel(agentId: string, pct: number | null, expected: number | null): Promise<LevelResult> {
  const { data, error } = await supabase.rpc("set_review_placement_level", {
    p_agent_id: agentId, p_pct: pct as number, ...(expected === null ? { p_expect_unset: true } : { p_expected: expected }),
  });
  const r = data as unknown as Json;
  if (error) return { ok: false, conflict: false, pct: expected, changed: false, error: msg(error) };
  if (!r) return { ok: false, conflict: false, pct: expected, changed: false, error: "The save did not come back." };
  return { ok: r.ok === true, conflict: r.conflict === true, pct: typeof r.pct === "number" ? r.pct : null, changed: r.changed === true, error: r.ok === true || r.conflict === true ? null : "The save was not accepted." };
}

export interface IntakeValues { npn: string; first_name: string; last_name: string; email: string; resident_state: string }

function profileResult(data: unknown, error: unknown): ProfileResult {
  if (error) return { ok: false, field: null, conflict: null, otherName: null, error: msg(error) };
  const r = data as unknown as Json;
  if (!r) return { ok: false, field: null, conflict: null, otherName: null, error: "The save did not come back." };
  return { ok: r.ok === true, field: (r.field as string | null) ?? null, conflict: (r.conflict as string | null) ?? null, otherName: (r.other_name as string | null) ?? null, error: r.ok === true ? null : String(r.error ?? "The save was not accepted.") };
}

export async function saveProfileForAgent(agentId: string, v: IntakeValues): Promise<ProfileResult> {
  const { data, error } = await supabase.rpc("save_contract_review_profile", { p_agent_id: agentId, p_npn: v.npn, p_first: v.first_name, p_last: v.last_name, p_email: v.email, p_state: v.resident_state });
  return profileResult(data, error);
}

export async function saveMyProfile(v: IntakeValues): Promise<ProfileResult> {
  const { data, error } = await supabase.rpc("save_my_contracting_profile", { p_npn: v.npn, p_first: v.first_name, p_last: v.last_name, p_email: v.email, p_state: v.resident_state });
  return profileResult(data, error);
}
