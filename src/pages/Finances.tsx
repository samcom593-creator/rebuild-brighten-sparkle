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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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

type Tone = "danger" | "warning" | "success" | "info" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  danger: "text-destructive",
  warning: "text-warning",
  success: "text-success",
  info: "text-info",
  neutral: "text-foreground",
};

function StatTile({ icon: Icon, label, value, tone = "neutral", sub }: {
  icon: any; label: string; value: React.ReactNode; tone?: Tone; sub?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${TONE_TEXT[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1 leading-snug">{sub}</p>}
    </div>
  );
}

function syncChipClass(v: string): string {
  return String(v).includes("🟢")
    ? "bg-success/15 text-success border-success/30"
    : "bg-destructive/15 text-destructive border-destructive/30";
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
    refetchInterval: 300_000 * 60_000,
  });

  // These three CFO views each return ONE aggregate row whose detail lives in a
  // JSON array column (anomalies / stuck_list / idle_agents). They were being read
  // as if they were row-lists, so the Anomalies tab rendered blank junk. Pull the
  // single row and hand back its array.
  const dups = useQuery({
    queryKey: ["cfo-dup-charges"],
    queryFn: async () => {
      const { data } = await supabase.from("v_cfo_dup_charge_watch" as any).select("anomalies").maybeSingle();
      return (((data as any)?.anomalies ?? []) as any[]);
    },
  });

  const stuck = useQuery({
    queryKey: ["cfo-stuck-paid"],
    queryFn: async () => {
      const { data } = await supabase.from("v_cfo_ica_paid_stuck" as any).select("stuck_list").maybeSingle();
      return (((data as any)?.stuck_list ?? []) as any[]);
    },
  });

  const idle = useQuery({
    queryKey: ["cfo-idle-agents"],
    queryFn: async () => {
      const { data } = await supabase.from("v_cfo_agent_activation_watch" as any).select("idle_agents").maybeSingle();
      return (((data as any)?.idle_agents ?? []) as any[]);
    },
  });

  const commissions = useQuery({
    queryKey: ["commission-recent"],
    queryFn: async () => {
      // `product` does not exist on commission_ledger — selecting it 400'd the whole
      // query and silently hid every commission row.
      const { data } = await supabase.from("commission_ledger" as any)
        .select("id, agent_id, amount, carrier_id, annual_premium, rate_source, created_at, status")
        .order("created_at", { ascending: false })
        .limit(50);
      return (data ?? []) as any[];
    },
  });

  const approvals = useQuery({
    queryKey: ["cfo-approvals"],
    queryFn: async () => {
      // Real columns are subject/body/amount_cents (not title/description/amount) —
      // the old select 400'd and left the tab permanently empty.
      const { data } = await supabase.from("cfo_approval_requests" as any)
        .select("id, subject, body, amount_cents, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as any[];
    },
  });

  const refreshAll = () => {
    snapshot.refetch(); dups.refetch(); stuck.refetch(); idle.refetch();
    commissions.refetch(); approvals.refetch();
  };

  const snap = snapshot.data;

  return (
    <div className="page-enter mx-auto w-full max-w-7xl px-4 sm:px-6 pb-24 space-y-6">
      <PageHeader
        eyebrow="Finances · Overview"
        eyebrowIcon={<DollarSign className="h-3 w-3" />}
        title="Finances"
        subtitle="Live CFO snapshot from the finance bot — leak detection, ghost AP, stuck payouts, idle agents, commission ledger, and pending approvals."
        actions={
          <div className="flex items-center gap-2">
            {snap?.as_of && (
              <Badge variant="outline" className="tabular-nums">
                Updated {relativeTime(snap.as_of)}
              </Badge>
            )}
            <Button size="sm" onClick={refreshAll}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${snapshot.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* KPI stat row — the money numbers lead */}
      {snapshot.isLoading ? (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={/* stable-key-allow:skeleton-static-array */ i} className="h-24 rounded-md" />
          ))}
        </div>
      ) : snap ? (
        <div className="space-y-4">
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            <StatTile icon={AlertTriangle} label="Ghost AP at risk" value={fmtUsd(snap.ghost_ap_at_risk)} tone="danger" sub="unreconciled advance exposure" />
            <StatTile icon={TrendingDown} label="Walked commission" value={fmtUsd(snap.lapsed_walked_commission)} tone="danger" sub="lapsed / withdrawn" />
            <StatTile icon={TrendingUp} label="Mentorship revenue" value={fmtUsd(snap.mentorship_revenue_usd)} tone="success" />
            <StatTile icon={CheckCircle2} label="Mentorship paid" value={snap.mentorship_paid_total} tone="success" sub="lifetime payments" />
            <StatTile icon={Clock} label="Course bought · stuck" value={snap.ica_paid_stuck} tone="warning" sub="paid for prelicensing · not advancing" />
            <StatTile icon={ShieldAlert} label="Open dup charges" value={snap.dup_charges_open} tone="warning" />
            <StatTile icon={Users} label="Idle active agents" value={snap.idle_active_agents} tone="warning" sub="no recent activity" />
          </div>

          {/* System status strip — sync health as compact chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Activity className="h-3.5 w-3.5" /> System
            </span>
            <Badge variant="outline" className={syncChipClass(snap.insuracloud_sync)}>
              InsuraCloud {snap.insuracloud_sync}
            </Badge>
            <Badge variant="outline" className={syncChipClass(snap.agentlink_sync)}>
              AgentLink {snap.agentlink_sync}
            </Badge>
            <Badge variant="outline" className="bg-success/15 text-success border-success/30">
              <ShieldCheck className="h-3 w-3" /> Snapshot LIVE · cron-refreshed
            </Badge>
          </div>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
          <TabsTrigger value="commissions">Commissions ({commissions.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="approvals">Pending Approvals ({approvals.data?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> CFO Bot Health
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-foreground/80 leading-relaxed">
                The finance bot runs continuously on launchd at{" "}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">com.samjames.apex.finance-bot</code>.
                It scans for leaks every hour, reconciles deals nightly, and writes snapshot rows to{" "}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">v_cfo_snapshot</code>.
              </p>
              <div className="grid gap-3 sm:grid-cols-3 pt-1">
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5 text-warning" /> Anomalies
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Duplicate charges, stuck-paid applicants, and idle active agents.</p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-success" /> Commissions
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">The most recent rows from the commission ledger.</p>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-info" /> Pending Approvals
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">CFO-flagged items awaiting your call.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="anomalies" className="mt-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <ShieldAlert className="h-4 w-4 text-warning" /> Duplicate Charges
                  <Badge variant="outline" className="ml-auto">{dups.data?.length ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border max-h-72 overflow-auto">
                  {(dups.data ?? []).slice(0, 20).map((d, i) => (
                    <div key={d.stripe_charge_id ?? `dup|${d.customer ?? "?"}|${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="truncate">{d.customer ?? d.email ?? "—"}</span>
                      <span className="tabular-nums font-semibold text-warning shrink-0">{fmtUsd(d.amount_usd)}</span>
                    </div>
                  ))}
                  {(dups.data ?? []).length === 0 && (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">Clean — no duplicate-charge anomalies flagged.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Clock className="h-4 w-4 text-destructive" /> Course Bought · Stuck
                  <Badge variant="outline" className="ml-auto">{stuck.data?.length ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border max-h-72 overflow-auto">
                  {(stuck.data ?? []).slice(0, 50).map((s, i) => (
                    <div key={`stuck|${s.email ?? s.name ?? "?"}|${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="truncate">{s.name ?? "—"}</span>
                      <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30 shrink-0">{s.status ?? "—"}</Badge>
                    </div>
                  ))}
                  {(stuck.data ?? []).length === 0 && (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing stuck — every paid applicant is advancing.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Users className="h-4 w-4 text-warning" /> Idle Active Agents
                  <Badge variant="outline" className="ml-auto">{idle.data?.length ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border max-h-72 overflow-auto">
                  {(idle.data ?? []).slice(0, 50).map((a, i) => (
                    <div key={a.agent_id ?? `idle|${a.name ?? "?"}|${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="truncate">{a.name ?? "—"}</span>
                      <span className="tabular-nums text-xs text-muted-foreground shrink-0">{a.agent_code ?? ""}</span>
                    </div>
                  ))}
                  {(idle.data ?? []).length === 0 && (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">All active agents have recent activity.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="commissions" className="mt-5">
          <Card>
            <CardContent className="p-0">
              {commissions.isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={/* stable-key-allow:skeleton-static-array */ i} className="h-10 rounded-md" />
                  ))}
                </div>
              ) : (commissions.data ?? []).length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">No commission rows yet — the ledger is empty.</p>
              ) : (
                <div className="divide-y divide-border">
                  {(commissions.data ?? []).map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                      <DollarSign className="h-4 w-4 text-success shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {c.annual_premium ? `${fmtUsd(c.annual_premium)} AP` : "Commission"}{c.rate_source ? ` · ${c.rate_source}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">{relativeTime(c.created_at)} · {c.status ?? "—"}</p>
                      </div>
                      <span className="tabular-nums font-bold text-success shrink-0">{fmtUsd(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approvals" className="mt-5">
          <Card>
            <CardContent className="p-0">
              {approvals.isLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={/* stable-key-allow:skeleton-static-array */ i} className="h-12 rounded-md" />
                  ))}
                </div>
              ) : (approvals.data ?? []).length === 0 ? (
                <p className="p-10 text-center text-sm text-muted-foreground">No pending CFO approvals — you're all caught up.</p>
              ) : (
                <div className="divide-y divide-border">
                  {(approvals.data ?? []).map((a) => (
                    <div key={a.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <p className="text-sm font-bold truncate">{a.subject ?? "—"}</p>
                        {a.amount_cents != null && (
                          <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30 shrink-0">{fmtUsd(a.amount_cents / 100)}</Badge>
                        )}
                      </div>
                      {a.body && <p className="text-xs text-muted-foreground line-clamp-2">{a.body}</p>}
                      <p className="text-xs text-muted-foreground mt-1">{relativeTime(a.created_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
