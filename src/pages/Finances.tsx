// One finance workspace: the viewer's commission ledger and carrier policy
// book are separate financial sources. Real admins can additionally mount
// the existing agency estimates and CFO reconciliation; preview roles cannot.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  DollarSign, AlertTriangle, TrendingUp, TrendingDown, RefreshCw,
  Activity, ShieldCheck, ShieldAlert, Users, Clock, CheckCircle2,
  ChevronLeft, ChevronRight, Download, Info,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/hooks/useAuth";
import { useRolePreview } from "@/hooks/useRolePreview";
import MyCommissions from "@/pages/MyCommissions";
import { PersonalPolicyBook } from "@/components/finances/PersonalPolicyBook";
import { ImoByAgency } from "@/components/dashboard/ImoByAgency";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { QueryState } from "@/components/ui/query-state";
import { cn } from "@/lib/utils";

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

function financeRows(value: unknown, label: string): Record<string, any>[] {
  if (!Array.isArray(value) || value.some(row => row === null || typeof row !== "object" || Array.isArray(row))) {
    throw new Error(`${label} returned an invalid result set.`);
  }
  return value;
}

function financeAggregateRows(value: unknown, field: string, label: string): Record<string, any>[] {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, field)) {
    throw new Error(`${label} returned no authorized aggregate row.`);
  }
  // These SQL views use json_agg without COALESCE: a present row with an
  // explicitly null aggregate means zero matches. A missing row is not empty.
  const aggregate = (value as Record<string, unknown>)[field];
  return financeRows(aggregate === null ? [] : aggregate, label);
}


// ── AC Overview types ────────────────────────────────────────────────────
type FinScope = "mine" | "agency" | "imo";

interface FinOverview {
  scope: string;
  as_of: string;
  comp_note: string;
  kpis: { today: number; forecast_90d: number; mtd: number; ytd: number };
  team_kpis: { today: number; mtd: number; ytd: number };
  production: { policies: number; alp: number; producers: number; last_synced_at: string | null };
  commission_types: { direct_ytd: number; override_pending: number; trail_pending: number; renewal_pending: number };
  forecast: Array<{ month: string; direct: number; override: number; trail: number; renewal: number }>;
  payouts: { month: string; total: number; rows: Array<{ date: string; agent: string | null; client: string | null; carrier: string | null; product: string | null; ap: number; est: number; component: "direct" | "override" | "team_direct" | "gap" }> };
  breakdown: Record<"by_carrier" | "by_product" | "by_month" | "by_agent_overrides", Array<{ name: string; deals: number; ap: number; est: number }>>;
}

/**
 * The management response is a financial contract, not a source of fallback zeros.
 * finances_overview_base emits "gap" for Vantage external daily gap estimates.
 */
function parseOverview(value: unknown): FinOverview {
  const isRecord = (item: unknown): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item);
  const numericFields = (item: unknown, keys: string[]) => isRecord(item) && keys.every(key => typeof item[key] === "number" && Number.isFinite(item[key]));
  if (!isRecord(value) || typeof value.scope !== "string" || typeof value.comp_note !== "string" ||
    !numericFields(value.kpis, ["today", "forecast_90d", "mtd", "ytd"]) ||
    !numericFields(value.team_kpis, ["today", "mtd", "ytd"]) ||
    !numericFields(value.production, ["policies", "alp", "producers"]) ||
    !numericFields(value.commission_types, ["direct_ytd", "override_pending", "trail_pending", "renewal_pending"]) ||
    !Array.isArray(value.forecast) || value.forecast.some(row => !numericFields(row, ["direct", "override", "trail", "renewal"]) || typeof row.month !== "string") ||
    !isRecord(value.payouts) || !numericFields(value.payouts, ["total"]) || typeof value.payouts.month !== "string" ||
    !Array.isArray(value.payouts.rows) || value.payouts.rows.some(row => !numericFields(row, ["ap", "est"]) || typeof row.date !== "string" || !["direct", "override", "team_direct", "gap"].includes(row.component)) ||
    !isRecord(value.breakdown) || ["by_carrier", "by_product", "by_month", "by_agent_overrides"].some(key => !Array.isArray(value.breakdown[key]) || value.breakdown[key].some(row => !numericFields(row, ["deals", "ap", "est"]) || typeof row.name !== "string"))) {
    throw new Error("The finance overview returned an incomplete or invalid result.");
  }
  return value as unknown as FinOverview;
}

