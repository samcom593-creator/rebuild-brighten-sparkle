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
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CommissionOverview, CommissionCharts, CommissionPolicyLedger } from "@/components/finances/CommissionWorkspace";
import { PageHeader } from "@/components/ui/page-header";
import { QueryState, describeQuery } from "@/components/ui/query-state";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { monthStartKey } from "@/lib/businessClock";
import { BUSINESS_TZ } from "@/lib/calendarTime";
import {
  collectAllPages,
  commissionTypeTiles,
  ledgerSectionStatus,
  ledgerVisibility,
  rateVerdictFromContracts,
  reconcileCommissions,
  type CommissionTypeFigures,
  type ContractRateRow,
  type LedgerRow,
  type ProductionEstimate,
  type RateVerdict,
} from "@/lib/commissionLedger";

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

export default function MyCommissions({ embedded = false }: { embedded?: boolean }) {
  const me = useAgentIdentity();
  const { user, isAdmin, isLoading: authLoading } = useAuth();
  const todayKey = useBusinessToday();
  const monthKey = monthStartKey(todayKey);
  const belongsToViewer = Boolean(user && me.userId === user.id);
  const identity = belongsToViewer ? me.identity : undefined;
  const agentId = !authLoading && belongsToViewer && identity?.status === "resolved" ? me.agentId : null;
  // The resolved record and, when the resolver followed a merge pointer, the login's own merged-away record.
  const recordIds = useMemo(() => {
    if (!agentId || identity?.status !== "resolved") return [] as string[];
    return identity.mergedFromAgentId ? [identity.agentId, identity.mergedFromAgentId] : [identity.agentId];
  }, [agentId, identity]);

  const ledger = useQuery({
    queryKey: ["my-commission-ledger", user?.id ?? null, ...recordIds],
    enabled: recordIds.length > 0,
    queryFn: () => fetchLedger(recordIds),
  });

  const estimates = useQuery({
    queryKey: ["my-production-estimates", user?.id ?? null, agentId],
    enabled: Boolean(agentId),
    queryFn: () => fetchEstimates(agentId as string),
  });

  const contract = useQuery({
    queryKey: ["my-contract-rate", user?.id ?? null, ...recordIds],
    enabled: recordIds.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchContractRates(recordIds),
  });

  const commissionTypes = useQuery({
    queryKey: ["my-commission-types", user?.id ?? null, agentId, monthKey],
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
  const mergedRecordName =
    identity?.status === "resolved" ? (identity.row.display_name ?? identity.row.agent_code ?? "another agent record") : "another agent record";

  // The ?? [] fallbacks below only feed children that QueryState renders once the ledger read has completed, so they never show as a book.
  const reconciled = useMemo(
    () => reconcileCommissions(ledgerRows ?? [], estimateRead?.rows, rateVerdict, BUSINESS_TZ),
    [ledgerRows, estimateRead, rateVerdict],
  );
  const production = reconciled.production;
  const baseSectionStatus = ledgerSectionStatus({ ledger, estimates, contract, rowCount: reconciled.rows.length });
  // Until the admin role has loaded after a merge, it is not known whether the ledger read is whole, so nothing is called empty yet.
  const sectionStatus = baseSectionStatus !== "error" && visibility === "checking" ? "loading" : baseSectionStatus;
  const retryAll = () => {
    void ledger.refetch();
    void estimates.refetch();
    void contract.refetch();
    void commissionTypes.refetch();
  };

  let gate: ReactNode = null;
  if (authLoading || me.isLoading || !belongsToViewer) {
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

  const tiles = commissionTypeTiles({ types: commissionTypes.data ?? {}, rate: rateVerdict, rateChecking, financesVisible: isAdmin });

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
  return (
    <div className={embedded ? "space-y-5" : "p-4 md:p-6 space-y-6 max-w-7xl mx-auto page-enter"}>
      {!embedded && <PageHeader eyebrow="Your business" eyebrowIcon={<Wallet className="h-3 w-3" />} title="Finances" subtitle="Policies, commissions and recorded payments." />}
      {gate ?? (
        <section className="space-y-5" aria-label="Your issue and payment workspace">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="galaxy-heading text-2xl font-black italic uppercase">Issue &amp; pay</h2><p className="mt-1 text-base text-muted-foreground">Your policy commissions. Every rate, status and payment in view.</p></div>
            <Button type="button" variant="outline" disabled={ledger.isFetching || estimates.isFetching || contract.isFetching || commissionTypes.isFetching} onClick={retryAll}><RefreshCw aria-hidden className="h-4 w-4" /> Refresh finances</Button>
          </div>
          {identity?.status === "resolved" && identity.note && <p className="text-sm text-muted-foreground">{identity.note}</p>}
          <QueryState {...describeQuery({ ...ledger, isEmpty: false })} label="the commission ledger" onRetry={retryAll} asOf={ledger.dataUpdatedAt}>
            {visibility === "restricted" && <p className="mb-4 text-sm text-amber-800 dark:text-amber-300">
              This login reaches {mergedRecordName} through a merge. That record&apos;s commission ledger is visible only to its own login. Ask an admin to relink this login.
            </p>}
            <div className="space-y-5">
              <CommissionOverview ledgerRows={ledgerRows ?? []} todayKey={todayKey} hiddenLabel={ledgerHiddenText} />
              <QueryState status={sectionStatus} onRetry={retryAll} label="the commission ledger"
                title={visibility === "restricted" ? "Nothing to show for this login" : "No commission rows yet"}
                body={visibility === "restricted" ? "No posted production is on file for this agent record, and its commission ledger is not visible to this login." : "No ledger rows and no posted production are on file for this agent record."}>
                <div className="space-y-5">
                  <InlineReadNotice label="production estimates" read={estimates} onRetry={() => void estimates.refetch()} />
                  <InlineReadNotice label="your contract rate" read={contract} onRetry={() => void contract.refetch()} />
                  {visibility === "complete" && <CommissionCharts ledgerRows={ledgerRows ?? []} rows={reconciled.rows} todayKey={todayKey} />}
                  <CommissionPolicyLedger key={`${user?.id}:${agentId}`} rows={reconciled.rows} todayKey={todayKey} ledgerHiddenText={ledgerHiddenText} hasProduction={production !== null} />
                  <details className="rounded-xl border border-border bg-card p-4 sm:p-5">
                    <summary className="cursor-pointer text-base font-bold">Rates, estimates &amp; record matching</summary>
                    <div className="mt-4 space-y-4 text-sm text-muted-foreground">
                      <p>Ledger rows use their recorded payout rate. Contract estimates are separate amounts and are never added to paid cash. A source status or an effective date does not prove an issue date or a premium payment.</p>
                      {production === null && <p>Production estimates could not load, so this list holds ledger rows only and nothing is paired.</p>}
                      {rateVerdict === "not_on_file" && <p>Your contract rate is not on file, so estimate amounts are not shown.</p>}
                      {rateVerdict === "unknown" && <p>Your contract rate could not be verified, so estimate amounts are hidden until it loads.</p>}
                      <p>{countParts.join(" · ")}</p>
                      <p className="font-semibold text-foreground">Posted-production contract estimate: {estimateTotalText}</p>
                      <QueryState {...describeQuery(commissionTypes)} label="commission estimates" onRetry={() => void commissionTypes.refetch()} asOf={commissionTypes.dataUpdatedAt}>
                        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{tiles.map(tile => <div key={tile.id} className="rounded-lg border border-border p-4">
                          <dt className="font-semibold text-foreground">{tile.label}</dt><dd className="galaxy-stat mt-2 text-2xl font-black tabular-nums text-foreground">{tile.figure.kind === "amount" ? money(tile.figure.amount) : tile.figure.text}</dd><dd className="mt-2">{tile.detail}</dd>
                        </div>)}</dl>
                      </QueryState>
                    </div>
                  </details>
                </div>
              </QueryState>
            </div>
          </QueryState>
          {sectionStatus === "error" && <p className="text-sm text-muted-foreground">Production estimates are held until the ledger loads, so no deal shows without its ledger row.</p>}
        </section>
      )}
    </div>
  );
}
