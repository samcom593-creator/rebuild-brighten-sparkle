// Finances · mirrors AgentLink's "Finances" sidebar item
//
// Surfaces the CFO-bot snapshot already running on cron:
//   - v_cfo_snapshot           : top-line health row (10 metrics)
//   - v_cfo_dup_charge_watch   : duplicate-charge anomalies
//   - v_cfo_ica_paid_stuck     : ICA-paid but stuck-in-pipeline apps
//   - v_cfo_agent_activation_watch : idle active agents
//   - commission_ledger        : recent commission earnings
//   - cfo_approval_requests    : pending CFO approval items
//
// READ-ONLY view of the finance-bot's live state. The bot itself
// runs at ~/business-ops/finance-bot/ on launchd. This page lets
// Sam check the snapshot from anywhere without opening the terminal.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, AlertTriangle, TrendingUp, TrendingDown, RefreshCw,
  Activity, ShieldCheck, ShieldAlert, Users, Clock, CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface CfoSnapshot {
  ghost_ap_at_risk: string | number;
  ica_paid_stuck: number;
  lapsed_walked_commission: string | number;
  dup_charges_open: number;
  idle_active_agents: number;
  insuracloud_sync: string;
  agentlink_sync: string;
  mentorship_revenue_usd: number;
  mentorship_paid_total: number;
  as_of: string;
}

interface DupCharge {
  applicant_name?: string;
  total_charge?: number;
  charge_count?: number;
  first_charge_at?: string;
  [k: string]: any;
}

interface StuckPaid {
  applicant_name?: string;
  application_id?: string;
  days_stuck?: number;
  ica_amount?: number;
  [k: string]: any;
}

interface IdleAgent {
  agent_name?: string;
  agent_id?: string;
  last_deal_at?: string;
  days_idle?: number;
  [k: string]: any;
}

interface CommissionRow {
  id: string;
  agent_id: string | null;
  amount: number | null;
  carrier_id: number | null;
  product: string | null;
  created_at: string;
  status: string | null;
}

interface ApprovalReq {
  id: string;
  title: string | null;
  description: string | null;
  status: string | null;
  amount: number | null;
  created_at: string;
}

