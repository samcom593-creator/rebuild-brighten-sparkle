// Ayro Financial book of business (2026-10-20). Sam: "give me a book of business screen for
// Ayro Financial ... all names, carriers ... arrange by carriers". Every policy the Ayro CRM
// (el.ayrofinancial.com) lists comes in through ayro-sales-sync.mjs every 20 minutes and is read
// back here through ayro_book(). Grouping, totals and the period filter live here so the page
// stays a renderer and the rules are testable.

export interface AyroDeal {
  id: string;
  policy_number: string | null;
  carrier: string;
  carrier_entered: string | null;
  agent_name: string;
  apex_agent_id: string | null;
  apex_agent_name: string | null;
  on_apex_team: boolean;
  /** The production rule: false for Ayro-only producers who are roster-excluded from our totals. */
  counts_in_production: boolean;
  annual_premium: number;
  monthly_premium: number | null;
  face_amount: number | null;
  product: string | null;
  status: string | null;
  ayro_status: string | null;
  submitted_at: string;
  posted_date: string | null;
  first_seen_at: string | null;
}

/** Ayro's own count for All Time, written by the sync each run, so the page can show both sides. */
export interface AyroSync {
  ok: boolean;
  error: string | null;
  at: string | null;
  updated_at: string | null;
  feed_rows: number | null;
  ayro_policies: number | null;
  ayro_premium: number | null;
  ayro_active_agents: number | null;
}

export interface AyroBookPayload {
  deals: AyroDeal[];
  sync: AyroSync | null;
}

export const AYRO_BOOK_KEY = "ayro-book";
export const ALL = "all";

/**
 * Phone lines and agent portals exactly as Ayro's "Carrier / Contracts Info" page lists them
 * (read 2026-10-20). Carriers Ayro does not list get nothing rather than a number from memory.
 */
export const AYRO_CARRIER_CONTACTS: Record<string, { phone?: string; portal?: string }> = {
  Aflac: { phone: "8335040336", portal: "https://www.sellaflacseniorplans.com/" },
  "American Amicable": { phone: "8007367311", portal: "https://www.americanamicable.com/v4/AgentLogin.php" },
  Ethos: { phone: "8779138467", portal: "https://agents.ethoslife.com/login" },
  "Mutual of Omaha": { phone: "8007757896", portal: "https://login.mutualofomaha.com" },
  Chubb: { phone: "8016589911", portal: "https://chubb.insuranceadmin.com/login" },
  "Baltimore Life": { phone: "8775332468", portal: "https://agentportal.baltlife.com" },
};

export type PeriodKey = "all" | "today" | "this_week" | "this_month" | "last_month";
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_week", label: "This week" },
  { key: "today", label: "Today" },
];

export type SortKey = "newest" | "premium" | "agent";
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "premium", label: "Biggest premium" },
  { key: "agent", label: "Agent A to Z" },
];

const PHOENIX_OFFSET_MS = 7 * 3600_000; // Arizona has no daylight saving time.

/** The Phoenix calendar day (YYYY-MM-DD) of a moment. */
export function phoenixDay(iso: string | Date): string {
  const t = (iso instanceof Date ? iso : new Date(iso)).getTime();
  return new Date(t - PHOENIX_OFFSET_MS).toISOString().slice(0, 10);
}

/** Inclusive [from, to] Phoenix days for a period, or null for all time. Weeks start Monday. */
export function periodBounds(period: PeriodKey, now: Date = new Date()): [string, string] | null {
  if (period === "all") return null;
  const today = phoenixDay(now);
  const [y, m, d] = today.split("-").map(Number);
  const day = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  if (period === "today") return [today, today];
  if (period === "this_month") return [day(y, m, 1), today];
  if (period === "last_month") return [day(y, m - 1, 1), day(y, m, 0)];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday
  const back = (dow + 6) % 7;
  return [day(y, m, d - back), today];
}

export function inPeriod(deal: AyroDeal, period: PeriodKey, now: Date = new Date()): boolean {
  const b = periodBounds(period, now);
  if (!b) return true;
  const dDay = phoenixDay(deal.submitted_at);
  return dDay >= b[0] && dDay <= b[1];
}

export function matchesSearch(deal: AyroDeal, search: string): boolean {
  const s = search.trim().toLowerCase();
  if (!s) return true;
  return [deal.policy_number, deal.agent_name, deal.apex_agent_name, deal.carrier, deal.carrier_entered, deal.ayro_status]
    .some((v) => (v ?? "").toLowerCase().includes(s));
}

/** The leading letters of a policy number ("TA", "FEXB", "ACC"), or "7GG" for digit-led ones. */
export function policyPrefix(policy: string | null): string | null {
  const p = (policy ?? "").trim().toUpperCase();
  const m = p.match(/^[A-Z]+/) ?? p.match(/^\d[A-Z]+/);
  return m ? m[0] : null;
}

/**
 * Agents type the carrier by hand in Ayro, and a few rows name a carrier whose policy numbers
 * look like another carrier's. Flag a row when at least 3 other policies in this same book share
 * its prefix and they all sit under one different carrier. It is a "check this" note built from
 * the book itself, never a correction.
 */
