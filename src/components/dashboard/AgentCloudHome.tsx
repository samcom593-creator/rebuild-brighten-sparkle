import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, CheckCircle2, DollarSign, LineChart as LineChartIcon,
  Shield, TrendingUp, UserPlus, Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ImoByAgency } from "@/components/dashboard/ImoByAgency";
import { SubmitDealDialog } from "@/components/deals/SubmitDealDialog";
import { cn } from "@/lib/utils";

// The Agent Cloud home, mirrored 1:1 against
// ~/business-ops/agentcloud-reference/pages/00-home-dashboard-fullpage.png,
// carrying APEX's real data.
//
// EVERY number comes from ONE server-side RPC (apex_home_dashboard). The page
// this replaces fired ~20 client-side queries — measured on a live load as 33
// API calls including agentlink_deals_snapshot EIGHT times and agents SEVEN
// times — several against the legacy `deals` table, and derived headline counts
// from arrays PostgREST silently caps at 1000 rows. That is both why the
// dashboard felt laggy and why it disagreed with the leaderboard.

interface HomeData {
  as_of: string;
  mtd: { personal_ap: number; personal_policies: number; team_ap: number; team_policies: number; goal: number; pct_to_goal: number; days_left: number };
  lifetime: { ap: number; policies: number };
  trend: Array<{ m: string; ap: number; policies: number }>;
  leaderboard: Array<{ name: string; ap: number; deals: number }>;
  policy_status: Record<string, number>;
  roster: { total: number; producing: number; in_onboarding: number };
  needs_attention: { lapse_pending: number; in_chargeback_window: number; dormant_producers: number };
}

const money = (n: number | null | undefined) => `$${Math.round(Number(n ?? 0)).toLocaleString()}`;
const monthShort = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};

