// Books page (2026-10-07): working carrier books for rewrites ("flips").
// Pure helpers so the page, its counts and the tests share one set of rules.
// The rows come from v_book_flip_worklist (one row per carrier + policy number + client).
import { inferStateFromPhone } from "@/lib/inboundLeads";
import { US_STATES } from "@/lib/contractReview";

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
  months_in_force: number | null;
  agent_name: string | null;
  agent_gone: boolean;
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
export type SortKey = "priority" | "oldest" | "premium" | "face" | "name";

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
  { key: "priority", label: "Priority (departed writers first)" },
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
export const FLIP_TONE: Record<FlipStatus, string> = {
  to_call: "border-border bg-muted text-foreground",
  no_answer: "border-amber-400/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  callback: "border-sky-400/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  appointment: "border-violet-400/40 bg-violet-500/15 text-violet-700 dark:text-violet-300",
  resold: "border-emerald-400/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  not_interested: "border-border bg-muted text-muted-foreground",
  do_not_call: "border-red-400/40 bg-red-500/15 text-red-700 dark:text-red-300",
  bad_number: "border-border bg-muted text-muted-foreground",
};
export const GROUP_LABEL: Record<StatusGroup, string> = {
  active: "Active",
  unknown: "Status unknown",
  lapsing: "Lapsing",
  pending: "Pending",
  dead: "Not in force",
};
export const GROUP_TONE: Record<StatusGroup, string> = {
  active: "border-emerald-400/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  unknown: "border-border bg-muted text-muted-foreground",
  lapsing: "border-amber-400/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  pending: "border-sky-400/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  dead: "border-red-400/40 bg-red-500/10 text-red-700 dark:text-red-300",
};

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
export const PRIORITY_TONE: Record<PriorityTier, string> = {
  1: "border-red-400/40 bg-red-500/15 text-red-700 dark:text-red-300",
  2: "border-sky-400/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  3: "border-amber-400/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  4: "border-violet-400/40 bg-violet-500/15 text-violet-700 dark:text-violet-300",
  5: "border-border bg-muted text-muted-foreground",
  6: "border-border bg-muted text-muted-foreground",
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

export function matchesSearch(p: Pick<BookPolicy, "client_name" | "phone" | "policy_number">, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  if ((p.client_name ?? "").toLowerCase().includes(t)) return true;
  if (p.policy_number.toLowerCase().includes(t)) return true;
  const d = digits(t);
  return d.length >= 3 && digits(p.phone).includes(d);
}

const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);

export function sortPolicies<T extends Pick<BookPolicy, "months_in_force" | "monthly_premium" | "annual_premium" | "face_amount" | "client_name" | "flip_key" | "status_group" | "agent_gone" | "book_status">>(
  list: T[], key: SortKey,
): T[] {
  const name = (p: T) => (p.client_name ?? "").toLowerCase();
  const byDesc = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a);
  const tie = (a: T, b: T) => name(a).localeCompare(name(b)) || a.flip_key.localeCompare(b.flip_key);
  const out = [...list];
  out.sort((a, b) => {
    switch (key) {
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
export function stateCounts<T extends Pick<BookPolicy, "state" | "phone">>(list: readonly T[]): Array<{ code: string; count: number; onFile: number }> {
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
