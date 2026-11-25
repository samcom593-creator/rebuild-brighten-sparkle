import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { looseSupabase } from "@/lib/looseSupabase";
import { cohortPlacement, parseCarrierPolicyCohort, type CarrierCohortScope, type CarrierPolicyCohort } from "@/lib/carrierPolicyCohort";
import { shiftDateKey } from "@/lib/businessClock";
import { Button } from "@/components/ui/button";

const LABELS: Record<CarrierCohortScope, string> = { personal: "Personal", downline: "Downline only", agency: "Agency" };
const money = (n: number | null) => n === null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export function CarrierPolicyCohortView({ data, scope = "personal", hidden = false }: { data: CarrierPolicyCohort; scope?: CarrierCohortScope; hidden?: boolean }) {
  const totals = data.scopes[scope];
  if (!totals) return <p className="text-sm text-muted-foreground">This production scope is unavailable to this account.</p>;
  const placement = cohortPlacement(totals);
  const show = (value: number | string) => hidden ? "Hidden" : String(value);
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">{LABELS[scope]} native site applications posted {data.window.start} through {shiftDateKey(data.window.end_exclusive, -1)} · Phoenix dates. Distinct posted records; imported and carrier-only policies are outside this cohort.</p>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[
        { label: "Posted applications", value: totals.posted_policies, note: `${money(totals.posted_ap)} posted AP` },
        { label: "Paying / paid · carrier status", value: money(totals.paying_status_ap), note: `${totals.paying_status_policies} matched policies · annual premium` },
        { label: "Carrier in force", value: totals.in_force_policies, note: "Coverage status; payment shown separately" },
        { label: "Paying-status placement", value: placement.percent === null ? "Unavailable" : `${placement.percent}%`, note: "Paying-status policies ÷ posted applications" },
      ].map(metric => <div key={metric.label} className="rounded-xl border border-border bg-background/50 p-3"><p className="text-xs text-muted-foreground">{metric.label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{show(metric.value)}</p><p className="mt-1 text-xs text-muted-foreground">{show(metric.note)}</p></div>)}
    </div>
    <div className="grid gap-2 text-sm sm:grid-cols-4" aria-label="Matched carrier outcomes">
      {[
        ["Pending", totals.pending_policies], ["Declined / not taken", totals.not_placed_policies],
        ["At risk", totals.at_risk_policies], ["Lapsed / cancelled", totals.lapsed_policies],
      ].map(([label, value]) => <p key={label} className="flex items-center justify-between gap-2 rounded-lg bg-muted/35 px-3 py-2"><span className="text-muted-foreground">{label}</span><strong>{show(value)}</strong></p>)}
    </div>
    <p className="text-xs text-muted-foreground">{hidden ? "Carrier matching and coverage counts hidden." : `Exact carrier matches: ${totals.matched_policies} / ${totals.posted_policies}. Unmatched: ${totals.unmatched_policies}; ambiguous: ${totals.ambiguous_policies}; conflicting status: ${totals.conflicting_policies}. Payment outcome supported for ${totals.payment_supported_policies} / ${totals.posted_policies}.`}</p>
    {placement.percent === null && <p className="text-xs text-muted-foreground">{hidden ? "Placement evidence hidden." : totals.posted_policies === 0 ? "No posted applications in this cohort, so there is no placement denominator." : "A total placement rate is withheld while any application has missing or unsupported payment evidence. Known carrier facts remain visible above."}</p>}
    <p className="text-xs text-muted-foreground">Carrier observations: {totals.oldest_observed_on ?? "unavailable"}{totals.newest_observed_on && totals.newest_observed_on !== totals.oldest_observed_on ? ` through ${totals.newest_observed_on}` : ""}. Paying / paid is an explicit carrier status; AP is annual premium, not premium receipts or commission cash.</p>
  </div>;
}

/** Shared by Dashboard and Finances; response identity and period are validated before display. */
export function CarrierPolicyCohortCard({ agentId, start, endExclusive, scope, hidden = false }: {
  agentId?: string | null; start: string; endExclusive: string; scope?: CarrierCohortScope; hidden?: boolean;
}) {
  const { user } = useAuth();
  const today = useBusinessToday();
  const [chosen, setChosen] = useState<CarrierCohortScope | null>(null);
  const query = useQuery({
    queryKey: ["production-policy-cohort", user?.id, agentId ?? null, start, endExclusive, today],
    enabled: Boolean(user?.id), staleTime: 120_000, retry: 1,
    queryFn: async () => {
      const { data, error } = await looseSupabase.rpc("production_policy_cohort", { p_start: start, p_end: endExclusive, p_agent_id: agentId ?? null });
      if (error) throw error;
      return parseCarrierPolicyCohort(data, { userId: user!.id, agentId, start, endExclusive });
    },
  });
  useProductionRealtime(() => { if (user?.id) void query.refetch({ cancelRefetch: false }); }, 800);
  const currentScope = agentId ? "personal" : chosen ?? scope ?? (query.data?.scopes.agency ? "agency" : "personal");
  return <section aria-label="Issued, paid and placement evidence" className="space-y-4 rounded-xl border border-border bg-card p-4">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold">Issued, paid &amp; placement evidence</h3><p className="mt-1 text-xs text-muted-foreground">A dated application cohort with explicit carrier matching.</p></div><Button variant="outline" size="sm" onClick={() => void query.refetch({ cancelRefetch: false })}>Refresh outcomes</Button></header>
    {!agentId && query.data && <div className="flex flex-wrap gap-2" role="group" aria-label="Policy outcome scope">{(["personal", "downline", "agency"] as const).filter(key => query.data!.scopes[key]).map(key => <Button key={key} size="sm" variant={key === currentScope ? "default" : "outline"} aria-pressed={key === currentScope} onClick={() => setChosen(key)}>{LABELS[key]}</Button>)}</div>}
    {query.isLoading ? <p className="text-sm text-muted-foreground">Matching posted applications to carrier outcomes…</p> : !query.data ? <p role="status" className="text-sm text-muted-foreground">Carrier matching could not be verified. Placement and payment figures are unavailable.</p> : <>
      {query.isError && <p role="status" className="text-xs text-destructive">Latest refresh failed. Showing the last verified cohort read.</p>}
      <CarrierPolicyCohortView data={query.data} scope={currentScope} hidden={hidden} />
    </>}
    {!agentId && <Link to="/dashboard/finances" className="inline-block text-xs font-semibold text-primary underline">Open policy and commission details</Link>}
  </section>;
}
