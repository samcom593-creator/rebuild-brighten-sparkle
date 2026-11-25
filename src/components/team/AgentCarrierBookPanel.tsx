import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { type CarrierCoverage } from "@/lib/carrierPolicyStatus";
import {
  financePaidStatus, financePolicySummary, parseFinancePolicyBook,
  type FinancePolicy, type FinancePolicyBook,
} from "@/lib/financePolicyBook";
import { cn } from "@/lib/utils";

const usd = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? "—"
  : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const day = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" }) : "Unknown";
const hasChargeback = (p: FinancePolicy) => p.chargeback !== null && p.chargeback !== 0;
const statusTone = (coverage: CarrierCoverage) => ["active", "claim"].includes(coverage) ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  : ["at_risk", "pending"].includes(coverage) ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  : ["lapsed", "declined", "not_taken"].includes(coverage) ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300" : "border-border bg-muted text-muted-foreground";
const FILTERS: Array<{ key: string; label: string; match: (p: FinancePolicy) => boolean }> = [
  { key: "all", label: "All policies", match: () => true },
  { key: "paying", label: "Paying / paid status", match: p => ["premium_paying", "paid"].includes(p.payment) },
  { key: "active", label: "In force", match: p => ["active", "claim"].includes(p.coverage) },
  { key: "pending", label: "Pending", match: p => p.coverage === "pending" },
  { key: "declined", label: "Declined / not taken", match: p => ["declined", "not_taken", "abandoned"].includes(p.coverage) },
  { key: "at_risk", label: "At risk", match: p => p.coverage === "at_risk" },
  { key: "lapsed", label: "Lapsed / cancelled", match: p => p.coverage === "lapsed" },
  { key: "chargeback", label: "Recorded chargebacks", match: hasChargeback },
  { key: "unknown", label: "Status unknown", match: p => p.coverage === "unknown" },
];
function premiumNote(summary: Pick<ReturnType<typeof financePolicySummary>, "policies" | "annualPremium" | "missingPremium">) {
  if (summary.policies === 0) return "No policies in this group";
  if (summary.missingPremium === summary.policies) return `Annual premium unavailable · ${summary.missingPremium} missing premium`;
  return summary.missingPremium > 0
    ? `${usd(summary.annualPremium)} known annual premium · ${summary.missingPremium} missing premium · partial total`
    : `${usd(summary.annualPremium)} annual premium on file`;
}
function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="min-w-0 rounded-xl border border-border bg-background/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>;
}