// Order and copy follow the AC reference exactly. status_not_reported is APEX's
// own honest bucket: AgentLink returns policyStatus=None for 1,304 of 1,731
// deals upstream, and folding that into "Carrier N/A" would dress a data gap as
// a carrier problem.
const STATUS_TILES: Array<{ key: string; label: string; tone: string }> = [
  { key: "active", label: "Active", tone: "text-emerald-500" },
  { key: "issued_not_paid", label: "Issued, Not Paid", tone: "text-emerald-400" },
  { key: "in_review", label: "In Review", tone: "text-sky-400" },
  { key: "lapse_pending", label: "Lapse Pending", tone: "text-amber-400" },
  { key: "lapsed", label: "Lapsed", tone: "text-rose-400" },
  { key: "cancelled", label: "Cancelled", tone: "text-rose-500" },
  { key: "withdrawn", label: "Withdrawn", tone: "text-muted-foreground" },
  { key: "not_taken", label: "Not Taken", tone: "text-amber-500" },
  { key: "postponed", label: "Postponed", tone: "text-muted-foreground" },
  { key: "status_not_reported", label: "Status not reported", tone: "text-muted-foreground" },
];

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function AgentCloudHome() {
  const { data, isLoading } = useQuery({
    queryKey: ["apex-home-dashboard"],
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("apex_home_dashboard" as never, { p_scope: "agency" } as never);
      if (error) throw error;
      return data as unknown as HomeData;
    },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-48 rounded-lg" /><Skeleton className="h-48 rounded-lg" />
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  const { mtd, needs_attention: na, roster, policy_status } = data;
  const attention = [
    na.lapse_pending > 0 && { label: `${na.lapse_pending} policies pending lapse`, to: "/dashboard/retention", tone: "text-amber-500" },
    na.dormant_producers > 0 && { label: `${na.dormant_producers} producers dormant 45+ days`, to: "/dashboard/team", tone: "text-rose-400" },
    na.in_chargeback_window > 0 && { label: `${na.in_chargeback_window} policies inside the chargeback window`, to: "/dashboard/production", tone: "text-sky-400" },
  ].filter(Boolean) as Array<{ label: string; to: string; tone: string }>;

  const trend = (data.trend ?? []).map((t) => ({ ...t, name: monthShort(t.m) }));

  return (
    <div className="space-y-5">
      {/* WHAT NEEDS YOU TODAY */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">What needs you today</h2>
        {attention.length === 0 ? (
          <Card className="border-emerald-500/30 bg-emerald-500/[0.06]">
            <CardContent className="flex items-center gap-2.5 p-4">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <p className="text-sm text-foreground">You&rsquo;re clear. Nothing is overdue and nothing is waiting on you.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {attention.map((a) => (
              <Link key={a.to + a.label} to={a.to}>
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center gap-2.5 p-4">
                    <AlertTriangle className={cn("h-4 w-4 shrink-0", a.tone)} />
                    <p className="text-sm text-foreground">{a.label}</p>
                    <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* PRODUCTION BLOCK + MTD ALP */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Card>
          <CardContent className="grid grid-cols-1 gap-0 p-0 sm:grid-cols-2">
            <Stat label="Personal production" value={money(mtd.personal_ap)} sub="This month" />
            <Stat label="Total production (team)" value={money(mtd.team_ap)} sub="you + downline" />
            <Stat label="Total policies (personal)" value={String(mtd.personal_policies)} sub="This month" />
            <Stat label="Total policies (team)" value={String(mtd.team_policies)} sub="you + downline" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Month-to-date ALP</p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-primary">{money(mtd.team_ap)}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Goal {money(mtd.goal)} · <span className="font-semibold text-foreground">{mtd.pct_to_goal}% there</span> · {mtd.days_left} days left
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, mtd.pct_to_goal)}%` }} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <SubmitDealDialog trigger={<Button size="sm">Post a Deal</Button>} />
              <Button asChild size="sm" variant="outline"><Link to="/dashboard/leaderboard">Leaderboard</Link></Button>
              <Button asChild size="sm" variant="outline"><Link to="/dashboard/production">Production</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ROSTER + IMO */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><CardContent className="p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><Users className="h-3 w-3" />Roster</p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums">{roster.total}</p>
              <p className="text-[11px] text-muted-foreground">agents on the team</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><TrendingUp className="h-3 w-3" />Producing</p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-emerald-500">{roster.producing}</p>
              <p className="text-[11px] text-muted-foreground">wrote business in 120d</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><UserPlus className="h-3 w-3" />In onboarding</p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-amber-500">{roster.in_onboarding}</p>
              <p className="text-[11px] text-muted-foreground">active, no production yet</p>
            </CardContent></Card>
          </div>
          <ImoByAgency />
        </div>

        {/* LEADERBOARD */}
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Leaderboard</p>
              <Link to="/dashboard/leaderboard" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            {data.leaderboard.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No production yet this period.</p>
            ) : (
              <div className="space-y-2">
                {data.leaderboard.slice(0, 8).map((r, i) => (
                  <div key={r.name} className="flex items-center gap-3 text-sm">
                    <span className="w-5 shrink-0 text-xs font-bold tabular-nums text-muted-foreground">#{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{r.deals}d</span>
                    <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{money(r.ap)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* PRODUCTION TREND */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            <LineChartIcon className="h-3 w-3" />Production trend · 12 months
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={56}
                  domain={[0, (dataMax: number) => Math.ceil((dataMax * 1.2) / 5000) * 5000]}
                  tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
                <ChartTooltip formatter={(v: number) => money(v)}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="ap" name="ALP" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.16} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* POLICY STATUS */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              <Shield className="h-3 w-3" />Policy status
            </p>
            <span className="text-[11px] text-muted-foreground">{data.lifetime.policies.toLocaleString()} policies · {money(data.lifetime.ap)} book</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {STATUS_TILES.map((t) => (
              <div key={t.key} className="rounded-lg border border-border bg-background/40 p-3">
                <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t.label}</p>
                <p className={cn("mt-1 text-xl font-bold tabular-nums", t.tone)}>{(policy_status?.[t.key] ?? 0).toLocaleString()}</p>
              </div>
            ))}
          </div>
          {(policy_status?.status_not_reported ?? 0) > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              <Badge variant="outline" className="mr-1.5 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400">Upstream gap</Badge>
              AgentLink does not report a policy status for {(policy_status.status_not_reported).toLocaleString()} of these policies, so lapse and chargeback tracking is blind on them.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
