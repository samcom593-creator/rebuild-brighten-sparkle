// Books page (2026-10-07): working carrier books for rewrites ("flips").
// Pure helpers so the page, its counts and the tests share one set of rules.
// The rows come from v_book_flip_worklist (one row per carrier + policy number + client).
// OVERHAUL-resells (2026-10-29): the page opens on "Best evidence first" (src/lib/resellEvidence.ts) and
// every state pill takes its colour from a tone mapping (src/lib/tones.ts), never a hand-picked colour.
import { inferStateFromPhone } from "@/lib/inboundLeads";
import { US_STATES } from "@/lib/contractReview";
import type { EvidenceSubject } from "@/lib/resellEvidence";
import { bookStandingTone, flipStatusTone, tonePill } from "@/lib/tones";

export type StatusGroup = "active" | "unknown" | "lapsing" | "pending" | "dead";
export type FlipStatus =
  | "to_call" | "no_answer" | "callback" | "appointment" | "resold" | "not_interested" | "do_not_call" | "bad_number";

export interface BookPolicy {
  flip_key: string;
  carrier: string;
  policy_number: string;
  client_key: string;
  product: string | null;
  book_status: string;
  is_dead: boolean;
  is_book_active: boolean;
  status_group: StatusGroup;
  client_name: string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  phone: string | null;
  phone_source: string | null;
  dob: string | null;
  age_years: number | null;
  state: string | null;
  city: string | null;
  do_not_call: boolean;
  best_time_to_call: string | null;
  face_amount: number | null;
  monthly_premium: number | null;
  annual_premium: number | null;
  effective_date: string | null;
  /** The day the policy was posted; the start date when the carrier sent no effective date. */
  posted_date?: string | null;
  months_in_force: number | null;
  agent_name: string | null;
  agent_gone: boolean;
  /** "Vantage" when the writing agent is one of the Vantage Financial producers (is_vantage_agent). */
  agent_group?: string | null;
  clients_on_number: number;
  flip_status: FlipStatus;
  attempts: number;
  last_contact_at: string | null;
  callback_at: string | null;
  notes: string | null;
  resold_policy_number: string | null;
  resold_carrier: string | null;
  resold_annual_premium: number | null;
}

/** Sam's order for 2026-10-07: Combined and American Home Life first, then Royal Neighbors and Transamerica. */
export const PRIORITY_CARRIERS: { carrier: string; priority: "High" | "Good" }[] = [
  { carrier: "Combined", priority: "High" },
  { carrier: "American Home Life", priority: "High" },
  { carrier: "Royal Neighbors", priority: "Good" },
  { carrier: "Transamerica", priority: "Good" },
];

export type BookFilter = "departed" | "workable" | "active" | "unknown" | "lapsing" | "all";
export type FlipFilter = "to_call" | "callbacks" | "appointments" | "resold" | "closed" | "all";
export type SortKey = "evidence" | "priority" | "oldest" | "premium" | "face" | "name";

export const BOOK_FILTERS: { key: BookFilter; label: string }[] = [
  { key: "departed", label: "Departed writers" },
  { key: "workable", label: "Workable" },
  { key: "active", label: "Confirmed active" },
  { key: "unknown", label: "Status unknown" },
  { key: "lapsing", label: "Lapsing" },
  { key: "all", label: "All" },
];
/**
 * Which book bucket to open on when the link names none. "Departed writers" is the best flip, so it comes first, but a
 * book with no departed writers would open on an empty list; then the page opens on All so the opportunities show.
 */
export function defaultBookFilter(all: readonly (Pick<BookPolicy, "status_group"> & { agent_gone?: boolean })[]): BookFilter {
  return all.some((p) => matchesBook(p, "departed")) ? "departed" : "all";
}

export const FLIP_FILTERS: { key: FlipFilter; label: string }[] = [
  { key: "to_call", label: "To call" },
  { key: "callbacks", label: "Callbacks" },
  { key: "appointments", label: "Appointments" },
  { key: "resold", label: "Resold" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "evidence", label: "Best evidence first" },
  { key: "priority", label: "Departed writers first" },
  { key: "oldest", label: "Longest in force first" },
  { key: "premium", label: "Highest premium" },
  { key: "face", label: "Highest face amount" },
  { key: "name", label: "Name A-Z" },
];

