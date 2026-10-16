/**
 * My Commissions (F12 to F17 and F39 in the 2026-10-14 Galaxy OS map).
 *
 * Reads: the agent record through the shared resolver, the full scoped
 * commission_ledger (paged through PostgREST's 1000-row cap), the agent's
 * posted production from v_production_comp_truth, the contract rate from
 * fn_agent_contract_pct, and the commission type estimates from
 * finances_overview. Every read reports its own failure; a failed read is shown
 * as unavailable, never as an empty list or a zero, and a failed ledger never
 * switches the page to estimates.
 *
 * Ledger rows are written by a trigger at the rate source named on each row
 * (measured 2026-10-15: every row an override rate of 0 to 0.5 percent, none paid),
 * so a ledger row sits beside the contract-rate estimate for the same deal and
 * never replaces it, and ledger and estimate amounts are totalled separately.
 * Only a paid row with a payment date is an actual payment. A pending row on a
 * lapsed or cancelled deal will not be paid, so it is counted apart. Pairing
 * rules live in src/lib/commissionLedger.ts. Paid YTD uses actual_paid_date
 * inside the Phoenix business year; no browser-local date math on this page.
 *
 * Of the server's commission types only Direct YTD can show a number: the
 * 'mine' read has no override component, and trail and renewal are fixed
 * multipliers, so those tiles say so instead (commissionTypeTiles). A login
 * that reaches another login's record through a merge cannot read that
 * record's ledger under RLS, so every ledger figure reads Unavailable there
 * (ledgerVisibility) instead of a short read passing as the whole ledger.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { QueryState, describeQuery } from "@/components/ui/query-state";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { monthStartKey } from "@/lib/businessClock";
import { BUSINESS_TZ } from "@/lib/calendarTime";
import {
  closedDealPhrase,
  collectAllPages,
  commissionTypeTiles,
  dealStatusLabel,
  isDateKey,
  ledgerSectionStatus,
  ledgerStatusLabel,
  ledgerSummary,
  ledgerVisibility,
  monthBuckets,
  paidYearToDate,
  rateSourcePhrase,
  rateVerdictFromContracts,
  reconcileCommissions,
  type CommissionRow,
  type CommissionTypeFigures,
  type ContractRateRow,
  type LedgerPart,
  type LedgerRow,
  type ProductionEstimate,
  type RateVerdict,
  type TileFigure,
} from "@/lib/commissionLedger";
import { cn } from "@/lib/utils";

interface RawLedgerRow {
  id: string;
  deal_id: string;
  annual_premium: number | string;
  rate_pct: number | string;
  rate_source: string;
  amount: number | string;
  status: string;
  expected_paid_date: string | null;
  actual_paid_date: string | null;
  created_at: string | null;
  deal: {
    source: string | null;
    external_deal_id: string | null;
    status: string | null;
    client_first_name: string | null;
    client_last_name: string | null;
    product_sold: string | null;
    policy_number: string | null;
    carrier: { name: string | null } | null;
  } | null;
}

interface RawEstimateRow {
  row_key: string | null;
  policy_number: string | null;
  annual_premium: number | string | null;
  direct_estimate: number | string | null;
  seller_comp_pct: number | string | null;
  status: string | null;
  posted_date: string | null;
  client_name: string | null;
  product: string | null;
  carrier: string | null;
}

interface EstimateRead {
  rows: ProductionEstimate[];
  /** View rows with no row_key. They cannot be shown or paired, so they are counted in the notice instead of dropped silently. */
  withoutKeyCount: number;
}


interface ReadLike {
  isError: boolean;
  data: unknown;
  error: unknown;
  dataUpdatedAt: number;
}

const LEDGER_SELECT =
  "id, deal_id, annual_premium, rate_pct, rate_source, amount, status, expected_paid_date, actual_paid_date, created_at, deal:deals(source, external_deal_id, status, client_first_name, client_last_name, product_sold, policy_number, carrier:carriers(name))";

