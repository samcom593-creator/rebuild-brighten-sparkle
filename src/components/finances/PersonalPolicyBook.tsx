import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { QueryState, describeQuery } from "@/components/ui/query-state";
import {
  financePolicySummary, financePolicyCoverage, financePremiumPaying, parseFinancePolicyBook, POLICY_COVERAGE_LABELS,
  type FinancePolicyBook, type PolicyCoverage,
} from "@/lib/financePolicyBook";

const currency = (value: number | null) => value === null ? "Not reported" : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const INITIAL_ROWS = 100;
const COVERAGE_COLORS: Record<PolicyCoverage, string> = {
  active: "bg-emerald-500", claim: "bg-emerald-300", pending: "bg-cyan-400", at_risk: "bg-amber-400",
  lapsed: "bg-rose-500", not_taken: "bg-orange-400", declined: "bg-red-600", abandoned: "bg-violet-400", unknown: "bg-slate-400",
};

/** The source supplies issued totals and explicit current premium-paying
 * states, but no dated premium receipts or matching submission denominator. */
export function PolicyFinancialEvidence({ book }: { book: FinancePolicyBook }) {
  const paying = financePremiumPaying(book.policies);
  const portal = book.ethosPortal;
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Issue and placement evidence">
      <div>
        <h3 className="galaxy-heading text-xl font-black italic uppercase">Issue, payment &amp; placement</h3>
        <p className="mt-1 text-sm text-muted-foreground">Current carrier book and latest available portal report. These are separate sources, not one combined production total.</p>
      </div>
      <div className={`grid gap-3 ${portal ? "lg:grid-cols-3" : "sm:grid-cols-2"}`}>
        <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-4">
          <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Premium-paying AP · carrier status</p>
          <p className="galaxy-stat mt-3 break-words text-3xl font-black italic tabular-nums text-emerald-700 dark:text-emerald-300">{paying.annualPremium === null ? "Incomplete" : currency(paying.annualPremium)}</p>
          <p className="mt-2 text-sm text-muted-foreground">{paying.policies.toLocaleString()} {paying.policies === 1 ? "policy reports" : "policies report"} an explicit Ethos premium-paying status.</p>
          {paying.missingPremium > 0 && <p className="mt-2 text-sm text-muted-foreground">Known AP: {currency(paying.knownAnnualPremium)} · {paying.missingPremium} missing premium.</p>}
          <p className="mt-2 text-sm text-muted-foreground">{paying.otherPolicies.toLocaleString()} other carrier {paying.otherPolicies === 1 ? "record is" : "records are"} excluded. This is annual premium associated with current status, not premium cash received.</p>
        </div>
        {portal && <>
          <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Ethos issued AP · portal</p>
            <p className="galaxy-stat mt-3 break-words text-3xl font-black italic tabular-nums">{portal.issuedAnnualPremium === null ? "Unavailable" : currency(portal.issuedAnnualPremium)}</p>
            <p className="mt-2 text-sm text-muted-foreground">All-time issued annual premium reported by Ethos.</p>
          </div>
          <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-4">
            <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Ethos in-force AP · portal</p>
            <p className="galaxy-stat mt-3 break-words text-3xl font-black italic tabular-nums text-cyan-700 dark:text-cyan-300">{portal.inforceIssuedAnnualPremium === null ? "Unavailable" : currency(portal.inforceIssuedAnnualPremium)}</p>
            <p className="mt-2 text-sm text-muted-foreground">Issued premium currently reported in force by Ethos.</p>
          </div>
        </>}
      </div>
      {portal && <p className="text-sm text-muted-foreground">Portal totals belong to the matched carrier NPN and may include its downline. They are not added to your policy-row totals. This response does not include the portal snapshot date.</p>}
      <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
        <div><div className="text-sm font-bold">Issued &amp; paid AP <Badge variant="outline" className="ml-2 text-sm">Unavailable</Badge></div><p className="mt-2 text-sm text-muted-foreground">No verified premium-payment receipts or issue/payment dates are supplied.</p></div>
        <div><div className="text-sm font-bold">Placement rate <Badge variant="outline" className="ml-2 text-sm">Unavailable</Badge></div><p className="mt-2 text-sm text-muted-foreground">Requires issued-and-paid policies and submitted policies from the same cohort. In-force share and retention are different measures.</p></div>
      </div>
    </section>
  );
}

