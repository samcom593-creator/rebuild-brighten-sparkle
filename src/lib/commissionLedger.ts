/**
 * Pure commission logic behind src/pages/MyCommissions.tsx (F12, F14, F15 and
 * F16 in the 2026-10-14 Galaxy OS map). Nothing here touches Supabase or
 * React, so every rule is unit tested in src/tests/lib/commissionLedger.test.ts.
 *
 * What a ledger row is. Measured live on 2026-10-15 (project
 * xrzweoneiieddzxogewk, SELECT only): commission_ledger holds 170 rows for 16
 * agents, every one written by trg_fn_deal_status_transition when a deal goes
 * submitted -> active and priced by fn_commission_rate. All 170 carry
 * rate_source 'override' (agent_carrier_comp.override_pct) at 0.00 to 0.50
 * percent, amount = premium * rate / 100, 74 of them $0.00; 166 are pending and
 * past their expected pay date, 4 are voided, none is paid. The same agents'
 * contract rates are 57 to 125 percent. A ledger row is therefore a second,
 * differently priced figure for a deal, not the agent's paid commission. It is
 * shown beside the contract-rate estimate and never in its place, and ledger
 * and estimate amounts are totalled separately, never added together. Only a
 * paid row with a payment date is an actual payment.
 *
 * Pairing, one row per deal:
 *   1. Deal id. A production row whose row_key is the ledger deal's id (native
 *      deals) or md5 of its AgentLink deal id (agentlink_book.deal_key, which
 *      agentlink_pull_book_of_business and agentlink_book_rebuild both compute
 *      as md5(id) when AgentLink sends an id). Live: 87 of 170 ledger rows pair
 *      this way, each with exactly one production row.
 *   2. Otherwise the same policy number AND the same client name, never a
 *      placeholder-like number. Live, the view holds '1234' on 39 rows for 38
 *      clients, '123456' on 27 clients and 'POL' on 11, so a policy number on
 *      its own pairs unrelated deals.
 *   A match that is not one-to-one is left unpaired and counted, never guessed.
 *
 * Rates: v_production_comp_truth never returns a NULL rate; it coalesces to
 * 60 (120 for owner logins) when fn_agent_contract_pct has no provenance for
 * the agent. The rate verdict therefore comes from fn_agent_contract_pct, read
 * by the page, and an estimate whose rate is not on file carries no amount.
 *
 * Closed deals: the status trigger never voids a ledger row when its deal
 * lapses. Live on 2026-10-15, 9 pending rows sit on lapsed deals and 4 on
 * cancelled ones, none of them paired with production. A pending row on a
 * closed deal will not be paid, so it is counted apart from pending and left
 * out of the month figures.
 *
 * Estimate tiles: finances_overview(p_scope 'mine') keeps only the caller's
 * own rows, so its override figure is always 0, and its trail and renewal
 * figures are fixed multipliers of the direct estimate (0.25 and 0.05). Only
 * Direct YTD can show a number; see commissionTypeTiles.
 *
 * Ledger visibility: commission_ledger RLS (cl_own) returns only rows whose
 * agent belongs to the signed-in login, and cl_admn returns every row to
 * admins. A login that reaches another login's record through a merge reads
 * none of that record's rows; see ledgerVisibility.
 *
 * Dates: a business date is a "YYYY-MM-DD" key compared as a string. The
 * ledger's created_at instant is bucketed in the business zone; it is never
 * parsed into a browser-local Date.
 */
import { yearStartKey } from "@/lib/businessClock";
import { BUSINESS_TZ, dateKeyInZone } from "@/lib/calendarTime";
import { md5Hex } from "@/lib/md5";
import { errorMessage, queryStatus, type QueryStatus, type QueryStatusInput } from "@/lib/queryState";

const DATE_KEY_RX = /^\d{4}-\d{2}-\d{2}$/;

/** deals.source of an AgentLink import. Its production row keys on md5 of the AgentLink deal id. */
export const AGENTLINK_DEAL_SOURCE = "agent_link";

/** One commission_ledger row, joined to its deal. amount, rate_pct and annual_premium are NOT NULL numerics; the page rejects a read that returns anything else. */
export interface LedgerRow {
  id: string;
  deal_id: string;
  /** deals.source: agent_link, apex_native or apex. */
  deal_source: string | null;
  /** deals.external_deal_id: AgentLink's own id on an agent_link deal. */
  external_deal_id: string | null;
  /** deals.status. A closed status (see CLOSED_DEAL_STATUSES) means a pending ledger row on the deal will not be paid. */
  deal_status: string | null;
  policy_number: string | null;
  annual_premium: number;
  rate_pct: number;
  /** fn_commission_rate's source: 'override' or 'contract'. Shown as stored, never reinterpreted. */
  rate_source: string;
  amount: number;
  /** pending | paid | clawed_back | voided (CHECK constraint on the table). Kept as text so an unexpected value is shown, not rewritten. */
  status: string;
  expected_paid_date: string | null;
  actual_paid_date: string | null;
  created_at: string | null;
  carrier_name: string | null;
  client_name: string | null;
  product: string | null;
}