const ESTIMATE_SELECT =
  "row_key, policy_number, annual_premium, direct_estimate, seller_comp_pct, status, posted_date, client_name, product, carrier";

const INITIAL_VISIBLE_ROWS = 100;
const SHOW_MORE_STEP = 200;

function money(value: number, digits = 2): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** amount, rate_pct and annual_premium are NOT NULL numerics; anything else means the read is wrong, so it fails rather than showing a guess. */
function requireNumber(value: unknown, field: string, rowId: string): number {
  const n = numberOrNull(value);
  if (n === null) throw new Error(`The commission ledger returned a ${field} that is not a number (row ${rowId}).`);
  return n;
}

function fullName(first: string | null, last: string | null): string | null {
  const name = `${first ?? ""} ${last ?? ""}`.trim();
  return name.length ? name : null;
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function toLedgerRow(r: RawLedgerRow): LedgerRow {
  return {
    id: r.id,
    deal_id: r.deal_id,
    deal_source: r.deal?.source ?? null,
    external_deal_id: r.deal?.external_deal_id ?? null,
    deal_status: r.deal?.status ?? null,
    policy_number: r.deal?.policy_number ?? null,
    annual_premium: requireNumber(r.annual_premium, "premium", r.id),
    rate_pct: requireNumber(r.rate_pct, "rate", r.id),
    rate_source: r.rate_source,
    amount: requireNumber(r.amount, "amount", r.id),
    status: r.status,
    expected_paid_date: r.expected_paid_date,
    actual_paid_date: r.actual_paid_date,
    created_at: r.created_at,
    carrier_name: r.deal?.carrier?.name ?? null,
    client_name: r.deal ? fullName(r.deal.client_first_name, r.deal.client_last_name) : null,
    product: r.deal?.product_sold ?? null,
  };
}

function toEstimate(r: RawEstimateRow, rowKey: string): ProductionEstimate {
  return {
    row_key: rowKey,
    policy_number: r.policy_number,
    annual_premium: numberOrNull(r.annual_premium),
    seller_comp_pct: numberOrNull(r.seller_comp_pct),
    direct_estimate: numberOrNull(r.direct_estimate),
    posted_date: r.posted_date,
    status: r.status,
    carrier: r.carrier,
    client_name: r.client_name,
    product: r.product,
  };
}

/** The ledger for the resolved record and, after a merge, the login's own merged-away record, so rows booked to either show. */
async function fetchLedger(agentIds: string[]): Promise<LedgerRow[]> {
  const raw = await collectAllPages<RawLedgerRow>(async (from, to) => {
    // Explicit generics: the typed select parser recurses on the nested
    // deal -> carrier embed until tsc gives up (TS2589). RawLedgerRow is the
    // shape PostgREST returns for LEDGER_SELECT; the mapper below narrows it.
    const res = await supabase
      .from("commission_ledger")
      .select<string, RawLedgerRow>(LEDGER_SELECT)
      .in("agent_id", agentIds)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    return { data: res.data, error: res.error };
  });
  return raw.map(toLedgerRow);
}

async function fetchEstimates(agentId: string): Promise<EstimateRead> {
  const raw = await collectAllPages<RawEstimateRow>(async (from, to) => {
    const res = await supabase
      .from("v_production_comp_truth")
      .select(ESTIMATE_SELECT)
      .or(`agent_id.eq.${agentId},raw_agent_id.eq.${agentId}`)
      .order("posted_date", { ascending: false })
      .order("row_key", { ascending: true })
      .range(from, to);
    return { data: res.data as unknown as RawEstimateRow[] | null, error: res.error };
  });
  const rows: ProductionEstimate[] = [];
  let withoutKeyCount = 0;
  for (const r of raw) {
    if (typeof r.row_key === "string" && r.row_key !== "") rows.push(toEstimate(r, r.row_key));
    else withoutKeyCount += 1;
  }
  return { rows, withoutKeyCount };
}

/** fn_agent_contract_pct for the resolved record and, when the resolver followed a merge pointer, the merged-away record too. */
async function fetchContractRates(agentIds: string[]): Promise<ContractRateRow[]> {
  const results = await Promise.all(
    agentIds.map(async (id) => {
      const res = await supabase.rpc("fn_agent_contract_pct", { p_agent_id: id });
      if (res.error) throw res.error;
      if (!Array.isArray(res.data)) throw new Error("The contract rate read returned no result set.");
      return res.data as ContractRateRow[];
    }),
  );
  return results.flat();
}

/** Inline notice for a read that failed: an error with Retry when nothing is cached, a stale label when the last result is still on screen. */
function InlineReadNotice({ label, read, onRetry }: { label: string; read: ReadLike; onRetry: () => void }) {
  if (!read.isError) return null;
  if (read.data === undefined) return <QueryState status="error" compact label={label} error={read.error} onRetry={onRetry} />;
  return <QueryState status="ready" compact stale label={label} error={read.error} asOf={read.dataUpdatedAt} onRetry={onRetry} />;
}

const STATUS_BADGE: Record<string, string> = {
  paid: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  pending: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  clawed_back: "border-rose-500/40 text-rose-600 dark:text-rose-400",
  voided: "border-muted-foreground/40 text-muted-foreground",
};
const MUTED_BADGE = "border-muted-foreground/40 text-muted-foreground";

function ledgerBadgeClass(part: LedgerPart): string {
  // A paid row without a payment date is not presented as a payment.
  if (part.status === "paid" && !isDateKey(part.actualPaidDate)) return STATUS_BADGE.pending;
  return STATUS_BADGE[part.status] ?? MUTED_BADGE;
}

export default function MyCommissions() {
  const me = useAgentIdentity();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const todayKey = useBusinessToday();
  const monthKey = monthStartKey(todayKey);
  const businessYear = todayKey.slice(0, 4);
  const agentId = me.agentId;
  const identity = me.identity;
  // The resolved record and, when the resolver followed a merge pointer, the login's own merged-away record.
  const recordIds = useMemo(() => {
    if (identity?.status !== "resolved") return [] as string[];
    return identity.mergedFromAgentId ? [identity.agentId, identity.mergedFromAgentId] : [identity.agentId];
  }, [identity]);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ROWS);

  const ledger = useQuery({
    queryKey: ["my-commission-ledger", ...recordIds],
    enabled: recordIds.length > 0,
    queryFn: () => fetchLedger(recordIds),
  });

  const estimates = useQuery({
    queryKey: ["my-production-estimates", agentId],
    enabled: Boolean(agentId),
    queryFn: () => fetchEstimates(agentId as string),
  });

  const contract = useQuery({
    queryKey: ["my-contract-rate", ...recordIds],
    enabled: recordIds.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchContractRates(recordIds),
  });

  const commissionTypes = useQuery({
    queryKey: ["my-commission-types", agentId, monthKey],
    enabled: Boolean(agentId),
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finances_overview", { p_scope: "mine", p_month: monthKey });
      if (error) throw error;
      const types = (data as unknown as { commission_types?: CommissionTypeFigures } | null)?.commission_types;
      if (!types || typeof types !== "object") throw new Error("finances_overview returned no commission types.");
      return types;
    },
  });

  const rateVerdict: RateVerdict = contract.data ? rateVerdictFromContracts(contract.data) : "unknown";
  const rateChecking = contract.data === undefined && !contract.isError;
  const ledgerRows = ledger.data;
  const estimateRead = estimates.data;

  // RLS shows a login only the ledger rows of its own agents rows. After a merge into another login's record, a non-admin
  // reads none of that record's rows, so every ledger figure says so instead of a short read passing as the whole ledger.
  const visibility = ledgerVisibility({
    mergedFromAgentId: identity?.status === "resolved" ? identity.mergedFromAgentId : undefined,
    recordUserId: identity?.status === "resolved" ? identity.row.user_id : null,
    viewerUserId: me.userId,
    isAdmin,
    rolesLoading: authLoading,
  });
  const ledgerHiddenText = visibility === "complete" ? null : visibility === "checking" ? "Loading" : "Unavailable";
  const ledgerHiddenDetail = visibility === "restricted" ? "not visible to this login" : "checking ledger access";
  const mergedRecordName =
    identity?.status === "resolved" ? (identity.row.display_name ?? identity.row.agent_code ?? "another agent record") : "another agent record";

  // The ?? [] fallbacks below only feed children that QueryState renders once the ledger read has completed, so they never show as a book.
  const reconciled = useMemo(
    () => reconcileCommissions(ledgerRows ?? [], estimateRead?.rows, rateVerdict, BUSINESS_TZ),
    [ledgerRows, estimateRead, rateVerdict],
  );
  const production = reconciled.production;
  const summary = useMemo(() => ledgerSummary(ledgerRows ?? [], todayKey), [ledgerRows, todayKey]);
  const paidYtd = useMemo(() => paidYearToDate(ledgerRows ?? [], todayKey), [ledgerRows, todayKey]);
  const monthly = useMemo(() => monthBuckets(reconciled.rows, todayKey), [reconciled.rows, todayKey]);
  const monthTotals = monthly.months.reduce(
    (acc, m) => ({
      deals: acc.deals + m.deals,
      ledgerOnlyRows: acc.ledgerOnlyRows + m.ledgerOnlyRows,
      premium: acc.premium + m.premium,
      ledger: acc.ledger + m.ledger,
      estimate: acc.estimate + m.estimate,
      estimateExcluded: acc.estimateExcluded + m.estimateExcluded,
    }),
    { deals: 0, ledgerOnlyRows: 0, premium: 0, ledger: 0, estimate: 0, estimateExcluded: 0 },
  );
  const leftOutOfMonths = [
    monthly.closedLedgerOnlyCount > 0 ? plural(monthly.closedLedgerOnlyCount, "voided or clawed-back ledger row") : null,
    monthly.closedDealLedgerOnlyCount > 0
      ? `${plural(monthly.closedDealLedgerOnlyCount, "pending ledger row")} on closed deals, which will not be paid`
      : null,
    monthly.futureDatedCount > 0 ? `${plural(monthly.futureDatedCount, "row")} dated after today` : null,
    monthly.undatedCount > 0 ? `${plural(monthly.undatedCount, "row")} without a date` : null,
  ].filter((part): part is string => part !== null);

  const baseSectionStatus = ledgerSectionStatus({ ledger, estimates, contract, rowCount: reconciled.rows.length });
  // Until the admin role has loaded after a merge, it is not known whether the ledger read is whole, so nothing is called empty yet.
  const sectionStatus = baseSectionStatus !== "error" && visibility === "checking" ? "loading" : baseSectionStatus;
  const retryAll = () => {
    void ledger.refetch();
    void estimates.refetch();
    void contract.refetch();
  };

  let gate: ReactNode = null;
  if (me.isLoading) {
    gate = <QueryState status="loading" label="your agent record" />;
  } else if (identity?.status === "error") {
    gate = <QueryState status="error" label="your agent record" error={identity.message} onRetry={me.refetch} />;
  } else if (identity?.status === "ambiguous") {
    gate = (
      <QueryState
        status="empty"
        title="More than one agent record matches this login"
        body={`${plural(identity.candidates.length, "record")} match. Ask an admin to merge them. Nothing is shown until then.`}
      />
    );
  } else if (identity?.status === "none") {
    gate = <QueryState status="empty" title="This login has no agent record" body="Ask an admin to link it." />;
  }

  let chargebackFigure: TileFigure;
  let chargebackDetail: string;
  if (ledgerHiddenText !== null) {
    chargebackFigure = { kind: "text", text: ledgerHiddenText };
    chargebackDetail = ledgerHiddenDetail;
  } else if (ledgerRows !== undefined) {
    chargebackFigure = { kind: "amount", amount: summary.clawedBack.total };
    chargebackDetail = plural(summary.clawedBack.count, "ledger row");
  } else {
    chargebackFigure = { kind: "text", text: ledger.isPending ? "Loading" : "Unavailable" };
    chargebackDetail = "ledger not loaded";
  }
  // Only Direct YTD can carry a server figure; override, trail and renewal explain why they have none (commissionTypeTiles).
  const tiles: Array<{ id: string; label: string; figure: TileFigure; detail: string }> = [
    ...commissionTypeTiles({ types: commissionTypes.data ?? {}, rate: rateVerdict, rateChecking, financesVisible: isAdmin }),
    { id: "chargebacks", label: "Chargebacks (ledger)", figure: chargebackFigure, detail: chargebackDetail },
  ];

  const pendingSource = rateSourcePhrase(summary.pending.rateSources);
  const closedPending = summary.pendingOnClosedDeals;
  let closedPendingText: string | null = null;
  if (closedPending.count > 0) {
    const words = closedDealPhrase(closedPending.dealStatuses);
    const where = closedPending.count === 1 ? `on a ${words} deal` : `on ${words} deals`;
    closedPendingText = `${closedPending.count.toLocaleString()} more ${where} (${money(closedPending.total)}), not in this figure`;
  }
  const pendingDetail = [
    plural(summary.pending.count, "row"),
    pendingSource ? `${pendingSource}, unpaid` : null,
    summary.pending.pastExpectedCount > 0 ? `${summary.pending.pastExpectedCount.toLocaleString()} past expected pay date` : null,
    closedPendingText,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const excludedPhrase =
    rateVerdict === "not_on_file" ? "without a rate on file" : rateVerdict === "unknown" ? "with an unverified rate" : "that could not be priced";
  const countParts: string[] = [];
  if (visibility === "complete") countParts.push(plural(reconciled.ledgerRowCount, "ledger row"));
  else if (visibility === "restricted") countParts.push(`ledger rows Unavailable (${plural(reconciled.ledgerRowCount, "row")} on this login's own record)`);
  else countParts.push("ledger access still being checked");
  if (production === null) {
    countParts.push("production rows unavailable");
  } else {
    const paired = production.pairedByDealId + production.pairedByPolicyAndClient;
    countParts.push(plural(production.rowCount, "production row"));
    countParts.push(
      `${paired.toLocaleString()} paired by deal (${production.pairedByDealId.toLocaleString()} by deal id, ${production.pairedByPolicyAndClient.toLocaleString()} by policy number and client name)`,
    );
    if (production.ambiguousLedgerCount > 0) {
      countParts.push(`${plural(production.ambiguousLedgerCount, "ledger row")} could not be paired one to one and stayed unpaired`);
    }
    if (production.excludedCount > 0) {
      countParts.push(`${plural(production.excludedCount, "estimate")} ${excludedPhrase}, excluded from the estimate total`);
    }
  }
  if (estimateRead && estimateRead.withoutKeyCount > 0) {
    countParts.push(`${plural(estimateRead.withoutKeyCount, "production row")} without a key, not shown`);
  }

  const notShownText = rateVerdict === "not_on_file" ? "Not shown" : "Unavailable";
  const estimateTotalText =
    production === null ? "Unavailable" : production.estimateTotal !== null ? money(production.estimateTotal) : notShownText;
  // Paid rows plus pending rows on open deals; pending rows on closed deals will not be paid.
  const ledgerLiveTotal = summary.pending.total + summary.paid.total;

  /** A month's (or the year's) estimate figure: Unavailable without production, never a zero for amounts that were withheld. */
  const estimateFigure = (amount: number, rows: number, excluded: number): string => {
    if (production === null) return "Unavailable";
    if (rows > 0 && excluded === rows) return notShownText;
    return excluded > 0 ? `${money(amount, 0)} (${excluded.toLocaleString()} excluded)` : money(amount, 0);
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto page-enter">
      <PageHeader
        eyebrow="Production · Earnings"
        eyebrowIcon={<Wallet className="h-3 w-3" />}
        title="My Commissions"
        subtitle="Paid ledger rows are actuals; pending ledger rows and posted production are estimates from different rate sources."
      />

      {gate ?? (
        <>
          {identity?.status === "resolved" && identity.note && <p className="text-xs text-muted-foreground">{identity.note}</p>}

          <section>
            <div className="mb-2">
              <h2 className="text-sm font-semibold">Commission types</h2>
              <p className="text-xs text-muted-foreground">
                Server estimates from your own posted production. Only a paid ledger row with a payment date is an actual payment.
              </p>
            </div>
            <QueryState
              {...describeQuery(commissionTypes)}
              label="commission estimates"
              onRetry={() => void commissionTypes.refetch()}
              asOf={commissionTypes.dataUpdatedAt}
            >
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {tiles.map((tile) => (
                  <GlassCard key={tile.id} className="p-4">
                    <p className="text-xs text-muted-foreground">{tile.label}</p>
                    <p className="mt-1 text-xl font-bold tabular-nums">
                      {tile.figure.kind === "amount" ? money(tile.figure.amount, 0) : tile.figure.text}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{tile.detail}</p>
                  </GlassCard>
                ))}
              </div>
              {rateVerdict === "not_on_file" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Your contract rate is not on file. The server prices Direct YTD with a default rate, so it stays hidden until a rate is saved.
                </p>
              )}
              {rateVerdict === "unknown" && !rateChecking && (
                <p className="mt-2 text-xs text-muted-foreground">Your contract rate could not be verified, so Direct YTD is hidden until it loads.</p>
              )}
            </QueryState>
          </section>

          <QueryState
            {...describeQuery({ ...ledger, isEmpty: false })}
            label="the commission ledger"
            onRetry={() => void ledger.refetch()}
            asOf={ledger.dataUpdatedAt}
          >
            {visibility === "restricted" && (
              <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">
                This login reaches {mergedRecordName} through a merge. That record&apos;s commission ledger is visible only to its own login. Ask an
                admin to relink this login.
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <GlassCard className="p-4">
                <div className="text-xs text-muted-foreground">Pending in ledger</div>
                <div className="text-2xl font-bold tabular-nums">{ledgerHiddenText ?? money(summary.pending.total)}</div>
                <div className="text-xs text-muted-foreground mt-1">{ledgerHiddenText !== null ? ledgerHiddenDetail : pendingDetail}</div>
              </GlassCard>
              <GlassCard className="p-4">
                <div className="text-xs text-muted-foreground">Paid YTD · {businessYear}, Phoenix business days</div>
                <div className="text-2xl font-bold tabular-nums">{ledgerHiddenText ?? money(paidYtd.total)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {ledgerHiddenText !== null ? (
                    ledgerHiddenDetail
                  ) : (
                    <>
                      {plural(paidYtd.count, "deal")} paid since {paidYtd.yearStart}
                      {paidYtd.undatedPaidCount > 0 && ` · ${plural(paidYtd.undatedPaidCount, "paid row")} without a payment date, not counted`}
                      {paidYtd.futureDatedPaidCount > 0 && ` · ${plural(paidYtd.futureDatedPaidCount, "paid row")} dated after today, not counted`}
                    </>
                  )}
                </div>
              </GlassCard>
              <GlassCard className="p-4">
                <div className="text-xs text-muted-foreground">Clawed back (ledger)</div>
                <div
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    ledgerHiddenText === null && summary.clawedBack.total > 0 && "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {ledgerHiddenText ?? money(summary.clawedBack.total)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {ledgerHiddenText !== null ? ledgerHiddenDetail : plural(summary.clawedBack.count, "deal")}
                </div>
              </GlassCard>
            </div>
          </QueryState>

          <QueryState
            status={sectionStatus}
            stale={ledger.isError && ledgerRows !== undefined}
            error={ledger.error}
            asOf={ledger.dataUpdatedAt}
            onRetry={retryAll}
            label="the commission ledger"
            title={visibility === "restricted" ? "Nothing to show for this login" : "No commission rows yet"}
            body={
              visibility === "restricted"
                ? "No posted production is on file for this agent record, and its commission ledger is not visible to this login."
                : "No ledger rows and no posted production are on file for this agent record."
            }
          >
            <InlineReadNotice label="production estimates" read={estimates} onRetry={() => void estimates.refetch()} />
            <InlineReadNotice label="your contract rate" read={contract} onRetry={() => void contract.refetch()} />

            <GlassCard className="border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div className="space-y-1">
                  <p>
                    Each deal shows its ledger row and its production estimate side by side. The ledger books each row at the rate source named on
                    it, which can differ from your contract rate, so ledger and estimate amounts are totalled separately and never added together.
                  </p>
                  {production === null && <p>Production estimates could not load, so this list holds ledger rows only and nothing is paired.</p>}
                  {rateVerdict === "not_on_file" && <p>Your contract rate is not on file, so estimate amounts are not shown.</p>}
                  {rateVerdict === "unknown" && <p>Your contract rate could not be verified, so estimate amounts are hidden until it loads.</p>}
                  <p className="text-xs">{countParts.join(" · ")}</p>
                  <p className="text-xs">
                    Ledger, paid and pending on open deals: {ledgerHiddenText ?? money(ledgerLiveTotal)} · Estimate at your comp level:{" "}
                    {estimateTotalText}
                  </p>
                </div>
              </div>
            </GlassCard>

            {monthly.months.length > 0 ? (
              <GlassCard className="p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-border/40 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold">
                    By month · {businessYear} business year, Phoenix{production === null && " · ledger only, estimates unavailable"}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {plural(monthTotals.deals, "deal")} · {plural(monthTotals.ledgerOnlyRows, "ledger-only row")} · {money(monthTotals.premium, 0)}{" "}
                    premium · ledger {ledgerHiddenText ?? money(monthTotals.ledger)} · estimate{" "}
                    {estimateFigure(monthTotals.estimate, monthTotals.deals, monthTotals.estimateExcluded)}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/20">
                      <tr>
                        <th className="text-left px-3 py-2">Month</th>
                        <th className="text-right px-3 py-2">Deals</th>
                        <th className="text-right px-3 py-2">Ledger only</th>
                        <th className="text-right px-3 py-2">Premium</th>
                        <th className="text-right px-3 py-2">Ledger</th>
                        <th className="text-right px-3 py-2">Estimate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthly.months.map((m) => (
                        <tr key={m.key} className="border-t border-border/20">
                          <td className="px-3 py-1.5 font-medium">{m.label}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{m.deals.toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{m.ledgerOnlyRows.toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(m.premium, 0)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{ledgerHiddenText ?? money(m.ledger)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{estimateFigure(m.estimate, m.deals, m.estimateExcluded)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2 border-t border-border/40 text-[11px] text-muted-foreground">
                  Deals are posted production rows, each counted once whether or not a ledger row is paired with it. A ledger row with no
                  production pair is counted on its own under Ledger only and adds no premium. Ledger is paid rows and pending rows on open deals;
                  estimate is your comp level on posted production.
                  {leftOutOfMonths.length > 0 && ` Not in this table: ${leftOutOfMonths.join("; ")}.`}
                </p>
              </GlassCard>
            ) : (
              leftOutOfMonths.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  No rows fall in the {businessYear} business year so far. Not in the month table: {leftOutOfMonths.join("; ")}.
                </p>
              )
            )}

            <GlassCard className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 text-sm font-semibold">
                {production === null
                  ? `Ledger rows (${reconciled.rows.length.toLocaleString()}) · ledger only, estimates unavailable`
                  : `Ledger and estimates (${plural(reconciled.rows.length, "row")})`}
              </div>
              {reconciled.rows.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  {production === null ? "No ledger rows are on file, and production estimates could not load." : "No rows to show."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/20">
                      <tr>
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-left px-3 py-2">Client</th>
                        <th className="text-left px-3 py-2">Carrier</th>
                        <th className="text-left px-3 py-2">Product</th>
                        <th className="text-right px-3 py-2">Premium</th>
                        <th className="text-right px-3 py-2">Ledger</th>
                        <th className="text-right px-3 py-2">Ledger rate</th>
                        <th className="text-left px-3 py-2">Ledger status</th>
                        <th className="text-right px-3 py-2">Estimate</th>
                        <th className="text-right px-3 py-2">Estimate rate</th>
                        <th className="text-left px-3 py-2">Expected pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciled.rows.slice(0, visibleCount).map((r: CommissionRow) => {
                        const closedLabel = r.ledger ? dealStatusLabel(r.ledger.dealStatus) : null;
                        return (
                          <tr key={r.id} className="border-t border-border/20 align-top">
                            <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                              {r.businessDate ?? "Not on file"}
                              {r.estimate === null && r.businessDate !== null && <span className="block text-[10px]">ledger booking</span>}
                            </td>
                            <td className="px-3 py-1.5 font-medium">{r.clientName ?? "Not on file"}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{r.carrierName ?? "Not on file"}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{r.product ?? "Not on file"}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{r.annualPremium === null ? "Unavailable" : money(r.annualPremium)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {r.ledger ? (
                                <>
                                  <span className="font-semibold">{money(r.ledger.amount)}</span>
                                  {r.annualPremium !== null && r.ledger.annualPremium !== r.annualPremium && (
                                    <span className="block text-[10px] text-muted-foreground">on {money(r.ledger.annualPremium)} premium</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted-foreground">{ledgerHiddenText ?? "No ledger row"}</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.ledger?.rateLabel}</td>
                            <td className="px-3 py-1.5">
                              {r.ledger && (
                                <Badge variant="outline" className={ledgerBadgeClass(r.ledger)}>
                                  {ledgerStatusLabel(r.ledger)}
                                </Badge>
                              )}
                              {closedLabel && <span className="mt-0.5 block text-[10px] text-rose-600 dark:text-rose-400">{closedLabel}</span>}
                              {r.ambiguous && (
                                <span className="mt-0.5 block text-[10px] text-muted-foreground">not paired: no one-to-one production match</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {r.estimate ? (
                                r.estimate.amount === null ? (
                                  <span className="text-muted-foreground">Excluded</span>
                                ) : (
                                  <span className="font-semibold">{money(r.estimate.amount)}</span>
                                )
                              ) : (
                                <span className="text-muted-foreground">{production === null ? "Unavailable" : "No production row"}</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.estimate?.rateLabel}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">
                              {r.ledger ? (
                                <>
                                  {r.ledger.expectedPaidDate ?? "Not on file"}
                                  {r.ledger.status === "pending" &&
                                    !r.ledger.dealClosed &&
                                    isDateKey(r.ledger.expectedPaidDate) &&
                                    r.ledger.expectedPaidDate < todayKey && <span className="block text-[10px]">past due, unpaid</span>}
                                </>
                              ) : (
                                (ledgerHiddenText ?? "Not scheduled")
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {reconciled.rows.length > visibleCount && (
                <div className="flex flex-wrap items-center justify-center gap-3 py-4 text-sm">
                  <span className="text-muted-foreground">
                    Showing {visibleCount.toLocaleString()} of {reconciled.rows.length.toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => setVisibleCount((n) => n + SHOW_MORE_STEP)}
                    className="rounded-md border border-border bg-muted/40 px-4 py-1.5 font-medium text-foreground transition hover:bg-muted"
                  >
                    Show more ({(reconciled.rows.length - visibleCount).toLocaleString()} hidden)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleCount(reconciled.rows.length)}
                    className="rounded-md px-3 py-1.5 font-medium text-primary transition hover:underline"
                  >
                    Show all
                  </button>
                </div>
              )}
            </GlassCard>
          </QueryState>
          {sectionStatus === "error" && (
            <p className="text-xs text-muted-foreground">Production estimates are held until the ledger loads, so no deal shows without its ledger row.</p>
          )}
        </>
      )}
    </div>
  );
}
