/**
 * Where to buy leads (OVERHAUL-states, 2026-10-30).
 *
 * Sam: "On Book of Business, show what states I should get, in order: where most of our deals are coming
 * from, so I know where most of my leads are from. I need to rebuy [leads from my vendor] in these states,
 * so I need to know exactly what to get."
 *
 * The database decides every count (supabase/migrations/20261030120000_book_lead_states.sql):
 *   book_state_summary()  the Book of Business counted by the client's state, inside the viewer's scope, so a
 *                         state's numbers are the list it opens and the states add up to the book (the
 *                         policies with no state are their own row, never dropped);
 *   lead_state_yield()    the lead lists by state for the full-book readers: leads bought, leads with no call
 *                         yet, numbers the dialer called and the book policies sold to them.
 * A client's state is on file (client record, sold-call packet or the lead list the number was bought on) or,
 * failing that, the phone's area code, which is a likely state, not a fact; the page always says which.
 *
 * This module holds the pure arithmetic: reading the two answers (a malformed number throws, so the page says
 * the read failed instead of showing a number nobody can trust), the table rows, the three orders, the
 * recommendation (Buy next / Hold / Avoid) and the split of the next lead order. Every rule is a named
 * constant below and every one is tested (src/tests/lib/leadStates.test.ts).
 */
/** The URL and row key for policies whose state is not known. */
export const STATE_NOT_KNOWN = "unknown";

/** The 50 states and DC: the codes a client state can be (territories are not on the area code table). */
const STATE_NAMES = new Map<string, string>([
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"],
  ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"],
  ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
]);
export const STATE_CODES: ReadonlySet<string> = new Set(STATE_NAMES.keys());

export const stateLabel = (code: string | null): string => (code ? STATE_NAMES.get(code) ?? code : "State not known");

/** ?state= from the URL: a two-letter state, "unknown", or no filter. */
export function parseStateParam(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (v.toLowerCase() === STATE_NOT_KNOWN) return STATE_NOT_KNOWN;
  const code = v.toUpperCase();
  return STATE_CODES.has(code) ? code : null;
}

// ── The rules ───────────────────────────────────────────────────────────────────────────────────────────────
/** Below this many policies with an outcome (active, lapsing or gone) a state's own share still active is too
 *  thin to trust, so the split uses the agency's share for it. */
export const MIN_DECIDED_FOR_OWN_SHARE = 10;
/** Avoid: under this share still active, once a state has MIN_DECIDED_FOR_OWN_SHARE outcomes. */
export const AVOID_ACTIVE_SHARE = 0.25;
/** Sales per 100 leads only rank a state once this many of its leads have been dialed; below it the rate
 *  swings too far on one or two sales, so the state ranks by its number of deals. */
export const MIN_DIALED_FOR_RATE = 1000;
/** Hold (not Buy): a state that, with MIN_DIALED_FOR_RATE leads dialed, sells under this share of the
 *  average sales per 100 leads dialed. */
export const WEAK_RATE_SHARE = 0.5;
/** Buy next takes the strongest states until they cover this share of the recent deals, at least BUY_MIN
 *  states (when there are that many) and at most BUY_MAX. */
export const BUY_COVERAGE = 0.8;
export const BUY_MIN = 3;
export const BUY_MAX = 8;
/** The order size the split starts at, and its bounds. */
export const DEFAULT_ORDER_SIZE = 100;
export const MAX_ORDER_SIZE = 100_000;

// ── Reading the database's answers ─────────────────────────────────────────────────────────────────────────
export interface StateSummaryRow {
  state: string | null;
  policies: number;
  on_file: number;
  clients: number;
  annual_premium: number;
  premium_policies: number;
  active: number;
  pending: number;
  lapsing: number;
  gone: number;
  no_status: number;
  last_30_days: number;
  last_90_days: number;
  prior_90_days: number;
  licensed_agents: number;
  active_writers: number;
  /** Rows reported as a total with no client named: they can never have a state. */
  no_client: number;
}

export interface LeadYieldRow {
  state: string | null;
  leads_bought: number;
  never_called: number;
  leads_dialed: number;
  dialed_sales: number;
  area_checked: number;
  area_matched: number;
  calls_since: string | null;
  lists_loaded: string | null;
}