/** One v_production_comp_truth row for the viewer's agent. posted_date is already a Phoenix day key. */
export interface ProductionEstimate {
  row_key: string;
  policy_number: string | null;
  annual_premium: number | null;
  seller_comp_pct: number | null;
  direct_estimate: number | null;
  posted_date: string | null;
  status: string | null;
  carrier: string | null;
  client_name: string | null;
  product: string | null;
}

/** One fn_agent_contract_pct row. provenance is 'unknown' when no contract is on file. */
export interface ContractRateRow {
  pct: number | null;
  provenance: string | null;
}

/**
 * on_file: a contract rate with a known provenance exists for the agent.
 * not_on_file: the read completed and found none (the view's 60 is a default).
 * unknown: the read failed or has not finished, so nothing can be said either way.
 */
export type RateVerdict = "on_file" | "not_on_file" | "unknown";

export const RATE_LABELS: Record<Exclude<RateVerdict, "on_file">, string> = {
  not_on_file: "rate not on file",
  unknown: "rate unverified",
};

/** The ledger's own figures for a deal, exactly as booked. */
export interface LedgerPart {
  ledgerId: string;
  dealId: string;
  amount: number;
  annualPremium: number;
  ratePct: number;
  rateSource: string;
  /** For example "0.5% override rate": the row's own rate and source. */
  rateLabel: string;
  status: string;
  expectedPaidDate: string | null;
  actualPaidDate: string | null;
  /** created_at as a business-zone day key. */
  bookedDate: string | null;
  /** deals.status as stored. */
  dealStatus: string | null;
  /** True when deals.status is closed (lapsed, cancelled and the like). */
  dealClosed: boolean;
}

/** The production view's contract-rate estimate for a deal. */
export interface EstimatePart {
  rowKey: string;
  /** Null when the rate is not on file, unverified, or the view could not price the row. */
  amount: number | null;
  annualPremium: number | null;
  ratePct: number | null;
  rateLabel: string;
  postedDate: string | null;
}

export type PairMethod = "deal_id" | "policy_and_client";

export interface CommissionRow {
  /** Stable across renders: "ledger:<id>" for a row with a ledger part, else "estimate:<row_key>". */
  id: string;
  ledger: LedgerPart | null;
  estimate: EstimatePart | null;
  pairedBy: PairMethod | null;
  /** A ledger row left unpaired because its match was not one-to-one. */
  ambiguous: boolean;
  policyNumber: string | null;
  clientName: string | null;
  carrierName: string | null;
  product: string | null;
  /** The production premium when the deal has a production row, else the ledger's. */
  annualPremium: number | null;
  /** The production posted date when the deal has a production row, else the ledger booking date. */
  businessDate: string | null;
}

export interface ProductionFigures {
  rowCount: number;
  pairedByDealId: number;
  pairedByPolicyAndClient: number;
  /** Ledger rows left unpaired because more than one production row matched, or another ledger row claimed the same one. */
  ambiguousLedgerCount: number;
  /** Production rows whose estimate carries no amount. */
  excludedCount: number;
  /** Sum of every estimate that carries an amount, paired or not. Null unless the contract rate is on file. */
  estimateTotal: number | null;
}

export interface Reconciliation {
  rows: CommissionRow[];
  ledgerRowCount: number;
  /** Null when the production read is unavailable: nothing is paired and no estimate figure exists, not even a zero. */
  production: ProductionFigures | null;
}

export interface LedgerSummary {
  /** Pending rows on deals that are still open. */
  pending: { count: number; total: number; pastExpectedCount: number; rateSources: string[] };
  /** Pending rows whose deal is closed. They will not be paid, so they are counted here and never in pending. */
  pendingOnClosedDeals: { count: number; total: number; dealStatuses: string[] };
  /** Every paid row, whatever its date. Paid YTD is paidYearToDate. */
  paid: { count: number; total: number };
  clawedBack: { count: number; total: number };
  voided: { count: number; total: number };
}

export interface PaidYearToDate {
  total: number;
  count: number;
  yearStart: string;
  /** Rows marked paid with no usable actual_paid_date. They are reported, never dated. */
  undatedPaidCount: number;
  /** Rows marked paid with a payment date after today. A data error, reported and never counted. */
  futureDatedPaidCount: number;
}

