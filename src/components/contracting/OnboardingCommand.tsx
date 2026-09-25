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
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Gauge, Ticket, RefreshCw, CheckCircle2, Circle, ExternalLink, ClipboardCopy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

type WorkItem = {
  agent_id: string; display_name: string; manager_name: string | null; next_action: string;
  license_status: string | null; npn_db: string | null; email: string | null; al_id: string | null;
  ethos_status: string; handled: boolean; acked_at: string | null; note: string | null;
};

// Per-action label + the fastest way to actually clear it. AgentLink fixes happen
// in AgentLink; Ethos rows are the copy-to-sheet buttons above; merges are the
// dedupe tool. "kind" drives which shortcut renders on the row.
const WORK_META: Record<string, { label: string; kind: "agentlink" | "ethos" | "merge" }> = {
  resolve_npn_conflict:            { label: "Resolve NPN conflict", kind: "agentlink" },
  backfill_npn_from_source:        { label: "Backfill NPN", kind: "agentlink" },
  merge_duplicate_agent_rows:      { label: "Merge duplicate rows", kind: "merge" },
  create_agentlink_profile:        { label: "Create AgentLink profile", kind: "agentlink" },
  complete_agentlink_profile:      { label: "Complete AgentLink profile", kind: "agentlink" },
  upline_assign_in_agentlink:      { label: "Assign upline", kind: "agentlink" },
  fix_rejected_contracts:          { label: "Fix rejected contracts", kind: "agentlink" },
  no_active_carrier_contracts:     { label: "No active carrier contract", kind: "agentlink" },
  add_to_ethos_sheet:              { label: "Add to Ethos sheet", kind: "ethos" },
  ethos_agent_update_comp_level:   { label: "Fix Ethos comp level", kind: "ethos" },
};
const AGENTLINK_URL = "https://agentlink.insuracloud.ai";

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

  const worklistQ = useQuery({
    queryKey: ["contracting-worklist"],
    staleTime: 60_000,
    queryFn: async (): Promise<WorkItem[]> => {
      const { data, error } = await supabase.from("v_contracting_worklist" as never).select("*").order("next_action");
      if (error) throw error;
      return (data ?? []) as unknown as WorkItem[];
    },
  });
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const toggleHandled = async (it: WorkItem) => {
    const key = `${it.agent_id}:${it.next_action}`;
    setBusy((b) => ({ ...b, [key]: true }));
    const fn = it.handled ? "contracting_worklist_unack" : "contracting_worklist_ack";
    const args = it.handled
      ? { p_agent_id: it.agent_id, p_next_action: it.next_action }
      : { p_agent_id: it.agent_id, p_next_action: it.next_action, p_note: null };
    const { error } = await supabase.rpc(fn as never, args as never);
    setBusy((b) => ({ ...b, [key]: false }));
    if (error) { toast.error(`Could not update: ${error.message}`); return; }
    await worklistQ.refetch();
  };

  const fs = funnelSumQ.data;
  const stages = funnelQ.data ?? [];
  const maxAgents = Math.max(1, ...stages.map((s) => s.agents));
  const leads = leadsQ.data ?? [];
  const ls = leadsSumQ.data;

  const work = worklistQ.data ?? [];
  const workOpen = work.filter((w) => !w.handled);
  const workDone = work.filter((w) => w.handled);
  const workGroups = Array.from(new Set(workOpen.map((w) => w.next_action)))
    .map((action) => ({ action, items: workOpen.filter((w) => w.next_action === action) }))
    .sort((a, b) => b.items.length - a.items.length);

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

      {/* ── Your worklist ─────────────────────────────────────────────── */}
      <GlassCard className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="h-4 w-4 text-primary" /> Your worklist — the contracts waiting on you
            </div>
            <p className="text-xs text-muted-foreground">
              {workDone.length} of {work.length} handled. Check one off and it drops away; if the next sync shows the same gap still open, it comes back.
            </p>
          </div>
          <button
            type="button"
            onClick={() => worklistQ.refetch()}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Refresh worklist"
          >
            <RefreshCw className={cn("h-4 w-4", worklistQ.isFetching && "animate-spin")} />
          </button>
        </div>

        {work.length > 0 && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted/30">
            <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${Math.round((workDone.length / work.length) * 100)}%` }} />
          </div>
        )}

        {worklistQ.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="space-y-4">
            {workGroups.map((g) => {
              const meta = WORK_META[g.action] ?? { label: g.action, kind: "agentlink" as const };
              return (
                <div key={g.action} className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                    {meta.label} <span className="text-muted-foreground">· {g.items.length}</span>
                  </div>
                  {g.items.map((it) => {
                    const key = `${it.agent_id}:${it.next_action}`;
                    return (
                      <div key={key} className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/10 px-2 py-1.5">
                        <button
                          type="button"
                          disabled={!!busy[key]}
                          onClick={() => toggleHandled(it)}
                          className="shrink-0 text-muted-foreground hover:text-emerald-400 disabled:opacity-40"
                          aria-label="Mark handled"
                        >
                          <Circle className="h-4 w-4" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{it.display_name}</div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {it.manager_name ? `↑ ${it.manager_name}` : "no manager"}{it.npn_db ? ` · NPN ${it.npn_db}` : ""}
                          </div>
                        </div>
                        {meta.kind === "agentlink" && (
                          <a href={AGENTLINK_URL} target="_blank" rel="noopener noreferrer"
                             className="inline-flex shrink-0 items-center gap-1 text-[11px] text-sky-300 hover:underline">
                            AgentLink <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {meta.kind === "ethos" && (
                          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                            <ClipboardCopy className="h-3 w-3" /> Copy Ethos rows above
                          </span>
                        )}
                        {meta.kind === "merge" && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">Dedupe tool</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {!workOpen.length && (
              <div className="py-6 text-center text-sm text-emerald-400">Nothing waiting on you. Every Sam-owned contract step is handled.</div>
            )}
            {workDone.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                <span>{workDone.length} handled:</span>
                {workDone.slice(0, 14).map((it) => (
                  <button
                    key={`${it.agent_id}:${it.next_action}`}
                    type="button"
                    disabled={!!busy[`${it.agent_id}:${it.next_action}`]}
                    onClick={() => toggleHandled(it)}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 px-2 py-0.5 text-emerald-400/80 hover:text-emerald-300 disabled:opacity-40"
                    title="Undo"
                  >
                    <CheckCircle2 className="h-3 w-3" /> {it.display_name}
                  </button>
                ))}
                {workDone.length > 14 && <span>+{workDone.length - 14} more</span>}
              </div>
            )}
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