export const FLIP_LABEL: Record<FlipStatus, string> = {
  to_call: "To call",
  no_answer: "No answer",
  callback: "Callback",
  appointment: "Appointment",
  resold: "Resold",
  not_interested: "Not interested",
  do_not_call: "Do not call",
  bad_number: "Bad number",
};
/** Each outcome's pill in its tone (src/lib/tones.ts flipStatusTone), the label always beside it. */
export const FLIP_TONE: Record<FlipStatus, string> = {
  to_call: tonePill(flipStatusTone("to_call")),
  no_answer: tonePill(flipStatusTone("no_answer")),
  callback: tonePill(flipStatusTone("callback")),
  appointment: tonePill(flipStatusTone("appointment")),
  resold: tonePill(flipStatusTone("resold")),
  not_interested: tonePill(flipStatusTone("not_interested")),
  do_not_call: tonePill(flipStatusTone("do_not_call")),
  bad_number: tonePill(flipStatusTone("bad_number")),
};
export const GROUP_LABEL: Record<StatusGroup, string> = {
  active: "Active",
  unknown: "Status unknown",
  lapsing: "Lapsing",
  pending: "Pending",
  dead: "Not in force",
};
/** The book status pill's tone: the Book of Business standing tones, where a dead policy is "gone". */
export const groupTone = (group: StatusGroup) => bookStandingTone(group === "dead" ? "gone" : group);

const CLOSED: FlipStatus[] = ["not_interested", "do_not_call", "bad_number"];

/**
 * Priority for policies whose writing agent has left (2026-10-08, Sam: "prioritize the active deals from
 * agents who are no longer with us"). A policy nobody services is the one that quietly lapses, so the order
 * is by what can still be saved and how soon it costs money:
 *   1  lapse pending   still in force but about to lapse: a call now can keep it
 *   2  not paid yet    submitted, in review or issued-not-paid: can still fall through
 *   3  in force        active with nobody servicing it: needs an owner
 *   4  lapsed          already off the books: reinstate or rewrite, not save
 *   5  unknown         the book never recorded a status, so it is NOT counted as active
 *   6  other           writer still here, or the policy is already dead
 * The view groups "Lapsed" together with "Lapse Pending"; they are split here on the exact book status,
 * because telling Sam a lapsed policy can be "saved" would send him to the wrong conversation.
 */
export type PriorityTier = 1 | 2 | 3 | 4 | 5 | 6;
export function priorityTier(p: Pick<BookPolicy, "status_group" | "agent_gone"> & { book_status?: string | null }): PriorityTier {
  if (!p.agent_gone || p.status_group === "dead") return 6;
  switch (p.status_group) {
    case "lapsing": return /^\s*lapsed\s*$/i.test(p.book_status ?? "") ? 4 : 1;
    case "pending": return 2;
    case "active": return 3;
    default: return 5;
  }
}
export const PRIORITY_LABEL: Record<PriorityTier, string> = {
  1: "Save it: lapse pending",
  2: "Not paid yet",
  3: "In force, no agent",
  4: "Lapsed: reinstate or rewrite",
  5: "Status unknown",
  6: "",
};

export function isCallbackDue(p: Pick<BookPolicy, "flip_status" | "callback_at">, now: Date = new Date()): boolean {
  return p.flip_status === "callback" && !!p.callback_at && new Date(p.callback_at).getTime() <= now.getTime();
}

export function matchesBook(p: Pick<BookPolicy, "status_group"> & { agent_gone?: boolean }, f: BookFilter): boolean {
  switch (f) {
    case "departed": return p.agent_gone === true && p.status_group !== "dead";
    case "workable": return p.status_group !== "dead";
    case "active": return p.status_group === "active";
    case "unknown": return p.status_group === "unknown";
    case "lapsing": return p.status_group === "lapsing";
    default: return true;
  }
}

/** "To call" never includes a do-not-call client, matching v_book_flip_carrier_counts.to_call. */
export function matchesFlip(
  p: Pick<BookPolicy, "flip_status" | "callback_at" | "do_not_call">, f: FlipFilter, now: Date = new Date(),
): boolean {
  switch (f) {
    case "to_call":
      return !p.do_not_call && (p.flip_status === "to_call" || p.flip_status === "no_answer" || isCallbackDue(p, now));
    case "callbacks": return p.flip_status === "callback";
    case "appointments": return p.flip_status === "appointment";
    case "resold": return p.flip_status === "resold";
    case "closed": return CLOSED.includes(p.flip_status);
    default: return true;
  }
}

export const digits = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");

/** The carrier picker's "All carriers" entry: one list across every book, so one agent's whole book shows at once. */
export const ALL_CARRIERS = "all";
/** The agent filter's "everyone" value. */
export const ALL_AGENTS = "all";

const agentOf = (p: Pick<BookPolicy, "agent_name">): string => (p.agent_name ?? "").trim();

/** The agent filter's value for a whole agent group, e.g. "group:Vantage". */
export const agentGroupValue = (group: string) => `group:${group}`;