const COUNT_FIELDS = [
  "policies", "on_file", "clients", "premium_policies", "active", "pending", "lapsing", "gone", "no_status",
  "last_30_days", "last_90_days", "prior_90_days", "licensed_agents", "active_writers", "no_client",
] as const;
const YIELD_FIELDS = ["leads_bought", "never_called", "leads_dialed", "dialed_sales", "area_checked", "area_matched"] as const;

function count(row: Record<string, unknown>, field: string): number {
  const n = typeof row[field] === "string" ? Number(row[field]) : row[field];
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw new Error(`The state counts came back without a number for ${field}.`);
  return n;
}

function stateOf(row: Record<string, unknown>): string | null {
  const s = row.state;
  if (s === null || s === undefined) return null;
  if (typeof s !== "string" || !STATE_CODES.has(s)) throw new Error("The state counts came back with a state that is not a US state.");
  return s;
}

/** book_state_summary() rows, checked. Two rows for one state would double count it, so that throws too. */
export function parseStateSummary(data: unknown): StateSummaryRow[] {
  if (!Array.isArray(data)) throw new Error("The state counts returned no result set.");
  const seen = new Set<string>();
  return data.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const state = stateOf(row);
    const key = state ?? STATE_NOT_KNOWN;
    if (seen.has(key)) throw new Error("The state counts listed one state twice.");
    seen.add(key);
    const premium = typeof row.annual_premium === "string" ? Number(row.annual_premium) : row.annual_premium;
    if (typeof premium !== "number" || !Number.isFinite(premium)) throw new Error("The state counts came back without a premium.");
    const out = { state, annual_premium: premium } as StateSummaryRow;
    for (const f of COUNT_FIELDS) (out as unknown as Record<string, number>)[f] = count(row, f);
    if (out.active + out.pending + out.lapsing + out.gone + out.no_status !== out.policies) {
      throw new Error("The state counts do not add up to their policies.");
    }
    return out;
  });
}

/** lead_state_yield() rows, checked the same way. */
export function parseLeadYield(data: unknown): LeadYieldRow[] {
  if (!Array.isArray(data)) throw new Error("The lead lists returned no result set.");
  const seen = new Set<string>();
  return data.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const state = stateOf(row);
    const key = state ?? STATE_NOT_KNOWN;
    if (seen.has(key)) throw new Error("The lead lists listed one state twice.");
    seen.add(key);
    const out = {
      state,
      calls_since: typeof row.calls_since === "string" ? row.calls_since : null,
      lists_loaded: typeof row.lists_loaded === "string" ? row.lists_loaded : null,
    } as LeadYieldRow;
    for (const f of YIELD_FIELDS) (out as unknown as Record<string, number>)[f] = count(row, f);
    return out;
  });
}

// ── The table ───────────────────────────────────────────────────────────────────────────────────────────────
export type TrendKind = "up" | "down" | "flat" | "new" | "none";
export interface Trend {
  kind: TrendKind;
  /** Change of the last 90 days against the 90 before, in whole percent; null for "new" and "none". */
  pct: number | null;
}

/** The last 90 days against the 90 before them. Within 10% either way reads as flat. */
export function stateTrend(last90: number, prior90: number): Trend {
  if (prior90 === 0) return last90 === 0 ? { kind: "none", pct: null } : { kind: "new", pct: null };
  const pct = Math.round(((last90 - prior90) / prior90) * 100);
  return { kind: pct >= 10 ? "up" : pct <= -10 ? "down" : "flat", pct };
}

export interface LeadNumbers {
  bought: number;
  neverCalled: number;
  dialed: number;
  sales: number;
  /** Sales per 100 leads dialed; null when none were dialed. */
  per100: number | null;
}

export interface StateRow {
  /** Two-letter code; null for the policies whose state is not known. */
  code: string | null;
  name: string;
  policies: number;
  /** Policies whose state is on record; the rest are by the phone's area code. */
  onFile: number;
  clients: number;
  premium: number;
  premiumPolicies: number;
  /** Average annual premium of the policies that carry one; null when none does. */
  avgPremium: number | null;
  active: number;
  pending: number;
  lapsing: number;
  gone: number;
  noStatus: number;
  /** Policies with an outcome: active, lapsing or gone (pending and no-status ones are not decided yet). */
  decided: number;
  /** active / decided; null with nothing decided. */
  activeShare: number | null;
  last30: number;
  last90: number;
  prior90: number;
  trend: Trend;
  licensedAgents: number;
  activeWriters: number;
  /** Rows reported as a total with no client (only ever on the not-known row). */
  noClient: number;
  /** null until the lead lists answered, or for a viewer who cannot read them. */
  leads: LeadNumbers | null;
}

