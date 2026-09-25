/**
 * OnboardingCommand — the visual top of /dashboard/contracting/audit (2026-09-25, Sam directive).
 *
 * Two boards Sam asked to see at a glance:
 *  1. Onboarding funnel — where every live agent's contract is parked in the pipeline,
 *     who owns the next move, and how many are waiting on Sam. Source: v_onboarding_funnel
 *     (+ _summary). This is the "major gap" made visible: 0 fully contracted, N on your plate.
 *  2. Free-leads qualification — who has earned free leads on the trailing 30 weekdays
 *     ($20k production AND $15k verified/policy-numbered production), and who is close.
 *     Source: v_free_leads_qualification (+ _summary), read off v_production_canonical (live).
 *
 * Both views are security_invoker and this panel is admin-only (the audit route gates it).
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Gauge, Ticket, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type FunnelStage = {
  stage_key: string; stage_order: number; owner: string; label: string;
  agents: number; licensed: number; pct_of_agents: number; pct_complete_at_stage: number;
};
type FunnelSummary = {
  live_agents: number; fully_contracted: number; waiting_on_sam: number;
  waiting_on_agent: number; waiting_external: number;
};
type FreeLeadRow = {
  agent_id: string; agent_name: string | null; deals_30d: number;
  production_30d: number; ipd_verified_30d: number;
  qualifies_free_leads: boolean; production_gap: number; ipd_gap: number; last_deal_date: string | null;
};
type FreeLeadSummary = {
  producing_agents_30d: number; qualifying_agents: number; not_yet_qualifying: number;
  production_threshold: number; ipd_threshold: number; window_days: number; rule: string;
};

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

const OWNER_TONE: Record<string, string> = {
  Sam: "bg-amber-500/70 border-amber-400/50 text-amber-200",
  Agent: "bg-muted-foreground/40 border-border text-muted-foreground",
  Carrier: "bg-sky-500/60 border-sky-400/40 text-sky-200",
  Ethos: "bg-sky-500/60 border-sky-400/40 text-sky-200",
  Done: "bg-emerald-500/70 border-emerald-400/50 text-emerald-200",
};
const OWNER_BADGE: Record<string, string> = {
  Sam: "border-amber-500/40 text-amber-300",
  Agent: "border-border text-muted-foreground",
  Carrier: "border-sky-500/40 text-sky-300",
  Ethos: "border-sky-500/40 text-sky-300",
  Done: "border-emerald-500/40 text-emerald-400",
};

export function OnboardingCommand() {
  const funnelQ = useQuery({
    queryKey: ["onboarding-funnel"],
    staleTime: 60_000,
    queryFn: async (): Promise<FunnelStage[]> => {
      const { data, error } = await supabase.from("v_onboarding_funnel" as never).select("*").order("stage_order");
      if (error) throw error;
      return (data ?? []) as unknown as FunnelStage[];
    },
  });
  const funnelSumQ = useQuery({
    queryKey: ["onboarding-funnel-summary"],
    staleTime: 60_000,
    queryFn: async (): Promise<FunnelSummary | null> => {
      const { data, error } = await supabase.from("v_onboarding_funnel_summary" as never).select("*").limit(1);
      if (error) throw error;
      return ((data?.[0]) ?? null) as unknown as FunnelSummary | null;
    },
  });
  const leadsQ = useQuery({
    queryKey: ["free-leads-qual"],
    staleTime: 60_000,
    queryFn: async (): Promise<FreeLeadRow[]> => {
      const { data, error } = await supabase.from("v_free_leads_qualification" as never)
        .select("*").order("qualifies_free_leads", { ascending: false }).order("production_30d", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as FreeLeadRow[];
    },
  });
  const leadsSumQ = useQuery({
    queryKey: ["free-leads-summary"],
    staleTime: 60_000,
    queryFn: async (): Promise<FreeLeadSummary | null> => {
      const { data, error } = await supabase.from("v_free_leads_summary" as never).select("*").limit(1);
      if (error) throw error;
      return ((data?.[0]) ?? null) as unknown as FreeLeadSummary | null;
    },
  });

  const fs = funnelSumQ.data;
  const stages = funnelQ.data ?? [];
  const maxAgents = Math.max(1, ...stages.map((s) => s.agents));
  const leads = leadsQ.data ?? [];
  const ls = leadsSumQ.data;

  return (
    <div className="space-y-4">
      {/* ── Onboarding funnel ─────────────────────────────────────────── */}
      <GlassCard className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Gauge className="h-4 w-4 text-primary" /> Onboarding funnel — where every contract is landing
            </div>
            <p className="text-xs text-muted-foreground">
              One live agent, one next move. The amber bars are on you; grey is on the agent; blue is a carrier or Ethos we're waiting on.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { funnelQ.refetch(); funnelSumQ.refetch(); }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Refresh funnel"
          >
            <RefreshCw className={cn("h-4 w-4", funnelQ.isFetching && "animate-spin")} />
          </button>
        </div>

        {funnelSumQ.isLoading ? (
          <Skeleton className="h-20" />
        ) : fs ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Live agents" value={fs.live_agents} tone="text-foreground" />
            <Stat label="Fully contracted" value={fs.fully_contracted} tone={fs.fully_contracted > 0 ? "text-emerald-400" : "text-amber-300"} />
            <Stat label="On you" value={fs.waiting_on_sam} tone="text-amber-300" />
            <Stat label="On the agent" value={fs.waiting_on_agent} tone="text-muted-foreground" />
            <Stat label="Carrier / Ethos" value={fs.waiting_external} tone="text-sky-300" />
          </div>
        ) : null}

        {funnelQ.isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="space-y-1.5">
            {stages.map((s) => (
              <div key={s.stage_key} className="flex items-center gap-3">
                <div className="w-52 shrink-0 text-xs">
                  <span className="text-foreground">{s.label}</span>
                  <Badge variant="outline" className={cn("ml-1.5 px-1 py-0 text-[10px]", OWNER_BADGE[s.owner] ?? "border-border")}>{s.owner}</Badge>
                </div>
                <div className="relative h-5 flex-1 overflow-hidden rounded-sm bg-muted/30">
                  <div
                    className={cn("h-full rounded-sm border-r", OWNER_TONE[s.owner] ?? "bg-primary/60 border-primary/40")}
                    style={{ width: `${Math.round((s.agents / maxAgents) * 100)}%` }}
                  />
                </div>
                <div className="w-10 shrink-0 text-right text-xs tabular-nums">{s.agents}</div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* ── Free-leads qualification ──────────────────────────────────── */}
      <GlassCard className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Ticket className="h-4 w-4 text-primary" /> Free-leads qualification
            </div>
            <p className="text-xs text-muted-foreground">
              {ls?.rule ?? "Trailing 30 days, weekdays only. Qualifies at $20k production AND $15k verified (policy-numbered) production."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { leadsQ.refetch(); leadsSumQ.refetch(); }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Refresh free leads"
          >
            <RefreshCw className={cn("h-4 w-4", leadsQ.isFetching && "animate-spin")} />
          </button>
        </div>

        {leadsSumQ.data && (
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Qualify now" value={leadsSumQ.data.qualifying_agents} tone="text-emerald-400" icon={<Users className="h-3.5 w-3.5" />} />
            <Stat label="Producing (30d)" value={leadsSumQ.data.producing_agents_30d} tone="text-foreground" />
            <Stat label="Close, not there" value={leadsSumQ.data.not_yet_qualifying} tone="text-amber-300" />
          </div>
        )}

        {leadsQ.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            The free-leads view did not load — a read failure, not an empty board.
          </div>
        )}

        {leadsQ.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Agent</th>
                  <th className="py-1 pr-3 text-right">Production (30d)</th>
                  <th className="py-1 pr-3 text-right">Verified / IP'd</th>
                  <th className="py-1 pr-3">Free leads</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((r) => {
                  const gapNote = !r.qualifies_free_leads
                    ? (r.production_gap > 0 ? `needs ${money(r.production_gap)} more production` : `needs ${money(r.ipd_gap)} more verified`)
                    : null;
                  return (
                    <tr key={r.agent_id} className="border-t border-border/50">
                      <td className="py-1.5 pr-3">
                        <div className="font-medium">{r.agent_name ?? "—"}</div>
                        <div className="text-[11px] text-muted-foreground">{r.deals_30d} deal{r.deals_30d === 1 ? "" : "s"}{gapNote ? ` · ${gapNote}` : ""}</div>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.production_30d)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.ipd_verified_30d)}</td>
                      <td className="py-1.5 pr-3">
                        {r.qualifies_free_leads
                          ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">Earned</Badge>
                          : <Badge variant="outline" className="border-border text-muted-foreground">Not yet</Badge>}
                      </td>
                    </tr>
                  );
                })}
                {!leads.length && (
                  <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No production in the trailing 30 weekdays.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function Stat({ label, value, tone, icon }: { label: string; value: number; tone: string; icon?: ReactNode }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">{icon}{label}</div>
      <div className={cn("text-xl font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

export default OnboardingCommand;