/** True when the row was written by this agent, or by anyone in the group ("all" keeps every row). */
export function matchesAgent(p: Pick<BookPolicy, "agent_name" | "agent_group">, agent: string): boolean {
  if (agent === ALL_AGENTS) return true;
  if (agent.startsWith("group:")) return (p.agent_group ?? "") === agent.slice(6);
  return agentOf(p) === agent;
}

export interface AgentCount { name: string; count: number; gone: boolean }

/**
 * Writing agents in a list with how many of its policies each one sold, most first. An agent counts as gone
 * when any of their rows says so. Rows with no agent on file are left out of the list rather than shown blank.
 */
export function agentCounts(list: readonly Pick<BookPolicy, "agent_name" | "agent_gone">[]): AgentCount[] {
  const byName = new Map<string, AgentCount>();
  for (const p of list) {
    const name = agentOf(p);
    if (!name) continue;
    const c = byName.get(name) ?? { name, count: 0, gone: false };
    c.count += 1;
    c.gone = c.gone || p.agent_gone;
    byName.set(name, c);
  }
  return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function matchesSearch(p: Pick<BookPolicy, "client_name" | "phone" | "policy_number">, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  if ((p.client_name ?? "").toLowerCase().includes(t)) return true;
  if (p.policy_number.toLowerCase().includes(t)) return true;
  const d = digits(t);
  return d.length >= 3 && digits(p.phone).includes(d);
}

const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);

/**
 * A policy the caller can dial from the card: a phone on file, not do-not-call, not marked bad number.
 * The evidence order puts these first, so the top of the list is always somebody to call.
 */
export function isCallable(p: Pick<BookPolicy, "phone" | "do_not_call" | "flip_status">): boolean {
  return digits(p.phone).length >= 10 && !p.do_not_call && p.flip_status !== "do_not_call" && p.flip_status !== "bad_number";
}

/** What the evidence is asked about one policy: its number and name, and its lapse if it is lapsing. */
export function policySubject(
  p: Pick<BookPolicy, "phone" | "client_first_name" | "client_last_name" | "client_name" | "status_group" | "book_status" | "effective_date"> & { posted_date?: string | null },
): EvidenceSubject {
  return {
    phone: p.phone,
    firstName: p.client_first_name,
    lastName: p.client_last_name,
    fullName: p.client_name,
    lapse: p.status_group === "lapsing" ? { status: p.book_status, startedOn: p.effective_date ?? p.posted_date ?? null } : null,
  };
}

/**
 * "evidence" (the default): somebody callable first, then the highest evidence score (scoreOf), then the
 * departed-writer priority and the biggest annual premium, the order the page used before.
 */
export function sortPolicies<T extends Pick<BookPolicy, "months_in_force" | "monthly_premium" | "annual_premium" | "face_amount" | "client_name" | "flip_key" | "status_group" | "agent_gone" | "book_status"> & Partial<Pick<BookPolicy, "phone" | "do_not_call" | "flip_status">>>(
  list: T[], key: SortKey, scoreOf: (p: T) => number = () => 0,
): T[] {
  const name = (p: T) => (p.client_name ?? "").toLowerCase();
  const byDesc = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a);
  const tie = (a: T, b: T) => name(a).localeCompare(name(b)) || a.flip_key.localeCompare(b.flip_key);
  const callable = (p: T) => (isCallable({ phone: p.phone ?? null, do_not_call: !!p.do_not_call, flip_status: p.flip_status ?? "to_call" }) ? 0 : 1);
  const out = [...list];
  out.sort((a, b) => {
    switch (key) {
      case "evidence":
        return callable(a) - callable(b)
          || scoreOf(b) - scoreOf(a)
          || priorityTier(a) - priorityTier(b)
          || byDesc(num(a.annual_premium), num(b.annual_premium))
          || byDesc(num(a.months_in_force), num(b.months_in_force)) || tie(a, b);
      case "priority":
        return priorityTier(a) - priorityTier(b)
          || byDesc(num(a.annual_premium), num(b.annual_premium))
          || byDesc(num(a.months_in_force), num(b.months_in_force)) || tie(a, b);
      case "premium": return byDesc(num(a.monthly_premium), num(b.monthly_premium)) || tie(a, b);
      case "face": return byDesc(num(a.face_amount), num(b.face_amount)) || tie(a, b);
      case "name": return tie(a, b);
      default: return byDesc(num(a.months_in_force), num(b.months_in_force)) || tie(a, b);
    }
  });
  return out;
}

// Phone display and dial links come from @/lib/phone (formatPhoneDisplay, phoneHref), the site's one home for them.

export function monthsInForceText(m: number | null | undefined): string {
  if (m === null || m === undefined) return "";
  if (m < 1) return "under 1 mo in force";
  const y = Math.floor(m / 12);
  const mo = m % 12;
  if (y === 0) return `${mo} mo in force`;
  return `${y} yr${mo ? ` ${mo} mo` : ""} in force`;
}

