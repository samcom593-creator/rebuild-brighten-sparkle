import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { carrierPolicyStatus, type CarrierCoverage } from "@/lib/carrierPolicyStatus";
import { cn } from "@/lib/utils";

interface CarrierPolicy {
  key: string; carrier: string; underwriter: string | null; policy_number: string | null;
  client: string | null; product: string | null; bucket: CarrierCoverage; status_raw: string | null;
  status_pre?: string | null; close_reason: string | null; annual_premium: number | null;
  face_amount: number | null; sold_on: string | null; effective_on: string | null;
  changed_on: string | null; last_seen_on?: string | null; on_site: boolean; chargeback: number | null;
}
interface CarrierBook {
  agent_id: string; requested_agent_id?: string; as_of: string | null; policies: CarrierPolicy[];
  carrier_sources?: Array<{ carrier: string; policy_count: number; last_seen_on: string | null }>;
  summary: { chargebacks: number; chargeback_amount: number; debt_outstanding: number };
}
const usd = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? "—"
  : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const day = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" }) : "Unknown";
const observed = (p: CarrierPolicy) => carrierPolicyStatus({ carrier: p.carrier, bucket: p.bucket, rawStatus: p.status_raw, preStatus: p.status_pre, chargeback: p.chargeback });
const statusTone = (coverage: CarrierCoverage) => ["active", "claim"].includes(coverage) ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  : ["at_risk", "pending"].includes(coverage) ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  : ["lapsed", "declined", "not_taken"].includes(coverage) ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300" : "border-border bg-muted text-muted-foreground";
type PolicyRow = CarrierPolicy & { evidence: ReturnType<typeof carrierPolicyStatus> };
const FILTERS: Array<{ key: string; label: string; match: (p: PolicyRow) => boolean }> = [
  { key: "all", label: "All policies", match: () => true },
  { key: "paying", label: "Paying / paid status", match: p => ["premium_paying", "paid"].includes(p.evidence.payment) },
  { key: "active", label: "In force", match: p => ["active", "claim"].includes(p.evidence.coverage) },
  { key: "pending", label: "Pending", match: p => p.evidence.coverage === "pending" },
  { key: "declined", label: "Declined / not taken", match: p => ["declined", "not_taken", "abandoned"].includes(p.evidence.coverage) },
  { key: "at_risk", label: "At risk", match: p => p.evidence.coverage === "at_risk" },
  { key: "lapsed", label: "Lapsed / cancelled", match: p => p.evidence.coverage === "lapsed" },
  { key: "chargeback", label: "Recorded chargebacks", match: p => p.evidence.recordedChargeback },
  { key: "unknown", label: "Status unknown", match: p => p.evidence.coverage === "unknown" },
];
function premium(rows: readonly CarrierPolicy[]) {
  return rows.some(p => p.annual_premium === null || !Number.isFinite(p.annual_premium))
    ? null : rows.reduce((sum, p) => sum + p.annual_premium!, 0);
}
function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="min-w-0 rounded-xl border border-border bg-background/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>;
}