/** Current carrier evidence, including declined policies excluded from posted production. */
export function AgentCarrierBookPanel({ agentId, compact = false }: { agentId: string; compact?: boolean }) {
  const { user } = useAuth();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["agent-carrier-book", agentId, user?.id], enabled: Boolean(agentId && user?.id), staleTime: 120_000,
    queryFn: async (): Promise<FinancePolicyBook> => {
      const { data, error } = await supabase.rpc("agent_carrier_book" as never, { p_agent_id: agentId } as never);
      if (error) throw error;
      return parseFinancePolicyBook(data, agentId);
    },
  });
  useProductionRealtime(() => { if (agentId && user?.id) void query.refetch({ cancelRefetch: false }); }, 800);
  const rows = query.data?.policies ?? [];
  const term = search.trim().toLowerCase();
  const selected = FILTERS.find(f => f.key === filter) ?? FILTERS[0];
  const shown = rows.filter(p => selected.match(p) && (!term || [p.client, p.policyNumber, p.carrier, p.product, p.rawStatus, p.preStatus].some(v => v?.toLowerCase().includes(term))));
  const summary = financePolicySummary(rows);
  const active = rows.filter(p => ["active", "claim"].includes(p.coverage));
  const paying = financePaidStatus(rows);
  const unknownStatus = rows.filter(p => p.coverage === "unknown").length;
  const carriers = [...new Set(rows.map(p => p.carrier))].sort();
  const sourceCoverage = carriers.map(carrier => {
    const count = rows.filter(p => p.carrier === carrier).length;
    const source = query.data?.carrierSources.find(item => item.carrier === carrier);
    return `${carrier}: ${count} ${count === 1 ? "policy" : "policies"} · oldest observation ${day(source?.lastSeenOn ?? null)}`;
  }).join("; ");
  if (!agentId) return null;
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label="Carrier book">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Policy outcomes</p><h3 className="mt-1 text-lg font-semibold">Carrier book · Ethos + Combined</h3><p className="mt-1 text-xs text-muted-foreground">Personal carrier records · current status across all dates · separate from posted production.</p></div>
        <Button variant="outline" size="sm" aria-label="Refresh the carrier book" onClick={() => void query.refetch({ cancelRefetch: false })}><RefreshCw className={cn("mr-2 h-3.5 w-3.5", query.isFetching && "animate-spin")} />Refresh</Button>
      </header>
      {query.isLoading ? <p className="text-sm text-muted-foreground">Loading the carrier book…</p> : !query.data ? (
        <p role="status" className="text-sm text-muted-foreground">Carrier evidence is unavailable for this producer. <button className="underline" onClick={() => void query.refetch()}>Retry the carrier book</button></p>
      ) : <>
        {query.isError && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">The latest refresh failed. These are the last verified carrier observations.</p>}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Tile label="Carrier policies" value={String(summary.policies)} note={premiumNote(summary)} />
          <Tile label="Currently in force" value={String(active.length)} note={`${premiumNote(financePolicySummary(active))} · coverage status`} />
          <Tile label="Paying / paid · carrier reported" value={String(paying.policies)} note={`${paying.policies === 0 ? "No confirmed statuses" : premiumNote({ ...paying, annualPremium: paying.knownAnnualPremium })} · no commission payment implied`} />
          <Tile label="Recorded chargebacks" value={query.data.chargebacks?.count ? usd(query.data.chargebacks.amount) : "Not recorded"} note={query.data.chargebacks ? `${query.data.chargebacks.count} carrier compensation records · lapses counted separately` : "Carrier compensation records were not supplied."} />
        </div>
        <p className="text-xs text-muted-foreground">Status coverage: {rows.length - unknownStatus} of {rows.length} carrier records have a recognized state; {unknownStatus} remain unknown. In-force coverage, premium-paying status and recorded commission chargebacks are separate facts.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter policies by status">
          {FILTERS.map(f => <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} className={cn("min-h-9 rounded-full border px-3 py-1 text-xs font-medium", filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted")}>
            {f.label} <span className="ml-1 tabular-nums opacity-70">{rows.filter(f.match).length}</span>
          </button>)}
        </div>
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Search carrier policies" placeholder="Client, policy number, carrier or status" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
        <p className="text-xs text-muted-foreground">{shown.length} of {rows.length} policies</p>
        <p className="text-xs text-muted-foreground">Source coverage: {sourceCoverage || "no carrier policies returned"}.</p>
        {shown.length === 0 ? <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">{rows.length ? "No policies match this status and search." : "No matched carrier policies are available for this producer."}</p> : (
          <ul className={cn("divide-y divide-border overflow-y-auto rounded-xl border border-border", compact ? "max-h-80" : "max-h-[36rem]")}>
            {shown.map(p => <li key={p.key} className="space-y-2 p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-semibold">{p.client || "Client not supplied"}</p><p className="mt-0.5 break-words text-xs text-muted-foreground">{p.carrier}{p.underwriter ? ` · ${p.underwriter}` : ""} · {p.policyNumber || "Policy number unavailable"}</p></div><div className="text-right"><span className={cn("inline-block rounded-full border px-2.5 py-1 text-xs font-medium", statusTone(p.coverage))}>{p.statusLabel}</span><p className="mt-1 text-sm font-semibold tabular-nums">{usd(p.annualPremium)} <span className="text-xs font-normal text-muted-foreground">AP</span></p></div></div>
              <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2"><p className="text-muted-foreground">Product <span className="text-foreground">{p.product || "Not supplied"}</span></p><p className="text-muted-foreground">Payment <span className="text-foreground">{p.paymentLabel}</span></p><p className="text-muted-foreground">Sold <span className="text-foreground">{day(p.soldOn)}</span> · Effective <span className="text-foreground">{day(p.effectiveOn)}</span></p><p className="break-words text-muted-foreground">Carrier status <span className="text-foreground">{p.rawStatus || p.preStatus || "Not supplied"}</span></p></div>
              {p.lastSeenOn && <p className="text-xs text-muted-foreground">Carrier observed {day(p.lastSeenOn)}</p>}
              {p.closeReason && <p className="text-xs text-muted-foreground">Carrier reason: {p.closeReason}</p>}
              {hasChargeback(p) && <p className="text-xs font-medium text-destructive">Recorded chargeback {usd(p.chargeback)}</p>}
            </li>)}
          </ul>
        )}
      </>}
    </section>
  );
}

export interface TeamCarrierStats {
  written_30d: number; ap_30d: number; submitted: number; in_force: number; at_risk: number; lapsed: number;
  retention_pct: number | null; last_sold_on: string | null; chargeback_amount: number;
}

/** Per-agent carrier stats for everyone the viewer can see (one read for the whole My Team list). */
export function useTeamCarrierSummary() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["team-carrier-book-summary", user?.id], enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, TeamCarrierStats>> => {
      const { data, error } = await supabase.rpc("team_carrier_book_summary" as never);
      if (error) throw error;
      return (data ?? {}) as unknown as Record<string, TeamCarrierStats>;
    },
  });
}

/** "Carrier: 4 in force · 1 at risk · 2 lapsed · 57% kept" — null when the agent has no carrier policies. */
export function teamCarrierLine(s: TeamCarrierStats | undefined): { text: string; tone: "good" | "warn" | "bad" | null } | null {
  if (!s || s.in_force + s.at_risk + s.lapsed + s.submitted === 0) return null;
  const bits = [`${s.in_force} in force`];
  if (s.submitted) bits.push(`${s.submitted} pending`);
  if (s.at_risk) bits.push(`${s.at_risk} at risk`);
  if (s.lapsed) bits.push(`${s.lapsed} lapsed`);
  if (s.retention_pct != null) bits.push(`${s.retention_pct}% currently in force among placed records`);
  if (s.written_30d) bits.push(`${s.written_30d} written 30d`);
  const tone = s.retention_pct == null ? null : s.retention_pct >= 75 ? "good" : s.retention_pct >= 50 ? "warn" : "bad";
  return { text: `Carrier: ${bits.join(" · ")}`, tone };
}
