/**
 * Commissions dashboard (MP-COMMISSIONS-REDO, 2026-11-27): the pure rules behind the Finances > Commissions tab.
 *
 * Sam: "redo the commissions dashboard." Measured first: the old tab reconciled commission_ledger (170 rows for
 * 16 agents, none since 2026-10-10, 166 pending summing to about $440 at 0 to 0.5 percent override rates)
 * against contract estimates, so an agent read footnotes about a dead ledger. There is still no carrier-paid
 * feed (agentlink_commissions 0 rows). What is true: posted production priced at the agent's contract rate,
 * the carrier portal book (Ethos and Chubb) that says whether a policy is in force, pending or lost, carrier
 * chargebacks, and the Ethos production snapshot.
 *
 * One server call, commissions_dashboard(p_agent_id), returns the payload parsed here. Rules:
 *   - estimate amounts are null whenever the contract rate is not on file; the page then shows premium only
 *     and says why, never a default rate dressed as a figure (same rule as before);
 *   - every deal carries a LANE from the carrier book; a carrier without a feed is its own lane, and a deal
 *     the feed has not had time to show is "awaiting", never "not found";
 *   - nothing here is money received; the copy says "estimated" and the footer says what a paid feed would add.
 * Kept free of React and Supabase so the parser, filters, CSV and wording are unit tested.
 */

export type Lane = "in_force" | "pending" | "awaiting_feed" | "not_in_feed" | "lost" | "no_feed";

export const LANES: Lane[] = ["in_force", "pending", "awaiting_feed", "not_in_feed", "lost", "no_feed"];

export const LANE_META: Record<Lane, { label: string; hint: string; tone: "success" | "info" | "muted" | "warning" | "danger" }> = {
  in_force: { label: "In force", hint: "The carrier portal shows this policy active.", tone: "success" },
  pending: { label: "Pending with carrier", hint: "The carrier portal shows it started or pending, or at risk.", tone: "info" },
  awaiting_feed: { label: "Awaiting carrier feed", hint: "Posted after the portal was last read, or inside the last 14 days. Not a verdict yet.", tone: "muted" },
  not_in_feed: { label: "Not found in portal", hint: "The carrier has a feed, the portal was read after this deal, and it is not there. Check the policy number.", tone: "warning" },
  lost: { label: "Lapsed or not taken", hint: "The carrier portal, or the deal record, says this policy is lapsed, cancelled, declined, withdrawn or not taken.", tone: "danger" },
  no_feed: { label: "No carrier feed", hint: "This carrier is not read from a portal yet, so the status is only what was posted.", tone: "muted" },
};

export interface LaneFigures {
  n: number;
  ap: number;
  /** Null when the contract rate is not on file. */
  est: number | null;
}

export interface DashboardDeal {
  row_key: string;
  posted_date: string | null;
  client_name: string | null;
  carrier: string | null;
  product: string | null;
  policy_number: string | null;
  annual_premium: number | null;
  est: number | null;
  deal_status: string | null;
  origin: string | null;
  lane: Lane;
  book_carrier: string | null;
  status_bucket: string | null;
  status_raw: string | null;
  status_changed_on: string | null;
  issued_on: string | null;
  lost_on: string | null;
  close_reason: string | null;
}

export interface MonthRow {
  /** "YYYY-MM" */
  month: string;
  deals: number;
  ap: number;
  est: number | null;
  est_in_force: number | null;
  est_pending: number | null;
  est_lost: number | null;
  est_unknown: number | null;
}

export interface Chargeback {
  carrier: string | null;
  policy_number: string | null;
  amount: number | null;
  original_amount: number | null;
  chargeback_on: string | null;
  reason: string | null;
  status: string | null;
}

export interface EthosFacts {
  snapshot_on: string | null;
  issued_annual_premium: number | null;
  inforce_issued_premium: number | null;
  persistency_m4: number | null;
  persistency_m7: number | null;
  persistency_m13: number | null;
  outstanding_chargeback: number | null;
  on_advanced_pay: boolean | null;
}