function leadNumbers(y: LeadYieldRow): LeadNumbers {
  return {
    bought: y.leads_bought,
    neverCalled: y.never_called,
    dialed: y.leads_dialed,
    sales: y.dialed_sales,
    per100: y.leads_dialed > 0 ? (y.dialed_sales / y.leads_dialed) * 100 : null,
  };
}

/**
 * One row per state: every state in the book, plus a state that only has bought leads (0 policies), so a
 * state Sam bought and never sold in is visible. The not-known row stays whenever it has policies.
 */
export function buildStateRows(summary: readonly StateSummaryRow[], yieldRows?: readonly LeadYieldRow[] | null): StateRow[] {
  const byState = new Map<string, LeadYieldRow>();
  for (const y of yieldRows ?? []) byState.set(y.state ?? STATE_NOT_KNOWN, y);
  const rows: StateRow[] = summary.map((s) => {
    const y = byState.get(s.state ?? STATE_NOT_KNOWN);
    const decided = s.active + s.lapsing + s.gone;
    return {
      code: s.state,
      name: stateLabel(s.state),
      policies: s.policies,
      onFile: s.on_file,
      clients: s.clients,
      premium: s.annual_premium,
      premiumPolicies: s.premium_policies,
      avgPremium: s.premium_policies > 0 ? s.annual_premium / s.premium_policies : null,
      active: s.active,
      pending: s.pending,
      lapsing: s.lapsing,
      gone: s.gone,
      noStatus: s.no_status,
      decided,
      activeShare: decided > 0 ? s.active / decided : null,
      last30: s.last_30_days,
      last90: s.last_90_days,
      prior90: s.prior_90_days,
      trend: stateTrend(s.last_90_days, s.prior_90_days),
      licensedAgents: s.licensed_agents,
      activeWriters: s.active_writers,
      noClient: s.no_client,
      leads: yieldRows ? (y ? leadNumbers(y) : { bought: 0, neverCalled: 0, dialed: 0, sales: 0, per100: null }) : null,
    };
  });
  if (yieldRows) {
    const inBook = new Set(summary.map((s) => s.state ?? STATE_NOT_KNOWN));
    for (const y of yieldRows) {
      if (!y.state || inBook.has(y.state)) continue;
      if (y.leads_bought === 0 && y.leads_dialed === 0) continue;
      rows.push({
        code: y.state, name: stateLabel(y.state), policies: 0, onFile: 0, clients: 0, premium: 0, premiumPolicies: 0,
        avgPremium: null, active: 0, pending: 0, lapsing: 0, gone: 0, noStatus: 0, decided: 0, activeShare: null,
        last30: 0, last90: 0, prior90: 0, trend: stateTrend(0, 0), licensedAgents: 0, activeWriters: 0, noClient: 0, leads: leadNumbers(y),
      });
    }
  }
  return rows;
}

export interface BookTotals {
  policies: number;
  onFile: number;
  byAreaCode: number;
  notKnown: number;
  /** Of the not-known policies, those reported as a total with no client. */
  notKnownNoClient: number;
  premium: number;
  active: number;
  decided: number;
  last90: number;
  last90NotKnown: number;
}

export function totalsOf(rows: readonly StateRow[]): BookTotals {
  const t: BookTotals = { policies: 0, onFile: 0, byAreaCode: 0, notKnown: 0, notKnownNoClient: 0, premium: 0, active: 0, decided: 0, last90: 0, last90NotKnown: 0 };
  for (const r of rows) {
    t.policies += r.policies;
    t.premium += r.premium;
    t.active += r.active;
    t.decided += r.decided;
    t.last90 += r.last90;
    if (r.code === null) {
      t.notKnown += r.policies;
      t.notKnownNoClient += r.noClient;
      t.last90NotKnown += r.last90;
    } else {
      t.onFile += r.onFile;
      t.byAreaCode += r.policies - r.onFile;
    }
  }
  return t;
}