/** Current carrier evidence, including declined policies excluded from posted production. */
export function AgentCarrierBookPanel({ agentId, compact = false }: { agentId: string; compact?: boolean }) {
  const { user } = useAuth();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["agent-carrier-book", agentId, user?.id], enabled: Boolean(agentId && user?.id), staleTime: 120_000,
    queryFn: async (): Promise<CarrierBook> => {
      const { data, error } = await supabase.rpc("agent_carrier_book" as never, { p_agent_id: agentId } as never);
      if (error) throw error;
      const book = data as unknown as CarrierBook;
      if (!book || (book.agent_id !== agentId && book.requested_agent_id !== agentId) || !Array.isArray(book.policies)
        || book.policies.some(p => !p || !p.key || !p.carrier)) throw new Error("Carrier evidence could not be verified for this producer.");
      return book;
    },
  });
  useProductionRealtime(() => { if (agentId && user?.id) void query.refetch({ cancelRefetch: false }); }, 800);
  const rows = useMemo(() => (query.data?.policies ?? []).map(p => ({ ...p, evidence: observed(p) })), [query.data]);
  const term = search.trim().toLowerCase();
  const selected = FILTERS.find(f => f.key === filter) ?? FILTERS[0];
  const shown = rows.filter(p => selected.match(p) && (!term || [p.client, p.policy_number, p.carrier, p.product, p.status_raw].some(v => v?.toLowerCase().includes(term))));
  const active = rows.filter(p => ["active", "claim"].includes(p.evidence.coverage));
  const paying = rows.filter(p => ["premium_paying", "paid"].includes(p.evidence.payment));
  const unknownStatus = rows.filter(p => p.evidence.coverage === "unknown").length;
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
          <Tile label="Carrier policies" value={String(rows.length)} note={`${usd(premium(rows))} annual premium on file`} />
          <Tile label="Currently in force" value={String(active.length)} note={`${usd(premium(active))} annual premium · coverage status`} />
          <Tile label="Paying / paid · carrier reported" value={String(paying.length)} note={`${usd(premium(paying))} annual premium · no receipt total`} />
          <Tile label="Recorded chargebacks" value={usd(query.data.summary?.chargeback_amount)} note={`${query.data.summary?.chargebacks ?? "—"} ledger entries · lapses counted separately`} />
        </div>
        <p className="text-xs text-muted-foreground">Status coverage: {rows.length - unknownStatus} of {rows.length} carrier records have a recognized state; {unknownStatus} remain unknown. In-force coverage, premium-paying status and recorded commission chargebacks are separate facts.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter policies by status">
          {FILTERS.map(f => <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} className={cn("min-h-9 rounded-full border px-3 py-1 text-xs font-medium", filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted")}>
            {f.label} <span className="ml-1 tabular-nums opacity-70">{rows.filter(f.match).length}</span>
          </button>)}
        </div>
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Search carrier policies" placeholder="Client, policy number, carrier or status" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
        <p className="text-xs text-muted-foreground">{shown.length} of {rows.length} policies</p>
        <p className="text-xs text-muted-foreground">Source coverage: {query.data.carrier_sources?.length ? query.data.carrier_sources.map(source => `${source.carrier}: ${source.policy_count} records · oldest observation ${day(source.last_seen_on)}`).join("; ") : "per-carrier observation dates unavailable"}.</p>
        {shown.length === 0 ? <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">{rows.length ? "No policies match this status and search." : "No matched carrier policies are available for this producer."}</p> : (
          <ul className={cn("divide-y divide-border overflow-y-auto rounded-xl border border-border", compact ? "max-h-80" : "max-h-[36rem]")}>
            {shown.map(p => <li key={p.key} className="space-y-2 p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-semibold">{p.client || "Client not supplied"}</p><p className="mt-0.5 break-words text-xs text-muted-foreground">{p.carrier}{p.underwriter ? ` · ${p.underwriter}` : ""} · {p.policy_number || "Policy number unavailable"}</p></div><div className="text-right"><span className={cn("inline-block rounded-full border px-2.5 py-1 text-xs font-medium", statusTone(p.evidence.coverage))}>{p.evidence.statusLabel}</span><p className="mt-1 text-sm font-semibold tabular-nums">{usd(p.annual_premium)} <span className="text-xs font-normal text-muted-foreground">AP</span></p></div></div>
              <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2"><p className="text-muted-foreground">Product <span className="text-foreground">{p.product || "Not supplied"}</span></p><p className="text-muted-foreground">Payment <span className="text-foreground">{p.evidence.paymentLabel}</span></p><p className="text-muted-foreground">Sold <span className="text-foreground">{day(p.sold_on)}</span> · Effective <span className="text-foreground">{day(p.effective_on)}</span></p><p className="break-words text-muted-foreground">Carrier status <span className="text-foreground">{p.status_raw || p.status_pre || "Not supplied"}</span></p></div>
              {p.last_seen_on && <p className="text-xs text-muted-foreground">Carrier observed {day(p.last_seen_on)}</p>}
              {p.close_reason && <p className="text-xs text-muted-foreground">Carrier reason: {p.close_reason}</p>}
              {p.evidence.recordedChargeback && <p className="text-xs font-medium text-destructive">Recorded chargeback {usd(p.chargeback)}</p>}
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