export interface MonthBucket {
  /** "YYYY-MM" */
  key: string;
  label: string;
  /** Production rows posted in the month. Each counts once, paired with a ledger row or not. */
  deals: number;
  /** Ledger rows booked in the month with no production pair. Counted on their own, never as production deals. */
  ledgerOnlyRows: number;
  /** Annual premium of the month's production rows. Ledger-only rows add none. */
  premium: number;
  /** Ledger amounts of paid rows and of pending rows on open deals. */
  ledger: number;
  /** Estimate amounts that carry a value. */
  estimate: number;
  /** Production rows in the month whose estimate carries no amount. */
  estimateExcluded: number;
}

export interface MonthSummary {
  months: MonthBucket[];
  /** Ledger-only rows in the year that are voided or clawed back. Left out of every month figure. */
  closedLedgerOnlyCount: number;
  /** Pending ledger-only rows in the year whose deal is closed. They will not be paid, so they are left out of every month figure. */
  closedDealLedgerOnlyCount: number;
  /** Rows dated after today. Left out of the month table, though their estimates still sit in the estimate total. */
  futureDatedCount: number;
  /** Rows with no usable date. Left out of the month table. */
  undatedCount: number;
}

export type TileFigure = { kind: "amount"; amount: number } | { kind: "text"; text: string };

export interface CommissionTypeTile {
  id: "direct" | "advance" | "override" | "trail" | "renewal";
  label: string;
  figure: TileFigure;
  detail: string;
}

/** finances_overview's commission_types block as returned. Only direct_ytd is ever shown; see commissionTypeTiles. */
export interface CommissionTypeFigures {
  direct_ytd?: unknown;
  override_pending?: unknown;
  trail_pending?: unknown;
  renewal_pending?: unknown;
}

/**
 * complete: the ledger read covers the whole record this login resolved to.
 * restricted: the record belongs to another login (reached through a merge), so RLS hides its rows from this login.
 * checking: the login's admin role is still loading, so it is not yet known which of the two applies.
 */
export type LedgerVisibility = "complete" | "restricted" | "checking";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PLACEHOLDER_CLIENT_NAMES: ReadonlySet<string> = new Set(["na", "n a", "none", "unknown", "test", "tbd", "client"]);
const DIGIT_RUN_UP = "0123456789";
const DIGIT_RUN_DOWN = "9876543210";

/**
 * deals.status values that end a deal. deals_status_check allows lapsed,
 * cancelled, chargeback, charged_back, withdrawn and declined (measured
 * 2026-10-15); not_taken is in finances_overview_base's own dead-status list.
 */
export const CLOSED_DEAL_STATUSES: ReadonlySet<string> = new Set([
  "lapsed",
  "cancelled",
  "chargeback",
  "charged_back",
  "withdrawn",
  "declined",
  "not_taken",
]);

const CLOSED_DEAL_WORDS: Record<string, string> = {
  lapsed: "lapsed",
  cancelled: "cancelled",
  chargeback: "charged back",
  charged_back: "charged back",
  withdrawn: "withdrawn",
  declined: "declined",
  not_taken: "not taken",
};

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && DATE_KEY_RX.test(value);
}

function normalizeStatus(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const status = value.trim().toLowerCase();
  return status.length ? status : null;
}

/** The normalized deals.status when it ends the deal, else null. */
function closedStatusOf(value: string | null | undefined): string | null {
  const status = normalizeStatus(value);
  return status !== null && CLOSED_DEAL_STATUSES.has(status) ? status : null;
}

function closedWord(status: string): string {
  return CLOSED_DEAL_WORDS[status] ?? status.replace(/_/g, " ");
}

/** True when deals.status ends the deal, so a pending ledger row on it will not be paid. */
export function isClosedDealStatus(value: string | null | undefined): boolean {
  return closedStatusOf(value) !== null;
}

/** "deal lapsed", "deal cancelled": the closed deal status beside a ledger row. Null for an open deal. */
export function dealStatusLabel(value: string | null | undefined): string | null {
  const status = closedStatusOf(value);
  return status === null ? null : `deal ${closedWord(status)}`;
}