/** The agency's share still active (every state and the not-known row), or null with nothing decided. */
export function agencyActiveShare(rows: readonly StateRow[]): number | null {
  const t = totalsOf(rows);
  return t.decided > 0 ? t.active / t.decided : null;
}

/** Sales per 100 leads dialed across every state, or null with nothing dialed. */
export function averagePer100(rows: readonly StateRow[]): number | null {
  let dialed = 0;
  let sales = 0;
  for (const r of rows) {
    if (!r.leads || r.code === null) continue;
    dialed += r.leads.dialed;
    sales += r.leads.sales;
  }
  return dialed > 0 ? (sales / dialed) * 100 : null;
}

// ── Orders ──────────────────────────────────────────────────────────────────────────────────────────────────
export type StateOrder = "deals" | "recent" | "per_lead";
export const STATE_ORDERS: readonly { key: StateOrder; label: string }[] = [
  { key: "deals", label: "Most deals" },
  { key: "recent", label: "Most in the last 90 days" },
  { key: "per_lead", label: "Best sales per lead" },
];

export function parseStateOrder(value: string | null | undefined): StateOrder {
  return value === "recent" || value === "per_lead" ? value : "deals";
}

/** True when this state's sales per 100 leads rank it (enough of its leads were dialed). */
export const rankedByRate = (r: StateRow): boolean => Boolean(r.leads && r.leads.dialed >= MIN_DIALED_FOR_RATE && r.leads.per100 !== null);

const byName = (a: StateRow, b: StateRow) => a.name.localeCompare(b.name);

/**
 * The table's order. Most deals: policies, then the last 90 days. Most in the last 90 days: the reverse.
 * Best sales per lead: the states with MIN_DIALED_FOR_RATE leads dialed by sales per 100 leads dialed, then
 * every other state by its number of deals. The not-known row is always last.
 */
export function sortStateRows(rows: readonly StateRow[], order: StateOrder): StateRow[] {
  const known = rows.filter((r) => r.code !== null);
  const unknown = rows.filter((r) => r.code === null);
  const deals = (a: StateRow, b: StateRow) => b.policies - a.policies || b.last90 - a.last90 || byName(a, b);
  const recent = (a: StateRow, b: StateRow) => b.last90 - a.last90 || b.policies - a.policies || byName(a, b);
  let sorted: StateRow[];
  if (order === "per_lead") {
    const rated = known.filter(rankedByRate).sort((a, b) => (b.leads?.per100 ?? 0) - (a.leads?.per100 ?? 0) || (b.leads?.sales ?? 0) - (a.leads?.sales ?? 0) || deals(a, b));
    const rest = known.filter((r) => !rankedByRate(r)).sort(deals);
    sorted = [...rated, ...rest];
  } else {
    sorted = [...known].sort(order === "recent" ? recent : deals);
  }
  return [...sorted, ...unknown];
}

// ── The recommendation ──────────────────────────────────────────────────────────────────────────────────────
export interface BuyPick {
  code: string;
  name: string;
  last90: number;
  /** The share still active used in the weight: the state's own, or the agency's (ownShare false). */
  share: number;
  ownShare: boolean;
  weight: number;
  leads: number;
}

export interface HoldPick {
  code: string;
  name: string;
  reason: string;
}

export interface Recommendation {
  orderSize: number;
  buy: BuyPick[];
  hold: HoldPick[];
  avoid: HoldPick[];
  /** Sum of the Buy states' weights: the denominator of every split. */
  totalWeight: number;
  /** The agency's share still active, used for the thin states; null with nothing decided. */
  agencyShare: number | null;
  /** Sales per 100 leads dialed across the states; null without the lead lists. */
  averagePer100: number | null;
  /** False when no state carries any licensing evidence, so nothing was held back for licensing. */
  licensingApplied: boolean;
}

const pct = (share: number) => `${Math.round(share * 100)}%`;
const per100Text = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));

/** The reason most held states share: they made the list, just below the states to buy. */
export const HOLD_BELOW_CUT = "Fewer recent deals than the states to buy";