const money = (n: number | null | undefined) => `$${Math.round(Number(n ?? 0)).toLocaleString()}`;

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function monthShort(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

const SCOPES: Array<{ key: FinScope; label: string }> = [
  { key: "mine", label: "My direct" },
  { key: "agency", label: "My + overrides" },
  { key: "imo", label: "Team gross" },
];

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("mt-2 text-3xl font-bold tabular-nums", accent ? "text-primary" : "text-foreground")}>{value}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function TypeCard({ icon: Icon, label, value, sub, tone }: { icon: React.ElementType; label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <p className={cn("flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide", tone)}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function OverviewTab({ scope, viewerId }: { scope: FinScope; viewerId: string }) {
  const [month, setMonth] = useState<Date>(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const monthIso = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01`;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["finances-overview", viewerId, scope, monthIso],
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("finances_overview" as never, {
        p_scope: scope,
        p_month: monthIso,
      } as never);
      if (error) throw error;
      return parseOverview(data);
    },
  });

  const chart = useMemo(() => (data?.forecast ?? []).map((f) => ({ ...f, name: monthShort(f.month) })), [data]);
  const payoutRows = data?.payouts?.rows ?? [];
  const [breakTab, setBreakTab] = useState<string>("by_carrier");

  const exportCsv = () => {
    const head = "date,agent,client,carrier,product,annual_premium,est_commission";
    const lines = payoutRows.map((r) =>
      [r.date, r.agent, r.client, r.carrier, r.product, r.ap, r.est]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[head, ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `apex-payouts-${data?.payouts?.month ?? "month"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (isError) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertTriangle className="mx-auto h-5 w-5 text-destructive" />
          <p className="mt-2 font-semibold">Finance truth could not load</p>
          <p className="mt-1 text-xs text-muted-foreground">{error instanceof Error ? error.message : "Unknown secured-source error"}</p>
          <Button className="mt-3" onClick={() => void refetch()} size="sm" variant="outline">Retry</Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={/* stable-key-allow:skeleton-static-array */ i} className="h-28 rounded-lg" />)}
        </div>
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    );
  }

  const k = data.kpis; const q = data.commission_types;

  return (
    <div className="space-y-5">
      {/* MP-302: these four are ESTIMATED commission (the rate applied to posted production), not
          money received. Each card now says so; a bare dollar figure under "Today" on a page
          called Finances read as income. */}
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Estimated commission · today" value={money(k.today)} sub={new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} accent />
        <KpiCard label="Estimated commission · 90-day forecast" value={money(k.forecast_90d)} sub="Run rate of the last 90 days. A projection, not money received" accent />
        <KpiCard label="Estimated commission · month to date" value={money(k.mtd)} sub={new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })} />
        <KpiCard label="Estimated commission · year to date" value={money(k.ytd)} sub="Since Jan 1. Estimated from posted production" />
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          Unified ledger: <strong className="text-foreground">{data.production.policies.toLocaleString()} policies</strong> · {money(data.production.alp)} AP · {data.production.producers.toLocaleString()} producers
        </span>
        <span>
          Team gross MTD: <strong className="text-foreground">{money(data.team_kpis.mtd)}</strong>
        </span>
      </div>

      {/* Commission types quad */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Commission types</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 grid-cols-2 xl:grid-cols-4">
          <TypeCard icon={DollarSign} label="Direct YTD" value={money(q.direct_ytd)} sub="Advance + trail, estimated" tone="text-primary" />
          <TypeCard icon={Users} label="Override pending" value={money(q.override_pending)} sub="From downline production" tone="text-success" />
          <TypeCard icon={Clock} label="Trail pending" value={money(q.trail_pending)} sub="Months 10–12 deferred" tone="text-info" />
          <TypeCard icon={TrendingUp} label="Renewal pending" value={money(q.renewal_pending)} sub="Years 2+ renewals" tone="text-warning" />
        </CardContent>
      </Card>

      {/* 12-month rolling forecast */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">12-month rolling forecast</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={56} domain={[0, (dataMax: number) => Math.ceil((dataMax * 1.25) / 5000) * 5000]} tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                <ChartTooltip
                  formatter={(v: number, n: string) => [money(v), n]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="direct" name="Direct" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.16} strokeWidth={2} />
                <Area type="monotone" dataKey="override" name="Override" stroke="hsl(var(--success))" fill="hsl(var(--success))" fillOpacity={0.12} strokeWidth={2} />
                <Area type="monotone" dataKey="trail" name="Trail" stroke="hsl(var(--info))" fill="hsl(var(--info))" fillOpacity={0.12} strokeWidth={2} />
                <Area type="monotone" dataKey="renewal" name="Renewal" stroke="hsl(var(--warning))" fill="hsl(var(--warning))" fillOpacity={0.12} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* How payouts are calculated */}
      <details className="rounded-lg border border-border bg-card">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-foreground">
          <Info className="h-4 w-4 text-muted-foreground" /> How payouts are calculated
        </summary>
        <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground space-y-2">
          <p>{data.comp_note}</p>
          <p>Direct = annual premium × the resolved producer comp. Override = your positive comp spread on downline production. Trail and renewal remain estimates until a carrier-paid feed is connected.</p>
        </div>
      </details>

      {/* Scheduled payouts */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-[12px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Estimated commission activity</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Posted production for this scope; not a carrier-paid receipt</p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={payoutRows.length === 0}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-36 text-center text-sm font-semibold">{monthLabel(data.payouts.month)}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="ml-2 text-sm font-bold tabular-nums text-success">{money(data.payouts.total)}</span>
          </div>
          {payoutRows.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-semibold text-foreground">No estimated commission activity for this month</p>
              <p className="mt-1 text-sm text-muted-foreground">Posted production appears here as estimates, separate from recorded payments.</p>
              <SubmitDealDialog trigger={<Button className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90">Post a Deal</Button>} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Agent</th><th className="py-2 pr-3">Client</th>
                    <th className="py-2 pr-3">Carrier</th><th className="hidden py-2 pr-3 md:table-cell">Product</th>
                    <th className="py-2 pr-3 text-right">AP</th><th className="py-2 text-right">Est. payout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payoutRows.map((r, i) => (
                    <tr key={`${r.date}|${r.client ?? ""}|${r.agent ?? ""}|${i}`}>
                      <td className="py-2 pr-3 tabular-nums text-muted-foreground">{r.date}</td>
                      <td className="max-w-36 py-2 pr-3">
                        <span className="block truncate">{r.agent ?? "—"}</span>
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{r.component.replace("team_", "")}</span>
                      </td>
                      <td className="max-w-36 truncate py-2 pr-3">{r.client ?? "—"}</td>
                      <td className="max-w-28 truncate py-2 pr-3 text-muted-foreground">{r.carrier ?? "—"}</td>
                      <td className="hidden max-w-32 truncate py-2 pr-3 text-muted-foreground md:table-cell">{r.product ?? "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(r.ap)}</td>
                      <td className="py-2 text-right font-semibold tabular-nums text-success">{money(r.est)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={breakTab} onValueChange={setBreakTab}>
            <TabsList>
              <TabsTrigger value="by_carrier">By Carrier</TabsTrigger>
              <TabsTrigger value="by_product">By Product</TabsTrigger>
              <TabsTrigger value="by_month">By Month</TabsTrigger>
              <TabsTrigger value="by_agent_overrides">By Agent (Overrides)</TabsTrigger>
            </TabsList>
            {(["by_carrier", "by_product", "by_month", "by_agent_overrides"] as const).map((key) => (
              <TabsContent key={key} value={key} className="mt-4">
                {(data.breakdown[key] ?? []).length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {key === "by_agent_overrides" ? "No override spread in this scope." : "No data in the trailing 12 months."}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <th className="py-2 pr-3">{key === "by_month" ? "Month" : key === "by_agent_overrides" ? "Agent" : key === "by_product" ? "Product" : "Carrier"}</th>
                          <th className="py-2 pr-3 text-right">Deals</th>
                          <th className="py-2 pr-3 text-right">Annual premium</th>
                          <th className="py-2 text-right">{key === "by_agent_overrides" ? "Est. override" : "Est. commission"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {(data.breakdown[key] ?? []).map((row) => (
                          <tr key={row.name}>
                            <td className="max-w-52 truncate py-2 pr-3">{key === "by_month" ? monthLabel(row.name) : row.name}</td>
                            <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{row.deals.toLocaleString()}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{money(row.ap)}</td>
                            <td className="py-2 text-right font-semibold tabular-nums text-primary">{money(row.est)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Reconciliation tab: the CFO-bot cockpit, transplanted intact ─────────
function ReconciliationTab({ viewerId }: { viewerId: string }) {
  const [tab, setTab] = useState<"overview"|"anomalies"|"commissions"|"approvals">("anomalies");

  const snapshot = useQuery({
    queryKey: ["cfo-snapshot", viewerId],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_cfo_snapshot" as any).select("*").maybeSingle();
      if (error) throw error;
      if (!data || typeof data !== "object") throw new Error("The finance snapshot is unavailable.");
      return data as unknown as CfoSnapshot;
    },
    refetchInterval: 300_000,
  });

  // These three CFO views each return ONE aggregate row whose detail lives in a
  // JSON array column (anomalies / stuck_list / idle_agents). They were being read
  // as if they were row-lists, so the Anomalies tab rendered blank junk. Pull the
  // single row and hand back its array.
  const dups = useQuery({
    queryKey: ["cfo-dup-charges", viewerId],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_cfo_dup_charge_watch" as any).select("anomalies").maybeSingle();
      if (error) throw error;
      return financeAggregateRows(data, "anomalies", "Duplicate charges");
    },
  });

  const stuck = useQuery({
    queryKey: ["cfo-stuck-paid", viewerId],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_cfo_ica_paid_stuck" as any).select("stuck_list").maybeSingle();
      if (error) throw error;
      return financeAggregateRows(data, "stuck_list", "Paid-applicant review");
    },
  });

  const idle = useQuery({
    queryKey: ["cfo-idle-agents", viewerId],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_cfo_agent_activation_watch" as any).select("idle_agents").maybeSingle();
      if (error) throw error;
      return financeAggregateRows(data, "idle_agents", "Agent activation review");
    },
  });

  const commissions = useQuery({
    queryKey: ["commission-recent", viewerId],
    queryFn: async () => {
      // `product` does not exist on commission_ledger — selecting it 400'd the whole
      // query and silently hid every commission row.
      const { data, error } = await supabase.from("commission_ledger" as any)
        .select("id, agent_id, amount, carrier_id, annual_premium, rate_source, created_at, status")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return financeRows(data, "Commission ledger");
    },
  });

  const approvals = useQuery({
    queryKey: ["cfo-approvals", viewerId],
    queryFn: async () => {
      // Real columns are subject/body/amount_cents (not title/description/amount) —
      // the old select 400'd and left the tab permanently empty.
      const { data, error } = await supabase.from("cfo_approval_requests" as any)
        .select("id, subject, body, amount_cents, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return financeRows(data, "Finance approvals");
    },
  });

  const refreshAll = () => {
    snapshot.refetch(); dups.refetch(); stuck.refetch(); idle.refetch();
    commissions.refetch(); approvals.refetch();
  };

  const snap = snapshot.data;
  const reads = [snapshot, dups, stuck, idle, commissions, approvals];
  const failedRead = reads.find(read => read.isError && read.data === undefined);
  if (failedRead) return <QueryState status="error" label="finance reconciliation" error={failedRead.error} onRetry={refreshAll} />;
  if (reads.some(read => read.isPending)) return <QueryState status="loading" label="finance reconciliation" />;
  const staleRead = reads.find(read => read.isError);

  return (
    <div className="space-y-5">
      {staleRead && <QueryState status="ready" stale label="finance reconciliation" error={staleRead.error} asOf={staleRead.dataUpdatedAt} onRetry={refreshAll} />}
      <div className="flex items-center justify-end gap-2">
        {snap?.as_of && (
          <Badge variant="outline" className="tabular-nums">Updated {relativeTime(snap.as_of)}</Badge>
        )}
        <Button size="sm" variant="outline" onClick={refreshAll}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${snapshot.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      {/* KPI stat row — the money numbers lead */}
      {snapshot.isLoading ? (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={/* stable-key-allow:skeleton-static-array */ i} className="h-24 rounded-md" />
          ))}
        </div>
      ) : snap ? (
        <div className="space-y-4">
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
            <StatTile icon={AlertTriangle} label="Ghost AP at risk" value={fmtUsd(snap.ghost_ap_at_risk)} tone="danger" sub="unreconciled advance exposure" />
            <StatTile icon={TrendingDown} label="Walked commission" value={fmtUsd(snap.lapsed_walked_commission)} tone="danger" sub="lapsed / withdrawn" />
            <StatTile icon={TrendingUp} label="Mentorship revenue" value={fmtUsd(snap.mentorship_revenue_usd)} tone="success" />
            <StatTile icon={CheckCircle2} label="Mentorship paid" value={snap.mentorship_paid_total} tone="success" sub="lifetime payments" />
            <StatTile icon={Clock} label="Course bought · stuck" value={snap.ica_paid_stuck} tone="warning" sub="paid for prelicensing · not advancing" />
            <StatTile icon={ShieldAlert} label="Open dup charges" value={snap.dup_charges_open} tone="warning" />
            <StatTile icon={Users} label="Idle active agents" value={snap.idle_active_agents} tone="warning" sub="no deal in 30d" />
          </div>

          {/* System status strip — sync health as compact chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Activity className="h-3.5 w-3.5" /> System
            </span>
            <Badge variant="outline" className={syncChipClass(snap.agentlink_sync)}>
              AgentLink history import {snap.agentlink_sync}
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
                        <p className="font-medium line-clamp-2">
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
                        <p className="text-sm font-bold line-clamp-2">{a.subject ?? "—"}</p>
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

function FinanceManagement({ viewerId }: { viewerId: string }) {
  const [scope, setScope] = useState<FinScope>("agency");
  const [mainTab, setMainTab] = useState<"overview" | "reconciliation">("overview");

  return (
    <section className="space-y-5" aria-label="Finance management">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black italic uppercase">Agency finances</h2>
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1" role="group" aria-label="Management finance scope">
            {SCOPES.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={scope === s.key}
                onClick={() => setScope(s.key)}
                className={cn(
                  "min-h-11 rounded-md px-3 py-2 text-sm font-semibold transition-colors",
                  scope === s.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
      </div>

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as typeof mainTab)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5 space-y-5">
          {mainTab === "overview" && <OverviewTab scope={scope} viewerId={viewerId} />}
          {/* Vantage + every sub-agency rolled under you, with your estimated
              override per agency (Sam 2026-08-26). Same component the dashboard
              uses, so the numbers cannot disagree between the two surfaces. */}
          {mainTab === "overview" && <ImoByAgency />}
        </TabsContent>
        <TabsContent value="reconciliation" className="mt-5">
          {mainTab === "reconciliation" && <ReconciliationTab viewerId={viewerId} />}
        </TabsContent>
      </Tabs>
    </section>
  );
}

export type FinanceTab = "personal" | "policies" | "management";

/** Pure workspace presentation, also used by isolated visual QA. */
export function FinanceWorkspaceView({ tab, onTabChange, canManage, children }: {
  tab: FinanceTab;
  onTabChange: (tab: FinanceTab) => void;
  canManage: boolean;
  children: ReactNode;
}) {
  const visibleTab = tab === "management" && !canManage ? "policies" : tab;
  return (
    <div className="page-enter mx-auto w-full max-w-7xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Your business"
        eyebrowIcon={<DollarSign className="h-3 w-3" />}
        title="Finances"
        subtitle="Policy status. Commission payments. Payout rates."
      />
      <Tabs value={visibleTab} onValueChange={value => {
        if (value === "personal" || value === "policies" || (value === "management" && canManage)) onTabChange(value);
      }}>
        <TabsList className={`grid h-auto w-full gap-1 rounded-lg border border-border bg-card p-1 sm:inline-flex sm:w-auto ${canManage ? "grid-cols-3" : "grid-cols-2"}`}>
          <TabsTrigger className="min-h-11 min-w-0 whitespace-normal px-2 text-sm font-bold leading-tight sm:px-4" value="policies">Policy book</TabsTrigger>
          <TabsTrigger className="min-h-11 min-w-0 whitespace-normal px-2 text-sm font-bold leading-tight sm:px-4" value="personal">Commissions</TabsTrigger>
          {canManage && <TabsTrigger className="min-h-11 min-w-0 whitespace-normal px-2 text-sm font-bold leading-tight sm:px-4" value="management">Management</TabsTrigger>}
        </TabsList>
        <TabsContent className="mt-5" value={visibleTab}>{children}</TabsContent>
      </Tabs>
    </div>
  );
}

export default function Finances() {
  usePageTitle("Finances · Galaxy");
  const { user, isAdmin, isLoading } = useAuth();
  const { isPreviewing } = useRolePreview();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab: FinanceTab = requestedTab === "commissions" || requestedTab === "personal" ? "personal" : requestedTab === "management" ? "management" : "policies";
  const canManage = Boolean(user && isAdmin && !isLoading && !isPreviewing);
  const activeTab = tab === "management" && !canManage ? "policies" : tab;
  const setTab = (next: FinanceTab) => setSearchParams(previous => {
    const params = new URLSearchParams(previous);
    params.set("tab", next === "personal" ? "commissions" : next);
    return params;
  }, { replace: true });

  useEffect(() => {
    if (isLoading || requestedTab !== "management" || canManage) return;
    setSearchParams(previous => {
      const params = new URLSearchParams(previous);
      params.set("tab", "policies");
      return params;
    }, { replace: true });
  }, [isLoading, requestedTab, canManage, setSearchParams]);

  return (
    <FinanceWorkspaceView tab={activeTab} onTabChange={setTab} canManage={canManage}>
      {!user || isLoading ? <QueryState status="loading" label="your finances" /> : activeTab === "management" && canManage ? (
        <FinanceManagement key={user.id} viewerId={user.id} />
      ) : activeTab === "policies" ? (
        <PersonalPolicyBook key={user.id} onViewPayments={() => setTab("personal")} />
      ) : (
        <MyCommissions key={user.id} embedded onViewPolicies={() => setTab("policies")} />
      )}
    </FinanceWorkspaceView>
  );
}