export interface DashboardKpis {
  mtd_est: number | null;
  mtd_deals: number;
  mtd_ap: number;
  last_month_est: number | null;
  last_month_deals: number;
  ytd_est: number | null;
  ytd_deals: number;
  ytd_ap: number;
  deals_12m: number;
  ap_12m: number;
  est_12m: number | null;
  lanes: Record<Lane, LaneFigures>;
}

export interface CommissionsDashboardData {
  ok: true;
  as_of: string;
  today: string;
  agent: {
    agent_id: string;
    name: string;
    npn: string | null;
    rate_pct: number | null;
    rate_provenance: string | null;
    rate_on_file: boolean;
    record_ids: string[];
  };
  kpis: DashboardKpis;
  months: MonthRow[];
  deals: DashboardDeal[];
  chargebacks: Chargeback[];
  chargeback_open_total: number;
  ethos: EthosFacts | null;
  book: { last_run_at: string | null; last_read_on: string | null; carriers: string[] };
  sources: { commission_ledger_rows: number; paid_feed: boolean };
}

export interface CommissionsDashboardEmpty {
  ok: false;
  reason: string;
  as_of: string;
}

export type CommissionsDashboardPayload = CommissionsDashboardData | CommissionsDashboardEmpty;

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function needNumber(v: unknown, field: string): number {
  const n = num(v);
  if (n === null) throw new Error(`The commissions dashboard returned a ${field} that is not a number.`);
  return n;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function laneOf(v: unknown): Lane {
  return typeof v === "string" && (LANES as string[]).includes(v) ? (v as Lane) : "no_feed";
}

function parseLaneFigures(v: unknown, field: string): LaneFigures {
  if (!isRecord(v)) throw new Error(`The commissions dashboard returned no ${field} figures.`);
  return { n: needNumber(v.n, `${field} count`), ap: needNumber(v.ap, `${field} premium`), est: num(v.est) };
}

/** Throws on any shape the page does not understand: a wrong read must never render as an empty or zero book. */
export function parseCommissionsDashboard(value: unknown): CommissionsDashboardPayload {
  if (!isRecord(value)) throw new Error("The commissions dashboard returned nothing this page understands.");
  if (value.ok === false) {
    return { ok: false, reason: str(value.reason) ?? "unavailable", as_of: str(value.as_of) ?? "" };
  }
  if (value.ok !== true || !isRecord(value.agent) || !isRecord(value.kpis) || !isRecord(value.kpis.lanes)
      || !Array.isArray(value.months) || !Array.isArray(value.deals) || !Array.isArray(value.chargebacks) || !isRecord(value.book) || !isRecord(value.sources)) {
    throw new Error("The commissions dashboard returned an incomplete result.");
  }
  const a = value.agent;
  const k = value.kpis;
  const lanesIn = k.lanes as Record<string, unknown>;
  const lanes = Object.fromEntries(LANES.map((l) => [l, parseLaneFigures(lanesIn[l] ?? { n: 0, ap: 0, est: null }, l)])) as Record<Lane, LaneFigures>;
  const rateOnFile = a.rate_on_file === true;
  return {
    ok: true,
    as_of: str(value.as_of) ?? "",
    today: str(value.today) ?? "",
    agent: {
      agent_id: str(a.agent_id) ?? "",
      name: str(a.name) ?? "",
      npn: str(a.npn),
      rate_pct: num(a.rate_pct),
      rate_provenance: str(a.rate_provenance),
      rate_on_file: rateOnFile,
      record_ids: Array.isArray(a.record_ids) ? a.record_ids.filter((x): x is string => typeof x === "string") : [],
    },
    kpis: {
      mtd_est: num(k.mtd_est), mtd_deals: needNumber(k.mtd_deals, "month-to-date deals"), mtd_ap: needNumber(k.mtd_ap, "month-to-date premium"),
      last_month_est: num(k.last_month_est), last_month_deals: needNumber(k.last_month_deals, "last-month deals"),
      ytd_est: num(k.ytd_est), ytd_deals: needNumber(k.ytd_deals, "year-to-date deals"), ytd_ap: needNumber(k.ytd_ap, "year-to-date premium"),
      deals_12m: needNumber(k.deals_12m, "12-month deals"), ap_12m: needNumber(k.ap_12m, "12-month premium"), est_12m: num(k.est_12m),
      lanes,
    },
    months: value.months.map((m) => {
      if (!isRecord(m) || typeof m.month !== "string") throw new Error("The commissions dashboard returned a month without a key.");
      return {
        month: m.month, deals: needNumber(m.deals, "month deals"), ap: needNumber(m.ap, "month premium"), est: num(m.est),
        est_in_force: num(m.est_in_force), est_pending: num(m.est_pending), est_lost: num(m.est_lost), est_unknown: num(m.est_unknown),
      };
    }),
    deals: value.deals.map((d) => {
      if (!isRecord(d) || typeof d.row_key !== "string") throw new Error("The commissions dashboard returned a deal without a key.");
      return {
        row_key: d.row_key, posted_date: str(d.posted_date), client_name: str(d.client_name), carrier: str(d.carrier), product: str(d.product),
        policy_number: str(d.policy_number), annual_premium: num(d.annual_premium), est: num(d.est), deal_status: str(d.deal_status), origin: str(d.origin),
        lane: laneOf(d.lane), book_carrier: str(d.book_carrier), status_bucket: str(d.status_bucket), status_raw: str(d.status_raw),
        status_changed_on: str(d.status_changed_on), issued_on: str(d.issued_on), lost_on: str(d.lost_on), close_reason: str(d.close_reason),
      };
    }),
    chargebacks: value.chargebacks.map((c) => {
      const r = isRecord(c) ? c : {};
      return {
        carrier: str(r.carrier), policy_number: str(r.policy_number), amount: num(r.amount), original_amount: num(r.original_amount),
        chargeback_on: str(r.chargeback_on), reason: str(r.reason), status: str(r.status),
      };
    }),
    chargeback_open_total: num(value.chargeback_open_total) ?? 0,
    ethos: isRecord(value.ethos) ? {
      snapshot_on: str(value.ethos.snapshot_on), issued_annual_premium: num(value.ethos.issued_annual_premium),
      inforce_issued_premium: num(value.ethos.inforce_issued_premium), persistency_m4: num(value.ethos.persistency_m4),
      persistency_m7: num(value.ethos.persistency_m7), persistency_m13: num(value.ethos.persistency_m13),
      outstanding_chargeback: num(value.ethos.outstanding_chargeback), on_advanced_pay: typeof value.ethos.on_advanced_pay === "boolean" ? value.ethos.on_advanced_pay : null,
    } : null,
    book: {
      last_run_at: str(value.book.last_run_at), last_read_on: str(value.book.last_read_on),
      carriers: Array.isArray(value.book.carriers) ? value.book.carriers.filter((x): x is string => typeof x === "string") : [],
    },
    sources: {
      commission_ledger_rows: num(value.sources.commission_ledger_rows) ?? 0,
      paid_feed: value.sources.paid_feed === true,
    },
  };
}

export function money(value: number | null | undefined, digits = 0): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "$0";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** An estimate figure, or the honest word when the rate is not on file. */
export function estText(value: number | null, rateOnFile: boolean): string {
  if (!rateOnFile) return "Rate not on file";
  if (value === null) return "$0";
  return money(value);
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function monthShort(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function shortDate(dateIso: string | null | undefined): string {
  if (!dateIso) return "";
  const t = Date.parse(`${dateIso.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** One line for the rate: what it is and where it came from. */
export function rateSentence(agent: Pick<CommissionsDashboardData["agent"], "rate_pct" | "rate_provenance" | "rate_on_file">): string {
  if (!agent.rate_on_file || agent.rate_pct === null) {
    return "Contract rate not on file. Premium is shown; estimated commission is hidden until an admin records the rate.";
  }
  const source = agent.rate_provenance && agent.rate_provenance !== "unknown" ? ` (${agent.rate_provenance.replace(/_/g, " ")})` : "";
  return `Contract rate ${agent.rate_pct}%${source}. Estimates are annual premium times this rate, before carrier payment, adjustments or chargebacks.`;
}

/** How fresh the carrier portal read is, in words that say when it is too old to trust. */
export function bookFreshnessSentence(lastReadOn: string | null, today: string, carriers: string[]): string {
  if (!lastReadOn || !today) return "The carrier portal has not been read yet, so every policy status is only what was posted.";
  // Clamped at 0: a book read stamped after "today" (clock skew between the portal run and Phoenix midnight) is "today", never "-1 days ago".
  const days = Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastReadOn.slice(0, 10)}T12:00:00Z`)) / 86_400_000));
  const names = carriers.length ? carriers.join(" and ") : "the carrier portals";
  const when = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  const stale = days >= 3 ? " That is stale; statuses may have moved since." : "";
  return `Policy statuses come from ${names}, last read ${when}.${stale}`;
}