function fmtUsd(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

function MetricTile({ icon: Icon, label, value, tone = "slate", sub }: {
  icon: any; label: string; value: React.ReactNode; tone?: "rose"|"amber"|"emerald"|"slate"; sub?: string;
}) {
  const toneClasses: Record<string, string> = {
    rose:    "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300",
    amber:   "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
    slate:   "border-slate-500/30 bg-slate-500/5 text-slate-700 dark:text-slate-300",
  };
  return (
    <Card className={toneClasses[tone]}>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-11 uppercase tracking-wider font-semibold opacity-80 mb-1">
          <Icon className="h-3 w-3" /> {label}
        </div>
        <p className="text-18 font-bold tabular-nums">{value}</p>
        {sub && <p className="text-11 opacity-70 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function Finances() {
  usePageTitle("Finances · APEX");
  const [tab, setTab] = useState<"overview"|"anomalies"|"commissions"|"approvals">("overview");

  const snapshot = useQuery({
    queryKey: ["cfo-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_cfo_snapshot" as any).select("*").maybeSingle();
      if (error) throw error;
      return data as unknown as CfoSnapshot;
    },
    refetchInterval: 5 * 60_000,
  });

  const dups = useQuery({
    queryKey: ["cfo-dup-charges"],
    queryFn: async () => {
      const { data } = await supabase.from("v_cfo_dup_charge_watch" as any).select("*").limit(20);
      return (data ?? []) as unknown as DupCharge[];
    },
  });

  const stuck = useQuery({
    queryKey: ["cfo-stuck-paid"],
    queryFn: async () => {
      const { data } = await supabase.from("v_cfo_ica_paid_stuck" as any).select("*").limit(50);
      return (data ?? []) as unknown as StuckPaid[];
    },
  });

  const idle = useQuery({
    queryKey: ["cfo-idle-agents"],
    queryFn: async () => {
      const { data } = await supabase.from("v_cfo_agent_activation_watch" as any).select("*").limit(50);
      return (data ?? []) as unknown as IdleAgent[];
    },
  });

  const commissions = useQuery({
    queryKey: ["commission-recent"],
    queryFn: async () => {
      const { data } = await supabase.from("commission_ledger" as any)
        .select("id, agent_id, amount, carrier_id, product, created_at, status")
        .order("created_at", { ascending: false })
        .limit(50);
      return (data ?? []) as unknown as CommissionRow[];
    },
  });

  const approvals = useQuery({
    queryKey: ["cfo-approvals"],
    queryFn: async () => {
      const { data } = await supabase.from("cfo_approval_requests" as any)
        .select("id, title, description, status, amount, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as unknown as ApprovalReq[];
    },
  });

  const refreshAll = () => {
    snapshot.refetch(); dups.refetch(); stuck.refetch(); idle.refetch();
    commissions.refetch(); approvals.refetch();
  };

  const snap = snapshot.data;

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="CFO"
        eyebrowIcon={<DollarSign className="h-3 w-3" />}
        title="Finances"
        subtitle="Live CFO snapshot from the finance bot — leak detection, ghost AP, stuck payouts, idle agents, commission ledger, pending approvals."
        actions={
          <div className="flex items-center gap-2">
            {snap?.as_of && (
              <Badge variant="outline" className="text-11 tabular-nums">
                Updated {relativeTime(snap.as_of)}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={refreshAll}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${snapshot.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Top metrics grid */}
      {snapshot.isLoading ? (
        <div className="grid gap-2 grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : snap ? (
        <div className="grid gap-2 grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
          <MetricTile icon={AlertTriangle} label="Ghost AP at risk" value={fmtUsd(snap.ghost_ap_at_risk)} tone="rose" />
          <MetricTile icon={Clock} label="ICA paid + stuck" value={snap.ica_paid_stuck} tone="amber" sub="apps awaiting status" />
          <MetricTile icon={TrendingDown} label="Walked commission" value={fmtUsd(snap.lapsed_walked_commission)} tone="rose" sub="lapsed/withdrawn" />
          <MetricTile icon={ShieldAlert} label="Open dup charges" value={snap.dup_charges_open} tone="amber" />
          <MetricTile icon={Users} label="Idle active agents" value={snap.idle_active_agents} tone="amber" sub="no recent activity" />
          <MetricTile icon={Activity} label="InsuraCloud sync" value={snap.insuracloud_sync} tone={String(snap.insuracloud_sync).includes("🟢") ? "emerald" : "rose"} />
          <MetricTile icon={Activity} label="AgentLink sync" value={snap.agentlink_sync} tone={String(snap.agentlink_sync).includes("🟢") ? "emerald" : "rose"} />
          <MetricTile icon={TrendingUp} label="Mentorship revenue" value={fmtUsd(snap.mentorship_revenue_usd)} tone="emerald" />
          <MetricTile icon={CheckCircle2} label="Mentorship paid" value={snap.mentorship_paid_total} tone="emerald" sub="lifetime" />
          <MetricTile icon={ShieldCheck} label="Snapshot" value="LIVE" tone="emerald" sub="cron-refreshed" />
        </div>
      ) : null}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {(["overview","anomalies","commissions","approvals"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-13 font-medium transition-base border-b-2 ${
              tab === t
                ? "border-amber-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "overview" ? "Overview"
              : t === "anomalies" ? "Anomalies"
              : t === "commissions" ? `Commissions (${commissions.data?.length ?? 0})`
              : `Pending Approvals (${approvals.data?.length ?? 0})`}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-15 font-bold mb-2">CFO Bot Health</h3>
            <p className="text-13 text-foreground/80 leading-relaxed mb-3">
              The finance bot runs continuously on launchd at <code className="text-12 bg-muted px-1.5 py-0.5 rounded">com.samjames.apex.finance-bot</code>.
              It scans for leaks every hour, reconciles deals nightly, and writes snapshot rows to <code className="text-12 bg-muted px-1.5 py-0.5 rounded">v_cfo_snapshot</code>.
            </p>
            <p className="text-13 text-foreground/80 leading-relaxed">
              Tap <strong>Anomalies</strong> to see duplicate charges, stuck-paid applicants, and idle active agents.
              Tap <strong>Commissions</strong> for the recent ledger. Tap <strong>Pending Approvals</strong> for CFO-flagged items awaiting your call.
            </p>
          </CardContent>
        </Card>
      )}

      {tab === "anomalies" && (
        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <h4 className="text-13 font-bold mb-2 flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5 text-amber-500" /> Duplicate Charges ({dups.data?.length ?? 0})</h4>
              <div className="space-y-1.5 max-h-72 overflow-auto">
                {(dups.data ?? []).slice(0, 20).map((d, i) => (
                  <div key={i} className="text-12 flex justify-between border-b border-border/40 py-1">
                    <span className="truncate">{d.applicant_name ?? "—"}</span>
                    <span className="tabular-nums text-amber-700">{fmtUsd(d.total_charge)}</span>
                  </div>
                ))}
                {(dups.data ?? []).length === 0 && <p className="text-12 text-muted-foreground">No duplicate-charge anomalies.</p>}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <h4 className="text-13 font-bold mb-2 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-rose-500" /> ICA Paid + Stuck ({stuck.data?.length ?? 0})</h4>
              <div className="space-y-1.5 max-h-72 overflow-auto">
                {(stuck.data ?? []).slice(0, 50).map((s, i) => (
                  <div key={i} className="text-12 flex justify-between border-b border-border/40 py-1">
                    <span className="truncate">{s.applicant_name ?? "—"}</span>
                    <span className="tabular-nums text-rose-700">{s.days_stuck ?? "—"}d</span>
                  </div>
                ))}
                {(stuck.data ?? []).length === 0 && <p className="text-12 text-muted-foreground">No stuck-paid apps.</p>}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <h4 className="text-13 font-bold mb-2 flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-amber-500" /> Idle Active Agents ({idle.data?.length ?? 0})</h4>
              <div className="space-y-1.5 max-h-72 overflow-auto">
                {(idle.data ?? []).slice(0, 50).map((a, i) => (
                  <div key={i} className="text-12 flex justify-between border-b border-border/40 py-1">
                    <span className="truncate">{a.agent_name ?? "—"}</span>
                    <span className="tabular-nums text-amber-700">{a.days_idle ?? "—"}d</span>
                  </div>
                ))}
                {(idle.data ?? []).length === 0 && <p className="text-12 text-muted-foreground">No idle agents.</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "commissions" && (
        <Card>
          <CardContent className="p-0">
            {commissions.isLoading ? (
              <div className="p-4 space-y-2">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-10" />)}</div>
            ) : (
              <div className="divide-y divide-border/60">
                {(commissions.data ?? []).map((c) => (
                  <div key={c.id} className="px-4 py-2.5 flex items-center gap-3 text-13">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{c.product ?? "—"}</p>
                      <p className="text-11 text-muted-foreground">{relativeTime(c.created_at)} · {c.status ?? "—"}</p>
                    </div>
                    <span className="tabular-nums font-bold text-emerald-600 dark:text-emerald-400">{fmtUsd(c.amount)}</span>
                  </div>
                ))}
                {(commissions.data ?? []).length === 0 && <p className="p-6 text-center text-13 text-muted-foreground">No commission rows yet.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "approvals" && (
        <Card>
          <CardContent className="p-0">
            {approvals.isLoading ? (
              <div className="p-4 space-y-2">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-12" />)}</div>
            ) : (
              <div className="divide-y divide-border/60">
                {(approvals.data ?? []).map((a) => (
                  <div key={a.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <p className="text-13 font-bold truncate">{a.title ?? "—"}</p>
                      {a.amount && <span className="text-13 tabular-nums text-amber-700 dark:text-amber-300">{fmtUsd(a.amount)}</span>}
                    </div>
                    {a.description && <p className="text-12 text-muted-foreground line-clamp-2">{a.description}</p>}
                    <p className="text-11 text-muted-foreground mt-1">{relativeTime(a.created_at)}</p>
                  </div>
                ))}
                {(approvals.data ?? []).length === 0 && <p className="p-6 text-center text-13 text-muted-foreground">No pending CFO approvals.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
