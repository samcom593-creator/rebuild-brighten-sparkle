// Easy resells (2026-10-16): one ranked list of the people easiest to resell, read from easy_resells().
// Sam: "all pages overwhelming so much info to crawl, hard to prioritize easy resells like everyone
// under vantage". The database keeps one row per phone and sorts by kind (tier 1 easiest); since
// OVERHAUL-resells (2026-10-29) the page ranks by evidence first (src/lib/resellEvidence.ts) and the
// kind breaks ties. These are the shared display rules for the page and its tests.
import type { EvidenceSubject } from "@/lib/resellEvidence";
import { resellBucketTone, tonePill } from "@/lib/tones";

export type ResellBucket = "ready_to_finish" | "sold_not_booked" | "lapsing" | "dropped" | "vantage" | "agent_left" | "warm_objection";

/** The react-query key for the list. Every page that marks a person marks it stale, so the queue never shows someone just closed. */
export const EASY_RESELLS_KEY = "easy-resells";

/** Book outcomes that take a person off the queue, the same rule as easy_resells()'s blocked set. */
export function closesBookRow(flipStatus: string, callbackAt: string | null | undefined, now: Date = new Date()): boolean {
  if (["resold", "not_interested", "do_not_call", "bad_number", "appointment"].includes(flipStatus)) return true;
  return flipStatus === "callback" && !!callbackAt && Date.parse(callbackAt) > now.getTime();
}

/** Call outcomes that take a person off the queue. */
export const closesCallRow = (status: string): boolean => status === "resold" || status === "pushback";

export interface EasyResell {
  item_key: string;
  bucket: ResellBucket;
  tier: number;
  reason: string;
  client_name: string | null;
  phone: string | null;
  state: string | null;
  age_years: number | null;
  carrier: string | null;
  product: string | null;
  monthly_premium: number | null;
  policy_status: string | null;
  agent_name: string | null;
  agent_group: string | null;
  event_at: string | null;
  /** Set on a sold or objection call (marked with sold_call_set_status). */
  call_id: string | null;
  work_status: string | null;
  /** Set on a book policy (marked with book_flip_set, the same record Book Flips shows). */
  flip_carrier: string | null;
  flip_policy_number: string | null;
  flip_client_key: string | null;
  flip_status: string | null;
  callback_at: string | null;
  attempts: number | null;
  last_touch_at: string | null;
  /** Date of birth on file, for the deal form. */
  dob: string | null;
  /** The sold call's booking packet; Resold books it, as Sold Calls does. */
  packet_id: string | null;
}

/** What each bucket is called on a row, easiest first. */
export const BUCKET_LABEL: Record<ResellBucket, string> = {
  ready_to_finish: "Ready to finish",
  sold_not_booked: "Bought, never booked",
  lapsing: "Lapsing",
  dropped: "Dropped",
  vantage: "Vantage client",
  agent_left: "Agent left",
  warm_objection: "Warm call",
};

/** Each kind's pill, in its tone (src/lib/tones.ts resellBucketTone): the words always beside the colour. */
export const BUCKET_TONE: Record<ResellBucket, string> = {
  ready_to_finish: tonePill(resellBucketTone("ready_to_finish")),
  sold_not_booked: tonePill(resellBucketTone("sold_not_booked")),
  lapsing: tonePill(resellBucketTone("lapsing")),
  dropped: tonePill(resellBucketTone("dropped")),
  vantage: tonePill(resellBucketTone("vantage")),
  agent_left: tonePill(resellBucketTone("agent_left")),
  warm_objection: tonePill(resellBucketTone("warm_objection")),
};

export type ResellFilter = "all" | "vantage_any" | ResellBucket;

/**
 * The chips, in order. "Everyone under Vantage" cuts across buckets (a lapsing Vantage policy is
 * still lapsing), so the 4th-tier "vantage" bucket has no chip of its own.
 */
export const RESELL_FILTERS: Array<{ key: ResellFilter; label: string }> = [
  { key: "all", label: "Everyone" },
  { key: "ready_to_finish", label: "Ready to finish" },
  // 2026-10-29 (MP-310): bought on a dialer call and never booked, without both SSN and bank on the call.
  { key: "sold_not_booked", label: "Bought, never booked" },
  { key: "lapsing", label: "Lapsing" },
  { key: "dropped", label: "Dropped" },
  { key: "vantage_any", label: "Everyone under Vantage" },
  { key: "agent_left", label: "Agent left" },
  { key: "warm_objection", label: "Warm calls" },
];