/**
 * Splits `total` leads across weighted states by the largest remainder: each state gets the whole part of its
 * share, and the leads left over go to the biggest fractions (ties: the bigger weight, then the code), so the
 * split always adds up to exactly `total`. A state whose share rounds to nothing gets 0.
 */
export function splitOrder(items: readonly { code: string; weight: number }[], total: number): { code: string; leads: number }[] {
  const n = Math.max(0, Math.floor(total));
  const sum = items.reduce((a, i) => a + Math.max(0, i.weight), 0);
  if (n === 0 || sum <= 0) return items.map((i) => ({ code: i.code, leads: 0 }));
  const quotas = items.map((i, idx) => {
    const exact = (n * Math.max(0, i.weight)) / sum;
    return { idx, code: i.code, weight: Math.max(0, i.weight), leads: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let left = n - quotas.reduce((a, q) => a + q.leads, 0);
  const byFrac = [...quotas].sort((a, b) => b.frac - a.frac || b.weight - a.weight || a.code.localeCompare(b.code));
  for (const q of byFrac) {
    if (left <= 0) break;
    q.leads += 1;
    left -= 1;
  }
  return quotas.sort((a, b) => a.idx - b.idx).map((q) => ({ code: q.code, leads: q.leads }));
}

/** "TX 31, OH 18, CA 14": the plain list a vendor reads, biggest first, states with 0 left out. */
export function orderText(buy: readonly BuyPick[]): string {
  return buy.filter((b) => b.leads > 0).map((b) => `${b.code} ${b.leads.toLocaleString("en-US")}`).join(", ");
}

/** A whole number of leads between 1 and MAX_ORDER_SIZE, or the default for anything else. */
export function parseOrderSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_ORDER_SIZE;
  return Math.min(MAX_ORDER_SIZE, Math.floor(n));
}

/**
 * Buy next, Hold and Avoid, and the split of the next order.
 *
 *   weight = deals in the last 90 days x the share still active (the agency's share for a state with fewer
 *            than MIN_DECIDED_FOR_OWN_SHARE policies decided)
 *   Avoid  no deal in 180 days (with policies on the book or leads dialed), or under AVOID_ACTIVE_SHARE still
 *          active with MIN_DECIDED_FOR_OWN_SHARE or more decided
 *   Hold   everything else that is not bought: no deal in the last 90 days, no active agent known to be
 *          licensed there (only when any state carries licensing evidence), selling under WEAK_RATE_SHARE of
 *          the average per lead with MIN_DIALED_FOR_RATE dialed, never called yet, or below the cut
 *   Buy    the strongest by weight until BUY_COVERAGE of the eligible weight is covered (BUY_MIN to BUY_MAX)
 */
export function recommend(rows: readonly StateRow[], orderSizeInput: number): Recommendation {
  const orderSize = parseOrderSize(orderSizeInput);
  const agencyShare = agencyActiveShare(rows);
  const avgPer100 = averagePer100(rows);
  const licensingApplied = rows.some((r) => r.code !== null && (r.licensedAgents > 0 || r.activeWriters > 0));
  const hold: HoldPick[] = [];
  const avoid: HoldPick[] = [];
  const candidates: Omit<BuyPick, "leads">[] = [];

  for (const r of rows) {
    if (r.code === null) continue;
    const dialed = r.leads?.dialed ?? 0;
    const bought = r.leads?.bought ?? 0;
    if (r.policies === 0 && dialed === 0 && bought === 0) continue;
    const pick = { code: r.code, name: r.name };
    if (r.last90 + r.prior90 === 0) {
      if (r.policies > 0) avoid.push({ ...pick, reason: "No deals in 180 days" });
      else if (dialed > 0) avoid.push({ ...pick, reason: `No deals from ${dialed.toLocaleString("en-US")} leads dialed` });
      else hold.push({ ...pick, reason: `Not tested: none of its ${bought.toLocaleString("en-US")} leads called yet` });
      continue;
    }
    if (r.decided >= MIN_DECIDED_FOR_OWN_SHARE && r.activeShare !== null && r.activeShare < AVOID_ACTIVE_SHARE) {
      avoid.push({ ...pick, reason: `Only ${pct(r.activeShare)} still active (${r.active} of ${r.decided})` });
      continue;
    }
    if (r.last90 === 0) {
      hold.push({ ...pick, reason: "No deals in the last 90 days" });
      continue;
    }
    if (licensingApplied && r.licensedAgents === 0 && r.activeWriters === 0) {
      hold.push({ ...pick, reason: "No active agent known to be licensed here" });
      continue;
    }
    if (avgPer100 !== null && r.leads && rankedByRate(r) && (r.leads.per100 ?? 0) < WEAK_RATE_SHARE * avgPer100) {
      hold.push({ ...pick, reason: `${per100Text(r.leads.per100 ?? 0)} sales per 100 leads dialed, under half the ${per100Text(avgPer100)} average` });
      continue;
    }
    const ownShare = r.decided >= MIN_DECIDED_FOR_OWN_SHARE && r.activeShare !== null;
    const share = ownShare ? (r.activeShare as number) : agencyShare ?? 1;
    candidates.push({ code: r.code, name: r.name, last90: r.last90, share, ownShare, weight: r.last90 * share });
  }

  candidates.sort((a, b) => b.weight - a.weight || b.last90 - a.last90 || a.code.localeCompare(b.code));
  const eligible = candidates.reduce((a, c) => a + c.weight, 0);
  const chosen: Omit<BuyPick, "leads">[] = [];
  let covered = 0;
  for (const c of candidates) {
    if (chosen.length >= BUY_MAX) break;
    if (chosen.length >= Math.min(BUY_MIN, candidates.length) && covered >= BUY_COVERAGE * eligible) break;
    chosen.push(c);
    covered += c.weight;
  }
  for (const c of candidates.slice(chosen.length)) hold.push({ code: c.code, name: c.name, reason: HOLD_BELOW_CUT });

  const split = splitOrder(chosen.map((c) => ({ code: c.code, weight: c.weight })), orderSize);
  const buy = chosen.map((c, i) => ({ ...c, leads: split[i].leads }));
  const byRows = (a: HoldPick, b: HoldPick) => {
    const ra = rows.find((r) => r.code === a.code);
    const rb = rows.find((r) => r.code === b.code);
    return (rb?.policies ?? 0) - (ra?.policies ?? 0) || a.code.localeCompare(b.code);
  };
  return {
    orderSize,
    buy,
    hold: hold.sort(byRows),
    avoid: avoid.sort(byRows),
    totalWeight: chosen.reduce((a, c) => a + c.weight, 0),
    agencyShare,
    averagePer100: avgPer100,
    licensingApplied,
  };
}

/** The split's math in one line, worked for the first state: "TX: 29 deals x 41% = 11.9 of 38.2 -> 31 of 100." */
export function splitMath(rec: Recommendation): string | null {
  const top = rec.buy[0];
  if (!top || rec.totalWeight <= 0) return null;
  const share = `${pct(top.share)}${top.ownShare ? "" : " (agency)"}`;
  return `${top.code}: ${top.last90} ${top.last90 === 1 ? "deal" : "deals"} × ${share} = ${top.weight.toFixed(1)} of ${rec.totalWeight.toFixed(1)} → ${top.leads.toLocaleString("en-US")} of ${rec.orderSize.toLocaleString("en-US")}`;
}

/** Cost of one sale at a price per lead, if every lead bought gets dialed: price x dialed / sales. */
export function costPerSale(pricePerLead: number | null, leads: LeadNumbers | null): number | null {
  if (pricePerLead === null || !Number.isFinite(pricePerLead) || pricePerLead <= 0 || !leads || leads.sales === 0) return null;
  return (pricePerLead * leads.dialed) / leads.sales;
}

/** A price per lead typed by the viewer ("0.35", "$1.20"), or null when blank or not a positive amount. */
export function parsePrice(value: string | null | undefined): number | null {
  const v = (value ?? "").replace(/[$,\s]/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 10_000 ? n : null;
}

/** How often the area code names the lead list's state, across the lead lists: { matched, checked }. */
export function areaCodeAccuracy(yieldRows: readonly LeadYieldRow[] | null | undefined): { matched: number; checked: number } | null {
  if (!yieldRows) return null;
  let matched = 0;
  let checked = 0;
  for (const y of yieldRows) {
    matched += y.area_matched;
    checked += y.area_checked;
  }
  return checked > 0 ? { matched, checked } : null;
}