/** "cancelled or lapsed": the closed deal statuses present, each named once, sorted. Empty for none. */
export function closedDealPhrase(statuses: string[]): string {
  const words = Array.from(
    new Set(
      statuses
        .map(closedStatusOf)
        .filter((s): s is string => s !== null)
        .map(closedWord),
    ),
  ).sort();
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

/**
 * A ledger amount that was paid or can still be paid: a paid row (with or
 * without a payment date), or a pending row whose deal is open. Voided and
 * clawed-back rows, and pending rows on closed deals, are not.
 */
export function isLiveLedgerPart(part: Pick<LedgerPart, "status" | "dealClosed">): boolean {
  if (part.status === "paid") return true;
  return part.status === "pending" && !part.dealClosed;
}

/** Trimmed, lower-cased policy number, or null when there is none. */
export function normalizePolicyNumber(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

/**
 * The policy number as a pairing key: lower-cased with punctuation and spaces
 * removed. Null for anything placeholder-like, which never pairs: fewer than 6
 * characters ('1234', 'POL', '00000', 'n/a'), no digit at all ('pending
 * texas'), one repeated character ('000000000'), or a straight digit run after
 * an optional short letter prefix ('123456', '0123456', 'POL-12345').
 */
export function policyMatchKey(value: string | null | undefined): string | null {
  const normalized = normalizePolicyNumber(value);
  if (normalized === null) return null;
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  if (compact.length < 6) return null;
  if (!/[0-9]/.test(compact)) return null;
  if (/^(.)\1*$/.test(compact)) return null;
  const tail = compact.replace(/^[a-z]{1,4}/, "");
  if (tail.length >= 4 && (DIGIT_RUN_UP.includes(tail) || DIGIT_RUN_DOWN.includes(tail))) return null;
  return compact;
}

/** The client name as a pairing key: lower-cased, accents and punctuation removed, spaces collapsed. Null when blank or a placeholder. */
export function clientMatchKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const key = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (key.length < 2 || !/[a-z]/.test(key) || PLACEHOLDER_CLIENT_NAMES.has(key)) return null;
  return key;
}

/** Every production row_key that identifies this ledger row's own deal: its deal id, plus md5 of the AgentLink id for an AgentLink import. */
export function ledgerDealKeys(row: Pick<LedgerRow, "deal_id" | "deal_source" | "external_deal_id">): string[] {
  const keys = [row.deal_id];
  const externalId = typeof row.external_deal_id === "string" ? row.external_deal_id : "";
  if (row.deal_source === AGENTLINK_DEAL_SOURCE && externalId !== "") keys.push(md5Hex(externalId));
  return keys;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Day key of an instant in the business zone, or null for a missing or unparsable instant. */
export function businessDateOf(instant: string | null | undefined, tz: string = BUSINESS_TZ): string | null {
  if (!instant) return null;
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return dateKeyInZone(d, tz);
}

/** on_file when any row carries a finite pct with a provenance other than 'unknown'; otherwise not_on_file. */
export function rateVerdictFromContracts(rows: ContractRateRow[]): RateVerdict {
  const known = rows.some(
    (r) =>
      typeof r.pct === "number" &&
      Number.isFinite(r.pct) &&
      typeof r.provenance === "string" &&
      r.provenance.trim() !== "" &&
      r.provenance.trim() !== "unknown",
  );
  return known ? "on_file" : "not_on_file";
}

function sourceName(source: string): string {
  const name = source.trim().replace(/_/g, " ");
  return name.length ? name : "unnamed";
}

/** "0.5% override rate". The source is the ledger's own label, never translated into another rate. */
export function ledgerRateLabel(ratePct: number, rateSource: string): string {
  return `${ratePct}% ${sourceName(rateSource)} rate`;
}

/** "override rate", "contract and override rates": the distinct sources, sorted. Empty for no sources. */
export function rateSourcePhrase(sources: string[]): string {
  const names = Array.from(new Set(sources.map(sourceName))).sort();
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} rate`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} rates`;
}

/** The status as shown: a paid row without a payment date is not presented as a payment. */
export function ledgerStatusLabel(part: Pick<LedgerPart, "status" | "actualPaidDate">): string {
  switch (part.status) {
    case "pending":
      return "ledger pending";
    case "paid":
      return isDateKey(part.actualPaidDate) ? "paid" : "paid, no payment date";
    case "clawed_back":
      return "clawed back";
    default:
      return part.status;
  }
}

function toLedgerPart(row: LedgerRow, tz: string): LedgerPart {
  return {
    ledgerId: row.id,
    dealId: row.deal_id,
    amount: row.amount,
    annualPremium: row.annual_premium,
    ratePct: row.rate_pct,
    rateSource: row.rate_source,
    rateLabel: ledgerRateLabel(row.rate_pct, row.rate_source),
    status: row.status,
    expectedPaidDate: row.expected_paid_date,
    actualPaidDate: row.actual_paid_date,
    bookedDate: businessDateOf(row.created_at, tz),
    dealStatus: row.deal_status,
    dealClosed: isClosedDealStatus(row.deal_status),
  };
}

function toEstimatePart(row: ProductionEstimate, rate: RateVerdict): EstimatePart {
  const base = {
    rowKey: row.row_key,
    annualPremium: asNumber(row.annual_premium),
    postedDate: isDateKey(row.posted_date) ? row.posted_date : null,
  };
  if (rate !== "on_file") return { ...base, amount: null, ratePct: null, rateLabel: RATE_LABELS[rate] };
  const ratePct = asNumber(row.seller_comp_pct);
  const amount = asNumber(row.direct_estimate);
  if (ratePct === null || amount === null) return { ...base, amount: null, ratePct: null, rateLabel: "estimate not available" };
  return { ...base, amount, ratePct, rateLabel: `${ratePct}% comp level` };
}

function pairingKey(policyNumber: string | null, clientName: string | null): string | null {
  const policy = policyMatchKey(policyNumber);
  const client = clientMatchKey(clientName);
  return policy === null || client === null ? null : `${policy}|${client}`;
}

function appendTo<K>(map: Map<K, number[]>, key: K, value: number): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function buildRow(
  id: string,
  ledgerRow: LedgerRow | null,
  ledger: LedgerPart | null,
  production: ProductionEstimate | null,
  estimate: EstimatePart | null,
  pairedBy: PairMethod | null,
  ambiguous: boolean,
): CommissionRow {
  return {
    id,
    ledger,
    estimate,
    pairedBy,
    ambiguous,
    policyNumber: production?.policy_number ?? ledgerRow?.policy_number ?? null,
    clientName: production?.client_name ?? ledgerRow?.client_name ?? null,
    carrierName: production?.carrier ?? ledgerRow?.carrier_name ?? null,
    product: production?.product ?? ledgerRow?.product ?? null,
    annualPremium: estimate?.annualPremium ?? ledger?.annualPremium ?? null,
    businessDate: estimate?.postedDate ?? ledger?.bookedDate ?? null,
  };
}

function compareRows(a: CommissionRow, b: CommissionRow): number {
  if (a.businessDate !== b.businessDate) {
    if (a.businessDate === null) return 1;
    if (b.businessDate === null) return -1;
    return a.businessDate < b.businessDate ? 1 : -1;
  }
  if ((a.ledger === null) !== (b.ledger === null)) return a.ledger ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pair ledger rows with production rows for ONE agent's scope, one row per
 * deal. Nothing is replaced: a paired deal carries the ledger's figures and
 * the contract-rate estimate side by side, and every estimate stays in the
 * estimate total. Pass `estimates` as undefined when the production read is
 * unavailable; the ledger rows are then returned alone and `production` is
 * null, so no count or total can read as zero.
 */
export function reconcileCommissions(
  ledger: LedgerRow[],
  estimates: ProductionEstimate[] | undefined,
  rate: RateVerdict,
  tz: string = BUSINESS_TZ,
): Reconciliation {
  const ledgerParts = ledger.map((row) => toLedgerPart(row, tz));

  if (estimates === undefined) {
    const rows = ledger.map((row, li) => buildRow(`ledger:${row.id}`, row, ledgerParts[li], null, null, null, false));
    rows.sort(compareRows);
    return { rows, ledgerRowCount: ledger.length, production: null };
  }

  const estimateParts = estimates.map((row) => toEstimatePart(row, rate));
  const estimateOfLedger = new Map<number, number>();
  const methodOfLedger = new Map<number, PairMethod>();
  const pairedEstimates = new Set<number>();
  const ambiguous = new Set<number>();
  const link = (li: number, ei: number, method: PairMethod) => {
    estimateOfLedger.set(li, ei);
    methodOfLedger.set(li, method);
    pairedEstimates.add(ei);
  };

  // Pass 1: deal id. A production row is linked only when exactly one ledger row points at it and that ledger row points nowhere else.
  const byRowKey = new Map<string, number[]>();
  estimates.forEach((e, ei) => appendTo(byRowKey, e.row_key, ei));
  const keyCandidates = ledger.map((row) => {
    const found = new Set<number>();
    for (const key of ledgerDealKeys(row)) for (const ei of byRowKey.get(key) ?? []) found.add(ei);
    return Array.from(found);
  });
  const keyClaims = new Map<number, number[]>();
  keyCandidates.forEach((candidates, li) => {
    if (candidates.length === 1) appendTo(keyClaims, candidates[0], li);
    else if (candidates.length > 1) ambiguous.add(li);
  });
  for (const [ei, claimants] of keyClaims) {
    if (claimants.length === 1) link(claimants[0], ei, "deal_id");
    else claimants.forEach((li) => ambiguous.add(li));
  }

  // Pass 2: policy number and client name, only for ledger rows the deal id found nothing for, and only
  // against production rows no deal id points at.
  const keyLinked = new Set<number>(keyCandidates.flat());
  const byPolicyAndClient = new Map<string, number[]>();
  estimates.forEach((e, ei) => {
    if (keyLinked.has(ei)) return;
    const key = pairingKey(e.policy_number, e.client_name);
    if (key !== null) appendTo(byPolicyAndClient, key, ei);
  });
  const fallbackClaims = new Map<number, number[]>();
  ledger.forEach((row, li) => {
    if (keyCandidates[li].length > 0) return;
    const key = pairingKey(row.policy_number, row.client_name);
    if (key === null) return;
    const candidates = byPolicyAndClient.get(key) ?? [];
    if (candidates.length === 1) appendTo(fallbackClaims, candidates[0], li);
    else if (candidates.length > 1) ambiguous.add(li);
  });
  for (const [ei, claimants] of fallbackClaims) {
    if (claimants.length === 1) link(claimants[0], ei, "policy_and_client");
    else claimants.forEach((li) => ambiguous.add(li));
  }

  const rows: CommissionRow[] = [];
  ledger.forEach((row, li) => {
    const ei = estimateOfLedger.get(li);
    const id = `ledger:${row.id}`;
    if (ei === undefined) rows.push(buildRow(id, row, ledgerParts[li], null, null, null, ambiguous.has(li)));
    else rows.push(buildRow(id, row, ledgerParts[li], estimates[ei], estimateParts[ei], methodOfLedger.get(li) ?? null, false));
  });
  estimates.forEach((e, ei) => {
    if (!pairedEstimates.has(ei)) rows.push(buildRow(`estimate:${e.row_key}`, null, null, e, estimateParts[ei], null, false));
  });
  rows.sort(compareRows);

  let excludedCount = 0;
  let estimateTotal = 0;
  for (const part of estimateParts) {
    if (part.amount === null) excludedCount += 1;
    else estimateTotal += part.amount;
  }
  let pairedByDealId = 0;
  let pairedByPolicyAndClient = 0;
  for (const method of methodOfLedger.values()) {
    if (method === "deal_id") pairedByDealId += 1;
    else pairedByPolicyAndClient += 1;
  }

  return {
    rows,
    ledgerRowCount: ledger.length,
    production: {
      rowCount: estimates.length,
      pairedByDealId,
      pairedByPolicyAndClient,
      ambiguousLedgerCount: ambiguous.size,
      excludedCount,
      estimateTotal: rate === "on_file" ? estimateTotal : null,
    },
  };
}

/**
 * Ledger totals by status. Pending rows past their expected pay date are
 * counted so the card cannot read as on schedule, and pending rows on closed
 * deals are counted apart, never in pending.
 */
export function ledgerSummary(rows: LedgerRow[], todayKey: string): LedgerSummary {
  if (!isDateKey(todayKey)) throw new RangeError(`invalid date key: ${todayKey}`);
  const summary: LedgerSummary = {
    pending: { count: 0, total: 0, pastExpectedCount: 0, rateSources: [] },
    pendingOnClosedDeals: { count: 0, total: 0, dealStatuses: [] },
    paid: { count: 0, total: 0 },
    clawedBack: { count: 0, total: 0 },
    voided: { count: 0, total: 0 },
  };
  const sources = new Set<string>();
  const closedStatuses = new Set<string>();
  for (const row of rows) {
    const closedStatus = row.status === "pending" ? closedStatusOf(row.deal_status) : null;
    if (closedStatus !== null) {
      summary.pendingOnClosedDeals.count += 1;
      summary.pendingOnClosedDeals.total += row.amount;
      closedStatuses.add(closedStatus);
    } else if (row.status === "pending") {
      summary.pending.count += 1;
      summary.pending.total += row.amount;
      sources.add(row.rate_source);
      if (isDateKey(row.expected_paid_date) && row.expected_paid_date < todayKey) summary.pending.pastExpectedCount += 1;
    } else if (row.status === "paid") {
      summary.paid.count += 1;
      summary.paid.total += row.amount;
    } else if (row.status === "clawed_back") {
      summary.clawedBack.count += 1;
      summary.clawedBack.total += row.amount;
    } else if (row.status === "voided") {
      summary.voided.count += 1;
      summary.voided.total += row.amount;
    }
  }
  summary.pending.rateSources = Array.from(sources).sort();
  summary.pendingOnClosedDeals.dealStatuses = Array.from(closedStatuses).sort();
  return summary;
}

/**
 * Paid in the business year that contains todayKey: status 'paid' and
 * actual_paid_date between January 1 and todayKey inclusive. A paid row with
 * no usable date, or dated after today, is counted on its own and nowhere else.
 */
export function paidYearToDate(rows: LedgerRow[], todayKey: string): PaidYearToDate {
  if (!isDateKey(todayKey)) throw new RangeError(`invalid date key: ${todayKey}`);
  const yearStart = yearStartKey(todayKey);
  let total = 0;
  let count = 0;
  let undatedPaidCount = 0;
  let futureDatedPaidCount = 0;
  for (const row of rows) {
    if (row.status !== "paid") continue;
    if (!isDateKey(row.actual_paid_date)) {
      undatedPaidCount += 1;
      continue;
    }
    if (row.actual_paid_date > todayKey) {
      futureDatedPaidCount += 1;
      continue;
    }
    if (row.actual_paid_date < yearStart) continue;
    total += row.amount;
    count += 1;
  }
  return { total, count, yearStart, undatedPaidCount, futureDatedPaidCount };
}

/** "2026-10" -> "Oct 2026". Pure string work, no Date. */
export function monthLabel(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) throw new RangeError(`invalid month key: ${monthKey}`);
  const name = MONTH_NAMES[Number(m[2]) - 1];
  if (!name) throw new RangeError(`invalid month key: ${monthKey}`);
  return `${name} ${m[1]}`;
}

/**
 * The business year up to todayKey, by month, newest first.
 *   deals            production rows, each counted once, paired or not
 *   ledgerOnlyRows   ledger rows with no production pair (unpaired, ambiguous,
 *                    or on a deal the view does not hold), counted on their
 *                    own and never as production deals
 *   premium          production premium only
 *   ledger           paid rows and pending rows on open deals
 *   estimate         every estimate that carries an amount
 * A ledger-only row that is voided, clawed back, or pending on a closed deal is
 * not live business and is counted apart. Rows dated after today, or with no
 * date, are counted apart too, so nothing leaves the table without a trace.
 */
export function monthBuckets(rows: CommissionRow[], todayKey: string): MonthSummary {
  if (!isDateKey(todayKey)) throw new RangeError(`invalid date key: ${todayKey}`);
  const yearStart = yearStartKey(todayKey);
  const buckets = new Map<string, MonthBucket>();
  let closedLedgerOnlyCount = 0;
  let closedDealLedgerOnlyCount = 0;
  let futureDatedCount = 0;
  let undatedCount = 0;
  for (const row of rows) {
    if (row.businessDate === null) {
      undatedCount += 1;
      continue;
    }
    if (row.businessDate > todayKey) {
      futureDatedCount += 1;
      continue;
    }
    if (row.businessDate < yearStart) continue;
    const liveLedger = row.ledger !== null && isLiveLedgerPart(row.ledger);
    if (row.estimate === null && !liveLedger) {
      if (row.ledger !== null && row.ledger.status === "pending") closedDealLedgerOnlyCount += 1;
      else closedLedgerOnlyCount += 1;
      continue;
    }
    const key = row.businessDate.slice(0, 7);
    const bucket = buckets.get(key) ?? {
      key,
      label: monthLabel(key),
      deals: 0,
      ledgerOnlyRows: 0,
      premium: 0,
      ledger: 0,
      estimate: 0,
      estimateExcluded: 0,
    };
    if (liveLedger && row.ledger !== null) bucket.ledger += row.ledger.amount;
    if (row.estimate === null) {
      bucket.ledgerOnlyRows += 1;
    } else {
      bucket.deals += 1;
      if (row.estimate.annualPremium !== null) bucket.premium += row.estimate.annualPremium;
      if (row.estimate.amount === null) bucket.estimateExcluded += 1;
      else bucket.estimate += row.estimate.amount;
    }
    buckets.set(key, bucket);
  }
  const months = Array.from(buckets.values()).sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  return { months, closedLedgerOnlyCount, closedDealLedgerOnlyCount, futureDatedCount, undatedCount };
}

/**
 * The commission type tiles for finances_overview(p_scope 'mine'), measured
 * from finances_overview_base on 2026-10-15:
 *   direct_ytd        your own production at your comp level; the server falls
 *                     back to 60 percent when no rate is on file
 *   override_pending  always 0 in the 'mine' scope, which keeps only your own
 *                     rows, every one of them 'direct'
 *   trail_pending     direct estimate x 0.25 over the last 365 days, a fixed
 *                     multiplier, not a carrier schedule
 *   renewal_pending   direct estimate x 0.05 on production 730 or more days
 *                     old, a fixed multiplier
 * Only Direct YTD can show a figure, and only with the contract rate on file.
 * Override, trail and renewal show text whatever the server returned, so a
 * structural zero or an assumed multiplier never reads as money.
 */
export function commissionTypeTiles(input: {
  types: CommissionTypeFigures;
  rate: RateVerdict;
  /** The contract rate read is still running. */
  rateChecking: boolean;
  /** True for admin logins, the only ones /dashboard/finances admits. */
  financesVisible: boolean;
}): CommissionTypeTile[] {
  const direct = asNumber(input.types.direct_ytd);
  let directTile: CommissionTypeTile;
  if (input.rate === "on_file") {
    directTile =
      direct === null
        ? { id: "direct", label: "Direct YTD (estimate)", figure: { kind: "text", text: "Unavailable" }, detail: "the server returned no direct figure" }
        : { id: "direct", label: "Direct YTD (estimate)", figure: { kind: "amount", amount: direct }, detail: "at your saved comp level" };
  } else if (input.rate === "not_on_file") {
    directTile = {
      id: "direct",
      label: "Direct YTD (estimate)",
      figure: { kind: "text", text: "Unavailable" },
      detail: "comp level not on file; the server figure assumes a default",
    };
  } else {
    directTile = {
      id: "direct",
      label: "Direct YTD (estimate)",
      figure: { kind: "text", text: input.rateChecking ? "Loading" : "Unavailable" },
      detail: input.rateChecking ? "checking your comp level" : "comp level unverified",
    };
  }
  return [
    directTile,
    { id: "advance", label: "Advance estimate", figure: { kind: "text", text: "Unknown" }, detail: "The carrier advance schedule is not on file." },
    {
      id: "override",
      label: "Overrides",
      figure: { kind: "text", text: "Not in this view" },
      detail: input.financesVisible
        ? "Your own-production read leaves out team overrides; see Finances for the team view."
        : "Your own-production read leaves out team overrides.",
    },
    {
      id: "trail",
      label: "Trail",
      figure: { kind: "text", text: "Unknown" },
      detail: "The carrier as-earned schedule is not on file; the server assumes 25% of direct.",
    },
    {
      id: "renewal",
      label: "Renewal",
      figure: { kind: "text", text: "Unknown" },
      detail: "The renewal schedule is not on file; the server assumes 5% of direct.",
    },
  ];
}

/**
 * Whether the ledger read covers the whole record this login resolved to.
 * commission_ledger RLS, measured 2026-10-15: cl_own returns rows whose agent
 * belongs to an agents row with user_id = auth.uid(), and cl_admn returns
 * every row to has_role(auth.uid(), 'admin'). A login that reaches a record
 * under another login (or under none) through a merge therefore reads none of
 * that record's rows unless it is an admin, and the read comes back short with
 * no error. That is restricted, never a complete empty ledger.
 */
export function ledgerVisibility(input: {
  /** The login's own merged-away record, set only when the resolver followed a merge. */
  mergedFromAgentId: string | null | undefined;
  /** agents.user_id of the record the login resolved to. */
  recordUserId: string | null;
  viewerUserId: string | null;
  isAdmin: boolean;
  /** The login's roles are still loading, so isAdmin is not final. */
  rolesLoading: boolean;
}): LedgerVisibility {
  if (!input.mergedFromAgentId) return "complete";
  if (input.viewerUserId !== null && input.recordUserId === input.viewerUserId) return "complete";
  if (input.isAdmin) return "complete";
  return input.rolesLoading ? "checking" : "restricted";
}

/**
 * The state of the reconciled table.
 *   ledger failed with nothing cached            -> error (estimates are held; a failed ledger never reads as empty)
 *   any of the three reads still loading         -> loading
 *   all three loaded and no rows                 -> empty
 *   otherwise                                    -> ready (an estimates or contract failure is shown inline)
 */
export function ledgerSectionStatus(input: {
  ledger: QueryStatusInput;
  estimates: QueryStatusInput;
  contract: QueryStatusInput;
  rowCount: number;
}): QueryStatus {
  if (queryStatus(input.ledger) === "error") return "error";
  const reads = [input.ledger, input.estimates, input.contract];
  if (reads.some((q) => queryStatus(q) === "loading")) return "loading";
  const allLoaded = reads.every((q) => q.data !== undefined);
  return allLoaded && input.rowCount === 0 ? "empty" : "ready";
}

export const LEDGER_PAGE_SIZE = 1000;
/** Hard stop so a server that ignores the range can never loop forever. */
export const MAX_PAGES = 100;

/**
 * Read every row of a scoped query through PostgREST's 1000-row cap. The
 * page callback receives an inclusive [from, to] range. Any failed page
 * throws, so a partial read can never be mistaken for the whole ledger.
 */
export async function collectAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
  pageSize: number = LEDGER_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new RangeError(`invalid page size: ${pageSize}`);
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error instanceof Error ? error : new Error(errorMessage(error));
    if (!Array.isArray(data)) throw new Error("The read returned no result set.");
    all.push(...data);
    if (data.length < pageSize) return all;
  }
  throw new Error(`The read returned more than ${MAX_PAGES * pageSize} rows, which is more than this page expects.`);
}