/** Pure presentation for the authorized carrier response, including synthetic visual QA. */
export function PolicyBookView({ book, onViewPayments }: { book: FinancePolicyBook; onViewPayments?: () => void }) {
  const [search, setSearch] = useState("");
  const [coverage, setCoverage] = useState<"all" | PolicyCoverage>("all");
  const [carrierStatus, setCarrierStatus] = useState("all");
  const [visibleCount, setVisibleCount] = useState(INITIAL_ROWS);
  const summary = useMemo(() => financePolicySummary(book.policies), [book.policies]);
  const coverageMix = useMemo(() => financePolicyCoverage(book.policies), [book.policies]);
  const statusOptions = useMemo(() => Array.from(new Set(book.policies.flatMap(policy => policy.rawStatus ? [policy.rawStatus] : []))).sort(), [book.policies]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return book.policies.filter(policy => (coverage === "all" || policy.coverage === coverage) && (carrierStatus === "all" || policy.rawStatus === carrierStatus) && (!needle ||
      [policy.policyNumber, policy.client, policy.carrier, policy.product, policy.rawStatus].some(value => value?.toLocaleLowerCase().includes(needle))));
  }, [book.policies, search, coverage, carrierStatus]);
  const metrics = [
    { label: "Policies", value: summary.policies.toLocaleString(), detail: "Carrier records", color: "text-cyan-700 dark:text-cyan-300" },
    { label: "In force", value: summary.inForce.toLocaleString(), detail: "Includes claim status", color: "text-emerald-700 dark:text-emerald-300" },
    { label: "At risk", value: summary.atRisk.toLocaleString(), detail: "Carrier coverage status", color: "text-amber-700 dark:text-amber-300" },
    { label: "Annual premium", value: summary.missingPremium === summary.policies && summary.policies > 0 ? "Unavailable" : currency(summary.annualPremium), detail: summary.missingPremium ? `${summary.missingPremium} missing premium · partial total` : "Across the listed policies", color: "text-emerald-700 dark:text-emerald-300" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(metric => <div key={metric.label} className="min-w-0 rounded-xl border-2 border-border bg-card p-5">
          <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{metric.label}</p>
          <p className={`galaxy-stat mt-3 break-words text-4xl font-black italic tabular-nums ${metric.color}`}>{metric.value}</p>
          <p className="mt-3 text-sm text-muted-foreground">{metric.detail}</p>
        </div>)}
      </div>
      <PolicyFinancialEvidence book={book} />
      {book.policies.length > 0 && <section className="rounded-xl border border-border bg-card p-5" aria-label="Carrier coverage distribution">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2"><h3 className="galaxy-heading text-xl font-black italic uppercase">Carrier coverage</h3><p className="text-sm text-muted-foreground">Policy counts · known annual premium</p></div>
        <div role="img" aria-label={`${coverageMix.map(group => `${group.label}: ${group.count}`).join(", ")}. Annual premium: ${coverageMix.map(group => `${group.label}: ${group.missingPremium === group.count ? "unavailable" : currency(group.annualPremium)}${group.missingPremium > 0 && group.missingPremium < group.count ? " partial" : ""}`).join(", ")}.`} className="space-y-4">
          {coverageMix.map(group => <div key={group.key}>
            <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm"><span className="font-semibold">{group.label} <span className="ml-2 tabular-nums">{group.count.toLocaleString()}</span></span><span className="tabular-nums text-muted-foreground">{group.missingPremium === group.count ? "Premium unavailable" : currency(group.annualPremium)}{group.missingPremium > 0 && group.missingPremium < group.count ? " · partial" : ""}</span></div>
            <div className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden><div className={`h-full rounded-full ${COVERAGE_COLORS[group.key]}`} style={{ width: `${group.count / book.policies.length * 100}%` }} /></div>
          </div>)}
        </div>
      </section>}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <p className="max-w-3xl text-sm text-muted-foreground"><strong className="text-foreground">Coverage is not payment.</strong> Raw carrier status is shown below. This source has no commission-payment receipts or issue dates.</p>
        {onViewPayments && <Button type="button" variant="outline" onClick={onViewPayments}>View commission payments</Button>}
      </div>
      <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card" aria-label="Carrier policy details">
        <div className="space-y-4 border-b border-border p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="galaxy-heading text-2xl font-black italic uppercase">Policy details</h3><p className="text-sm text-muted-foreground">{filtered.length.toLocaleString()} of {book.policies.length.toLocaleString()} policies</p></div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="relative min-w-0"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden /><Input value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(INITIAL_ROWS); }} className="h-11 pl-9 text-base" aria-label="Search your policies" placeholder="Policy, product, client or carrier" /></div>
            <select aria-label="Carrier issue status" value={carrierStatus} onChange={event => { setCarrierStatus(event.target.value); setVisibleCount(INITIAL_ROWS); }} className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-base text-foreground md:max-w-52"><option value="all">All carrier statuses</option>{statusOptions.map(status => <option key={status} value={status}>{status}</option>)}</select>
            <select aria-label="Coverage" value={coverage} onChange={event => { setCoverage(event.target.value as "all" | PolicyCoverage); setVisibleCount(INITIAL_ROWS); }} className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-base text-foreground"><option value="all">All coverage</option>{Object.entries(POLICY_COVERAGE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px] text-sm">
            <caption className="sr-only">Carrier policy product, policy number, issue status, coverage, annual premium, effective date and recorded chargeback. No commission-payment inference.</caption>
            <thead className="bg-muted/40"><tr>{["Policy / product", "Carrier", "Issue / coverage status", "Annual premium", "Effective date", "Recorded chargeback"].map(label => <th key={label} scope="col" className="px-4 py-3 text-left text-sm font-bold uppercase tracking-wide text-muted-foreground">{label}</th>)}</tr></thead>
            <tbody>{filtered.slice(0, visibleCount).map(policy => <tr key={policy.key} className="border-t border-border align-top">
              <td className="max-w-64 px-4 py-4"><p className="break-words text-base font-bold">{policy.product ?? "Product not reported"}</p><p className="mt-1 break-words font-semibold">{policy.policyNumber ?? "Policy number not reported"}</p><p className="mt-1 break-words text-muted-foreground">{policy.client ?? "Client not reported"}</p></td>
              <td className="px-4 py-4"><p className="font-semibold">{policy.carrier}</p>{policy.underwriter && <p className="mt-1 text-muted-foreground">{policy.underwriter}</p>}</td>
              <td className="max-w-64 px-4 py-4"><p className="font-semibold">{policy.rawStatus ?? "Carrier status not reported"}</p><Badge variant="outline" className="mt-2 text-sm">{POLICY_COVERAGE_LABELS[policy.coverage]}</Badge>{policy.closeReason && <p className="mt-2 text-muted-foreground">{policy.closeReason}</p>}{policy.changedOn && <p className="mt-2 text-muted-foreground">Changed {policy.changedOn}</p>}</td>
              <td className="px-4 py-4"><p className="font-bold tabular-nums">{currency(policy.annualPremium)}</p><p className="mt-2 text-muted-foreground">Face amount: {currency(policy.faceAmount)}</p></td>
              <td className="px-4 py-4"><p className="font-semibold tabular-nums">{policy.effectiveOn ?? "Not reported"}</p>{policy.soldOn && <p className="mt-2 text-muted-foreground">Sold {policy.soldOn}</p>}</td>
              <td className="px-4 py-4 font-semibold tabular-nums">{policy.chargeback === null ? "Not recorded" : currency(policy.chargeback)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {filtered.length === 0 && <p className="p-6 text-base text-muted-foreground">No policies match these filters.</p>}
        {filtered.length > visibleCount && <div className="border-t border-border p-4"><Button variant="outline" type="button" onClick={() => setVisibleCount(value => value + 100)}>Show 100 more policies</Button></div>}
      </section>
      <details className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground"><summary className="cursor-pointer text-base font-bold text-foreground">How to read this book</summary><p className="mt-3">Carrier book: Ethos and Combined. A lapse is a coverage status; only a separately recorded amount appears as a chargeback. Effective date is not an issue date or payment date. Commission payment status and payment dates are in Issue &amp; pay; an issued or in-force policy does not confirm a commission payment.</p></details>
    </div>
  );
}

export function PersonalPolicyBook({ onViewPayments }: { onViewPayments?: () => void } = {}) {
  const { user, isLoading: authLoading } = useAuth();
  const me = useAgentIdentity();
  const belongsToViewer = Boolean(user && me.userId === user.id);
  const agentId = belongsToViewer && !authLoading && me.identity?.status === "resolved" ? me.agentId : null;
  const query = useQuery({
    queryKey: ["finance-policy-book", user?.id ?? null, agentId],
    enabled: Boolean(agentId),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("agent_carrier_book" as never, { p_agent_id: agentId } as never);
      if (error) throw error;
      return parseFinancePolicyBook(data, agentId!);
    },
  });
  if (authLoading || me.isLoading || !belongsToViewer) return <QueryState status="loading" label="your agent record" />;
  if (me.identity?.status === "error" || me.isError) return <QueryState status="error" label="your agent record" error={me.identity?.status === "error" ? me.identity.message : "Your agent record could not load."} onRetry={me.refetch} />;
  if (me.identity?.status === "ambiguous") return <QueryState status="empty" title="More than one agent record matches this login" body="Ask an admin to merge the records before viewing your policies." />;
  if (!agentId) return <QueryState status="empty" title="This login has no agent record" body="Ask an admin to link it." />;
  return (
    <section className="space-y-4" aria-label="Your policy book">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-2xl font-black italic uppercase">Your policy book</h2>{query.data?.asOf && <p className="mt-1 text-sm text-muted-foreground">Carrier sync: {new Date(query.data.asOf).toLocaleString()}</p>}</div>
        <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" aria-hidden /> Refresh policies</Button>
      </div>
      <QueryState {...describeQuery({ ...query, isEmpty: query.data?.policies.length === 0 && !query.data?.ethosPortal })} label="your policy book" onRetry={() => void query.refetch()} asOf={query.dataUpdatedAt} title="No carrier policies on file" body="No Ethos or Combined policy records were returned for your linked agent record.">
        {query.data && <PolicyBookView key={`${user!.id}:${agentId}`} book={query.data} onViewPayments={onViewPayments} />}
      </QueryState>
    </section>
  );
}