export function carrierChecks(deals: AyroDeal[]): Map<string, string> {
  const byPrefix = new Map<string, Map<string, number>>();
  for (const d of deals) {
    const p = policyPrefix(d.policy_number);
    if (!p) continue;
    const m = byPrefix.get(p) ?? new Map<string, number>();
    m.set(d.carrier, (m.get(d.carrier) ?? 0) + 1);
    byPrefix.set(p, m);
  }
  const out = new Map<string, string>();
  for (const d of deals) {
    const p = policyPrefix(d.policy_number);
    if (!p) continue;
    const others = [...(byPrefix.get(p) ?? new Map<string, number>()).entries()].filter(([c]) => c !== d.carrier);
    if (others.length !== 1) continue;
    const [carrier, n] = others[0];
    if (n >= 3) out.set(d.id, `Policy # starts like ${n} ${carrier} policies. Check the carrier.`);
  }
  return out;
}

export interface CarrierGroup {
  carrier: string;
  deals: AyroDeal[];
  policies: number;
  premium: number;
  agents: string[];
  share: number;
  newest: string | null;
}

export function sortDeals(deals: AyroDeal[], sort: SortKey): AyroDeal[] {
  const out = [...deals];
  if (sort === "premium") out.sort((a, b) => b.annual_premium - a.annual_premium || b.submitted_at.localeCompare(a.submitted_at));
  else if (sort === "agent") out.sort((a, b) => a.agent_name.localeCompare(b.agent_name, undefined, { sensitivity: "base" }) || b.submitted_at.localeCompare(a.submitted_at));
  else out.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  return out;
}

/** Carriers ordered by premium, biggest first; "Carrier not given" always last. */
export function groupByCarrier(deals: AyroDeal[], sort: SortKey = "newest"): CarrierGroup[] {
  const total = deals.reduce((s, d) => s + d.annual_premium, 0);
  const map = new Map<string, AyroDeal[]>();
  for (const d of deals) map.set(d.carrier, [...(map.get(d.carrier) ?? []), d]);
  return [...map.entries()]
    .map(([carrier, list]) => {
      const premium = list.reduce((s, d) => s + d.annual_premium, 0);
      return {
        carrier,
        deals: sortDeals(list, sort),
        policies: list.length,
        premium,
        agents: [...new Set(list.map((d) => d.agent_name))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
        share: total > 0 ? premium / total : 0,
        newest: list.reduce<string | null>((m, d) => (m && m > d.submitted_at ? m : d.submitted_at), null),
      };
    })
    .sort((a, b) => {
      const an = a.carrier === "Carrier not given" ? 1 : 0;
      const bn = b.carrier === "Carrier not given" ? 1 : 0;
      return an - bn || b.premium - a.premium || a.carrier.localeCompare(b.carrier);
    });
}

export interface AgentRow {
  agent: string;
  counts: boolean;
  policies: number;
  premium: number;
  carriers: { carrier: string; policies: number }[];
  first: string;
  last: string;
}

export function agentRows(deals: AyroDeal[]): AgentRow[] {
  const map = new Map<string, AyroDeal[]>();
  for (const d of deals) map.set(d.agent_name, [...(map.get(d.agent_name) ?? []), d]);
  return [...map.entries()]
    .map(([agent, list]) => {
      const counts = new Map<string, number>();
      for (const d of list) counts.set(d.carrier, (counts.get(d.carrier) ?? 0) + 1);
      const times = list.map((d) => d.submitted_at).sort();
      return {
        agent,
        counts: list.some((d) => d.counts_in_production),
        policies: list.length,
        premium: list.reduce((s, d) => s + d.annual_premium, 0),
        carriers: [...counts.entries()].map(([carrier, policies]) => ({ carrier, policies })).sort((a, b) => b.policies - a.policies),
        first: times[0],
        last: times[times.length - 1],
      };
    })
    .sort((a, b) => b.premium - a.premium);
}

export function totals(deals: AyroDeal[]) {
  const premium = deals.reduce((s, d) => s + d.annual_premium, 0);
  const counted = deals.filter((d) => d.counts_in_production).reduce((s, d) => s + d.annual_premium, 0);
  return {
    policies: deals.length,
    premium,
    counted,
    average: deals.length ? premium / deals.length : 0,
    agents: new Set(deals.map((d) => d.agent_name)).size,
    carriers: new Set(deals.map((d) => d.carrier)).size,
  };
}

/** Whole dollars, the way Ayro shows premium. */
export function dollars(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** "Oct 19, 2:59 PM" in Phoenix time. */
export function phoenixMoment(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" });
}

/**
 * Does our count match Ayro's? Ayro rounds each premium on its header, so a few dollars apart
 * on the total still counts as matching; the policy count must be exact.
 */
export function reconcile(deals: AyroDeal[], sync: AyroSync | null): { matches: boolean; text: string } | null {
  if (!sync || sync.ayro_policies == null) return null;
  const t = totals(deals);
  const premiumGap = sync.ayro_premium == null ? 0 : Math.abs(t.premium - sync.ayro_premium);
  const matches = t.policies === sync.ayro_policies && premiumGap <= Math.max(5, t.policies);
  const ayro = `Ayro shows ${sync.ayro_policies} ${sync.ayro_policies === 1 ? "policy" : "policies"}${sync.ayro_premium != null ? ` / ${dollars(sync.ayro_premium)}` : ""}`;
  return {
    matches,
    text: matches
      ? `${ayro}. Every one is here.`
      : `${ayro}, this page has ${t.policies} / ${dollars(t.premium)}. The next sync should close the gap; if it does not, the sync is missing rows.`,
  };
}