export function money(n: number | null | undefined, digitsAfter = 0): string {
  const v = num(n);
  if (v === null) return "";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digitsAfter, minimumFractionDigits: digitsAfter });
}

/** Display date for a stored YYYY-MM-DD without shifting it across time zones. */
export function shortDate(d: string | null | undefined): string {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return "";
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Callback time in Phoenix, where Sam works. */
export function phoenixTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Phoenix", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** First/last name for the deal dialog, falling back to splitting the full name. */
export function splitName(p: Pick<BookPolicy, "client_first_name" | "client_last_name" | "client_name">): { firstName: string; lastName: string } {
  const first = (p.client_first_name ?? "").trim();
  const last = (p.client_last_name ?? "").trim();
  if (first || last) return { firstName: first, lastName: last };
  const parts = (p.client_name ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

/** Book names arrive as typed ("dianna walker", "JEFF HEFTY"); show them capitalized. Mixed case is left alone. */
export function displayName(name: string | null | undefined): string {
  const n = (name ?? "").trim().replace(/\s+/g, " ");
  if (!n) return "";
  if (n !== n.toLowerCase() && n !== n.toUpperCase()) return n;
  return n.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
}


// ── State targeting ───────────────────────────────────────────────────────────────────────────────────────────
// Sam (2026-10-09): "click Arizona and see what the opportunities are for that state." MEASURED first: the book carries a
// client state on 19 of 1,317 policies (1.4%), none of them in the default view, and holds no address to backfill from.
// So a state is layered and LABELLED: the client's recorded state when there is one; otherwise the phone's area code,
// which is a likely state, not a fact (people keep mobile numbers when they move); otherwise Unknown. Counts show the
// Unknown bucket so an empty state reads as truth, not as a broken filter.

export type StateSource = "client" | "phone" | null;
export interface PolicyState { code: string | null; source: StateSource }
export const STATE_UNKNOWN = "unknown";
const STATE_NAME = new Map(US_STATES.map(([code, name]) => [code, name] as const));
export const stateName = (code: string): string => STATE_NAME.get(code) ?? code;

export function policyState(p: Pick<BookPolicy, "state" | "phone">): PolicyState {
  const known = (p.state ?? "").trim().toUpperCase();
  if (known.length === 2 && STATE_NAME.has(known)) return { code: known, source: "client" };
  const guess = p.phone ? inferStateFromPhone(p.phone) : null;
  if (guess && STATE_NAME.has(guess)) return { code: guess, source: "phone" };
  return { code: null, source: null };
}

export const stateSourceText = (s: PolicyState): string =>
  s.code === null ? "State unknown" : s.source === "client" ? `${s.code} · on file` : `${s.code} · likely, by area code`;

/** "all" = every policy; STATE_UNKNOWN = no state could be read; otherwise a two-letter code. */
export function matchesState(p: Pick<BookPolicy, "state" | "phone">, code: string): boolean {
  if (code === "all") return true;
  const s = policyState(p);
  return code === STATE_UNKNOWN ? s.code === null : s.code === code;
}

/** Counts per state over a list (already narrowed by the other filters), highest first, Unknown last. */
export interface StateCount { code: string; count: number; onFile: number }

/**
 * The state chips to show: the busiest states, and always the selected one. A selected state outside the busiest
 * few keeps its REAL count (it was only hidden by the cut, not empty); only a state with nobody at all shows 0.
 */
export function stateChipsFor(byState: readonly StateCount[], selected: string, top = 12): StateCount[] {
  const chips = byState.filter((s) => s.code !== STATE_UNKNOWN).slice(0, top);
  if (selected === "all" || selected === STATE_UNKNOWN || chips.some((c) => c.code === selected)) return chips;
  const real = byState.find((s) => s.code === selected);
  return [real ?? { code: selected, count: 0, onFile: 0 }, ...chips];
}

export function stateCounts<T extends Pick<BookPolicy, "state" | "phone">>(list: readonly T[]): StateCount[] {
  const m = new Map<string, { count: number; onFile: number }>();
  let unknown = 0;
  for (const p of list) {
    const s = policyState(p);
    if (!s.code) { unknown += 1; continue; }
    const cur = m.get(s.code) ?? { count: 0, onFile: 0 };
    cur.count += 1; if (s.source === "client") cur.onFile += 1; m.set(s.code, cur);
  }
  const out = [...m.entries()].map(([code, v]) => ({ code, ...v })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  if (unknown > 0) out.push({ code: STATE_UNKNOWN, count: unknown, onFile: 0 });
  return out;
}