export interface DealFilter {
  /** "YYYY-MM" or null for every month. */
  month: string | null;
  lane: Lane | "all";
  search: string;
}

export const EMPTY_DEAL_FILTER: DealFilter = { month: null, lane: "all", search: "" };

export function filterDeals(deals: readonly DashboardDeal[], f: DealFilter): DashboardDeal[] {
  const q = f.search.trim().toLowerCase();
  return deals.filter((d) => {
    if (f.month && (d.posted_date ?? "").slice(0, 7) !== f.month) return false;
    if (f.lane !== "all" && d.lane !== f.lane) return false;
    if (!q) return true;
    return [d.client_name, d.carrier, d.product, d.policy_number].some((v) => (v ?? "").toLowerCase().includes(q));
  });
}

export function sumEst(deals: readonly DashboardDeal[]): number | null {
  let any = false;
  let total = 0;
  for (const d of deals) {
    if (d.est !== null) { any = true; total += d.est; }
  }
  return any ? total : null;
}

export function sumAp(deals: readonly DashboardDeal[]): number {
  return deals.reduce((t, d) => t + (d.annual_premium ?? 0), 0);
}

function csvCell(v: string | number | null | undefined): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

export function dealsCsv(deals: readonly DashboardDeal[], rateOnFile: boolean): string {
  const head = ["posted_date", "client", "carrier", "product", "policy_number", "annual_premium", "estimated_commission", "status", "carrier_status", "issued_on", "lost_on"];
  const lines = deals.map((d) => [
    d.posted_date, d.client_name, d.carrier, d.product, d.policy_number, d.annual_premium,
    rateOnFile ? d.est : "", LANE_META[d.lane].label, d.status_raw ?? d.status_bucket, d.issued_on, d.lost_on,
  ].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\n");
}

/** Lanes in the order the strip shows them, dropping the ones with nothing in them. */
export function laneStrip(lanes: Record<Lane, LaneFigures>): Array<{ lane: Lane } & LaneFigures> {
  return LANES.map((lane) => ({ lane, ...lanes[lane] })).filter((x) => x.n > 0);
}

/** What the paid column would say today: the honest footer. */
export function paidFeedSentence(sources: CommissionsDashboardData["sources"]): string {
  if (sources.paid_feed) return "Paid amounts come from carrier statements.";
  const ledger = sources.commission_ledger_rows > 0
    ? ` The older commission ledger (${sources.commission_ledger_rows} row${sources.commission_ledger_rows === 1 ? "" : "s"} for this record) recorded no payments and is not shown.`
    : "";
  return `No carrier statement feed is connected yet, so nothing here is money received.${ledger}`;
}