export function matchesResellFilter(r: Pick<EasyResell, "bucket" | "agent_group">, f: ResellFilter): boolean {
  if (f === "all") return true;
  if (f === "vantage_any") return r.agent_group === "Vantage";
  return r.bucket === f;
}

export function resellCounts(list: readonly Pick<EasyResell, "bucket" | "agent_group">[]): Record<ResellFilter, number> {
  const out = Object.fromEntries(RESELL_FILTERS.map((f) => [f.key, 0])) as Record<ResellFilter, number>;
  out.vantage = 0;
  for (const r of list) {
    out.all += 1;
    out[r.bucket] = (out[r.bucket] ?? 0) + 1;
    if (r.agent_group === "Vantage") out.vantage_any += 1;
  }
  return out;
}

const digitsOf = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Name, agent or carrier text, or 4+ digits of the phone. */
export function matchesResellSearch(r: Pick<EasyResell, "client_name" | "phone" | "agent_name" | "carrier">, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const d = digitsOf(t);
  if (d.length >= 4 && digitsOf(r.phone).includes(d)) return true;
  return [r.client_name, r.agent_name, r.carrier].some((v) => (v ?? "").toLowerCase().includes(t));
}

/**
 * The database's order, re-applied after paging so it never depends on how pages arrive: easiest tier
 * first; inside a tier, people nobody has called yet, then the ones called longest ago; newest first.
 */
export function sortResells<T extends Pick<EasyResell, "tier" | "last_touch_at" | "event_at" | "item_key">>(list: readonly T[]): T[] {
  const t = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  return [...list].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const at = t(a.last_touch_at), bt = t(b.last_touch_at);
    const aTouched = !Number.isNaN(at), bTouched = !Number.isNaN(bt);
    if (aTouched !== bTouched) return aTouched ? 1 : -1;
    if (aTouched && bTouched && at !== bt) return at - bt;
    const ae = t(a.event_at), be = t(b.event_at);
    if (!Number.isNaN(ae) || !Number.isNaN(be)) {
      if (Number.isNaN(ae)) return 1;
      if (Number.isNaN(be)) return -1;
      if (ae !== be) return be - ae;
    }
    return a.item_key.localeCompare(b.item_key);
  });
}

/**
 * What the evidence is asked about one row: its number and name, and, for a lapsing book policy, the
 * book's status and the day the policy started (event_at is the effective or posted date on book rows).
 */
export function resellSubject(r: Pick<EasyResell, "bucket" | "phone" | "client_name" | "policy_status" | "event_at">): EvidenceSubject {
  return {
    phone: r.phone,
    fullName: r.client_name,
    lapse: r.bucket === "lapsing" ? { status: r.policy_status, startedOn: r.event_at } : null,
  };
}

/**
 * The page's order (OVERHAUL-resells): the most evidence first; between equal scores, the database's
 * order (sortResells: easiest kind, nobody called yet, longest since a call, newest).
 */
export function rankResells<T extends Pick<EasyResell, "tier" | "last_touch_at" | "event_at" | "item_key">>(
  list: readonly T[],
  scoreOf: (row: T) => number,
): T[] {
  const base = sortResells(list);
  const position = new Map(base.map((r, i) => [r.item_key, i]));
  return base.sort((a, b) => scoreOf(b) - scoreOf(a) || (position.get(a.item_key) ?? 0) - (position.get(b.item_key) ?? 0));
}

const WORK_WORD: Record<string, string> = { contacted: "Contacted", pushed: "Pushed", resold: "Resold", pushback: "Pushback" };
const FLIP_WORD: Record<string, string> = { no_answer: "No answer", callback: "Callback", to_call: "" };

function ago(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** "Contacted 2h ago", "No answer ×2 · 3d ago", "Callback due": where a person stands, or "" if untouched. */
export function touchedText(r: Pick<EasyResell, "work_status" | "flip_status" | "attempts" | "last_touch_at" | "callback_at">, now: Date = new Date()): string {
  if (r.flip_status === "callback") return r.callback_at && Date.parse(r.callback_at) <= now.getTime() ? "Callback due" : "Callback set";
  const word = (r.work_status && WORK_WORD[r.work_status]) || (r.flip_status && FLIP_WORD[r.flip_status]) || "";
  const times = r.flip_status === "no_answer" && (r.attempts ?? 0) > 1 ? ` ×${r.attempts}` : "";
  const when = r.last_touch_at ? ago(r.last_touch_at, now) : "";
  if (!word && !when) return "";
  return [`${word || "Called"}${times}`, when].filter(Boolean).join(" · ");
}
