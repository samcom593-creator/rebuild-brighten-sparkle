// AgentCommandDashboard v4 — real data depth, no animation theater.
//
// Single high-density agent operating-system view. Pulls from:
//   - v_agent_command_center (40 cols of derived stats per agent)
//   - daily_production (30-day trend)
//   - agent_lifetime_production (lifetime ALP + deal count)
//   - agent_revenue_estimate (commission projection from contract %)
//   - agent_goals (current month income goal)
//   - deals (recent 8 closed)
//
// No mock numbers, no fallback placeholders, no fluff. If a row is
// missing the page shows the empty state with the reason and a CTA.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, ArrowRight, BarChart3, Briefcase, Calendar, ChevronRight,
  CircleDollarSign, Crown, DollarSign, Flame, ShieldCheck, Sparkles,
  Target, TrendingDown, TrendingUp, Trophy, UserPlus, Users, Wallet,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { NextStepCard } from "@/components/dashboard/NextStepCard";
import { RegionPeerCard, UpcomingChargebackCard } from "@/components/dashboard/AgentPeerAndChargebackCards";
import { DEAL_TRUTH_STATUS_FILTER, dealTruthWindowOr, getDealTruthTimestamp } from "@/lib/dealTruth";

// ─── Formatters ─────────────────────────────────────────────────────────────
function fmtUsd(n: number, compact = false): string {
  if (!Number.isFinite(n)) return "$0";
  if (compact) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 10_000) return `$${(n / 1_000).toFixed(1)}k`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(n);
}
function fmtNum(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n || 0));
}
function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

// ─── Types ──────────────────────────────────────────────────────────────────
interface CC {
  agent_id: string; user_id: string;
  agent_code: string | null; display_name: string | null; full_name: string | null;
  email: string; agent_status: string | null; onboarding_stage: string | null;
  license_status: string | null; manager_id: string | null; manager_name: string | null;
  is_presenting: boolean | null;
  deals_today: number; deals_wtd: number; deals_mtd: number; deals_30d: number;
  ap_wtd: number | string; ap_mtd: number | string; ap_30d: number | string;
  commission_lifetime_cents: number;
  chargebacks: number; lapses: number;
  presentations_today: number; presentations_wtd: number; presentations_mtd: number;
  hours_called_today: number | string; hours_called_wtd: number | string; hours_called_mtd: number | string;
  last_production_date: string | null;
  apps_assigned: number; apps_open: number; apps_new_7d: number; apps_needing_contact: number;
  close_rate_mtd_pct: number | null;
  ap_trend_pct: number | null;
  rank_agency_mtd: number | null; rank_agency_wtd: number | null; rank_team_mtd: number | null;
  activity_state: string | null; next_action: string | null;
}

interface Daily {
  production_date: string;
  presentations: number;
  deals_closed: number;
  aop: number | string;
  hours_called: number | string;
}

interface Lifetime {
  agent_id: string;
  lifetime_alp: number | string;
  lifetime_deals: number;
  last_production_date: string | null;
}

interface Revenue {
  agent_id: string;
  contract_pct: number | string;
  override_rate: number | string;
  personal_monthly_alp: number | string;
  downline_monthly_alp: number | string;
  personal_monthly_estimate: number | string;
  override_monthly_estimate: number | string;
  insuracloud_mtd: number | string;
  insuracloud_direct: number | string;
  insuracloud_override: number | string;
  insuracloud_last_sync: string | null;
}

interface Goal {
  id: string; agent_id: string;
  month_year: string;
  income_goal: number | string;
  comp_percentage: number | string;
}

interface Deal {
  id: string; client_first_name: string | null; client_last_name: string | null;
  product_sold: string | null; annual_premium: number | string;
  posted_at: string | null; status: string | null; pipeline_stage: string | null;
}

// ─── Main ───────────────────────────────────────────────────────────────────
export default function AgentCommandDashboard() {
  usePageTitle("Command Center · APEX");
  const { user, isAdmin } = useAuth();

  // Admin (Sam) sees a totally different page — the agency view.
  // We don't waste queries on the agent flow if they're admin.
  if (isAdmin) return <AgencyCommandView />;

  // ── Resolve current agent id ────────────────────────────────────────────
  const { data: meAgent } = useQuery({
    queryKey: ["me-agent-row", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string } | null;
    },
  });

  const agentId = meAgent?.id ?? null;

  // ── Command center row ──────────────────────────────────────────────────
  const cc = useQuery({
    queryKey: ["cc-self", agentId],
    enabled: !!agentId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_command_center" as any)
        .select("*")
        .eq("agent_id", agentId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as CC | null;
    },
  });

  const daily = useQuery({
    queryKey: ["daily-self", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("daily_production")
        .select("production_date, presentations, deals_closed, aop, hours_called")
        .eq("agent_id", agentId!)
        .gte("production_date", since)
        .order("production_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Daily[];
    },
  });

  const lifetime = useQuery({
    queryKey: ["lifetime-self", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_lifetime_production" as any)
        .select("*")
        .eq("agent_id", agentId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Lifetime | null;
    },
  });

  const revenue = useQuery({
    queryKey: ["revenue-self", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_revenue_estimate" as any)
        .select("*")
        .eq("agent_id", agentId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Revenue | null;
    },
  });

  const monthYear = format(new Date(), "yyyy-MM");
  const goal = useQuery({
    queryKey: ["goal-self", agentId, monthYear],
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_goals")
        .select("*")
        .eq("agent_id", agentId!)
        .eq("month_year", monthYear)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as Goal | null;
    },
  });

  const deals = useQuery({
    queryKey: ["deals-self", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals")
        .select("id, client_first_name, client_last_name, product_sold, annual_premium, posted_at, status, pipeline_stage")
        .eq("agent_id", agentId!)
        .order("posted_at", { ascending: false, nullsFirst: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as unknown as Deal[];
    },
  });

  // ── Derived ─────────────────────────────────────────────────────────────
  const stats = cc.data;
  const apMtd = Number(stats?.ap_mtd ?? 0);
  const apWtd = Number(stats?.ap_wtd ?? 0);
  const ap30 = Number(stats?.ap_30d ?? 0);
  const commissionLifetimeUsd = (stats?.commission_lifetime_cents ?? 0) / 100;
  const closeRate = stats?.close_rate_mtd_pct ?? null;
  const trend = stats?.ap_trend_pct ?? null;
  const hoursMtd = Number(stats?.hours_called_mtd ?? 0);
  const hoursWtd = Number(stats?.hours_called_wtd ?? 0);

  // 30-day daily sparkline data (fill missing days as zero)
  const sparkline = useMemo(() => {
    const map = new Map<string, Daily>();
    for (const d of daily.data ?? []) map.set(d.production_date, d);
    const out: { day: string; ap: number; deals: number; hours: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000);
      const key = date.toISOString().slice(0, 10);
      const row = map.get(key);
      out.push({
        day: key,
        ap: Number(row?.aop ?? 0),
        deals: Number(row?.deals_closed ?? 0),
        hours: Number(row?.hours_called ?? 0),
      });
    }
    return out;
  }, [daily.data]);

  // Goal pacing — projection to month end
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const dayOfMonth = today.getDate();
  const monthProgressPct = (dayOfMonth / daysInMonth) * 100;
  const incomeGoal = Number(goal.data?.income_goal ?? 0);
  const compPct = Number(goal.data?.comp_percentage ?? revenue.data?.contract_pct ?? 100) / 100;
  const monthApProjected = dayOfMonth > 0 ? (apMtd / dayOfMonth) * daysInMonth : 0;
  const monthCommissionProjected = monthApProjected * compPct;
  const goalProgressPct = incomeGoal > 0
    ? Math.min(100, (monthCommissionProjected / incomeGoal) * 100)
    : 0;

  // ── Render ──────────────────────────────────────────────────────────────
  if (!user) return null;

  if (!meAgent && !cc.isLoading) {
    return (
      <div className="page-enter px-4 sm:px-6 pb-24">
        <PageHeader
          eyebrow="Command Center" eyebrowIcon={<Crown className="h-3 w-3" />}
          title="Agent profile not linked yet"
          subtitle="We couldn't find an agent record for your account. Ask Sam to wire your auth user to an agents row, then refresh."
          accent="amber"
        />
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="No agent record"
          description="Your user ID isn't linked to an agents.user_id. Contact ops to fix."
          actions={
            <Button asChild variant="outline">
              <a href="mailto:sam.com593@gmail.com?subject=Agent%20profile%20not%20linked">Email Sam</a>
            </Button>
          }
        />
      </div>
    );
  }

  const displayName = stats?.display_name ?? stats?.full_name ?? user.email ?? "Agent";
  const isStrong = (stats?.rank_agency_mtd ?? 999) <= 10;

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      {/* ── HERO ─────────────────────────────────────────────── */}
      <PageHeader
        eyebrow={`${stats?.agent_code ?? "—"} · ${stats?.license_status ?? "unlicensed"}`}
        eyebrowIcon={<ShieldCheck className="h-3 w-3" />}
        title={`Welcome back, ${displayName.split(" ")[0]}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {stats?.manager_name ? <>Reporting to <span className="text-foreground font-medium">{stats.manager_name}</span> · </> : null}
              <span className="text-foreground font-medium">{stats?.onboarding_stage?.replaceAll("_", " ") ?? "—"}</span>
            </span>
            {stats?.activity_state && stats.activity_state !== "active" && (
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40">
                {stats.activity_state.replaceAll("_", " ")}
              </Badge>
            )}
            {isStrong && (
              <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40">
                <Trophy className="h-3 w-3 mr-1" /> Top 10 agency
              </Badge>
            )}
          </span>
        }
        accent={isStrong ? "emerald" : "primary"}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/numbers"><Activity className="h-4 w-4 mr-1.5" /> Log numbers</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/dashboard/crm">Open CRM <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
            </Button>
          </div>
        }
      />

      {/* ── NEXT STEP CARD — what's the next concrete move ───── */}
      {agentId && <NextStepCard agent_id={agentId} />}

      {/* ── 4 KPI TILES ───────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          icon={DollarSign}
          label="MTD Annual Premium"
          value={fmtUsd(apMtd)}
          subValue={`${fmtUsd(apWtd, true)} this week`}
          trendPct={trend}
          color="text-emerald-500 dark:text-emerald-400"
          loading={cc.isLoading}
        />
        <KpiTile
          icon={Trophy}
          label="MTD Deals"
          value={fmtNum(stats?.deals_mtd ?? 0)}
          subValue={`${fmtNum(stats?.deals_wtd ?? 0)} this week`}
          color="text-amber-500 dark:text-amber-400"
          loading={cc.isLoading}
        />
        <KpiTile
          icon={CircleDollarSign}
          label="Commission projected"
          value={fmtUsd(monthCommissionProjected, true)}
          subValue={incomeGoal > 0 ? `${fmtPct(goalProgressPct)} of $${fmtNum(incomeGoal)} goal` : "Set a monthly goal →"}
          color="text-primary"
          loading={cc.isLoading || revenue.isLoading}
        />
        <KpiTile
          icon={Crown}
          label="Agency rank · MTD"
          value={stats?.rank_agency_mtd ? `#${stats.rank_agency_mtd}` : "—"}
          subValue={`Team: ${stats?.rank_team_mtd ? `#${stats.rank_team_mtd}` : "—"} · Close: ${fmtPct(closeRate, 0)}`}
          color="text-violet-500 dark:text-violet-400"
          loading={cc.isLoading}
        />
      </div>

      {/* ── PRODUCTION TREND + PIPELINE ───────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        {/* 30-day AP area */}
        <GlassCard className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">30-day production</p>
              <h3 className="text-lg font-bold">Annual premium by day</h3>
            </div>
            <Badge variant="outline" className="text-xs">{fmtUsd(ap30, true)} · last 30d</Badge>
          </div>
          {daily.isLoading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : sparkline.every((d) => d.ap === 0) ? (
            <EmptyState
              icon={<BarChart3 className="h-6 w-6" />}
              title="No production logged in the last 30 days"
              description="Log your daily numbers — calls, presentations, and deals — and they'll show up here."
              actions={<Button asChild size="sm"><Link to="/numbers">Log today's numbers</Link></Button>}
            />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={sparkline}>
                <defs>
                  <linearGradient id="apGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="hsl(168 70% 45%)" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="hsl(168 70% 45%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
                <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d), "MMM d")} fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={10} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                  labelFormatter={(d) => format(new Date(d), "PPP")}
                  formatter={(v: number) => fmtUsd(v)}
                />
                <Area type="monotone" dataKey="ap" stroke="hsl(168 70% 45%)" fill="url(#apGrad)" name="AP" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </GlassCard>

        {/* Pipeline funnel */}
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Your pipeline</p>
              <h3 className="text-lg font-bold">Applicants</h3>
            </div>
            <Briefcase className="h-5 w-5 text-muted-foreground" />
          </div>
          <FunnelStrip
            steps={[
              { label: "Assigned", value: stats?.apps_assigned ?? 0, color: "bg-primary" },
              { label: "Open", value: stats?.apps_open ?? 0, color: "bg-emerald-500" },
              { label: "Need contact", value: stats?.apps_needing_contact ?? 0, color: "bg-rose-500" },
              { label: "New (7d)", value: stats?.apps_new_7d ?? 0, color: "bg-amber-500" },
            ]}
          />
          <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {stats?.apps_needing_contact ? `${stats.apps_needing_contact} need contact now` : "Pipeline clean"}
            </span>
            <Button asChild size="sm" variant="ghost">
              <Link to="/dashboard/applicants">Open <ChevronRight className="h-3 w-3 ml-0.5" /></Link>
            </Button>
          </div>
        </GlassCard>
      </div>

      {/* ── ACTIVITY + GOAL PACE + STANDING (3-up) ─────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        {/* Activity */}
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Activity</p>
            <Activity className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-3">
            <StatRow label="Hours dialed · MTD" value={`${hoursMtd.toFixed(1)}h`} />
            <StatRow label="Hours dialed · WTD" value={`${hoursWtd.toFixed(1)}h`} />
            <StatRow label="Presentations · MTD" value={fmtNum(stats?.presentations_mtd ?? 0)} />
            <StatRow label="Presentations · WTD" value={fmtNum(stats?.presentations_wtd ?? 0)} />
            <StatRow label="Last production day" value={
              stats?.last_production_date
                ? formatDistanceToNow(new Date(stats.last_production_date), { addSuffix: true })
                : "—"
            } muted={!stats?.last_production_date} />
          </div>
          {stats?.next_action && (
            <div className="mt-4 pt-3 border-t border-border/40">
              <p className="text-xs text-muted-foreground mb-1">Next best action</p>
              <p className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> {stats.next_action}
              </p>
            </div>
          )}
        </GlassCard>

        {/* Goal Pace */}
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Income goal · {format(today, "MMMM")}</p>
            <Target className="h-5 w-5 text-muted-foreground" />
          </div>
          {incomeGoal > 0 ? (
            <>
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-3xl font-bold tabular-nums">{fmtUsd(monthCommissionProjected, true)}</span>
                <span className="text-sm text-muted-foreground">of {fmtUsd(incomeGoal, true)}</span>
              </div>
              <Progress value={goalProgressPct} className="h-2.5" />
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-md border border-border/40 p-2">
                  <p className="text-muted-foreground">Month progress</p>
                  <p className="font-bold text-base">{Math.round(monthProgressPct)}%</p>
                </div>
                <div className="rounded-md border border-border/40 p-2">
                  <p className="text-muted-foreground">Pace status</p>
                  <p className={`font-bold text-base ${goalProgressPct >= monthProgressPct ? "text-emerald-500 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}>
                    {goalProgressPct >= monthProgressPct ? "Ahead" : "Behind"}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Target className="h-6 w-6" />}
              title="No monthly goal set"
              description="Add an income target so your pace and projection show here."
              actions={<Button asChild size="sm" variant="outline"><Link to="/dashboard/settings">Set goal</Link></Button>}
              variant="default"
            />
          )}
        </GlassCard>

        {/* Standing */}
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Team standing</p>
            <Trophy className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <RankCell label="Agency MTD" rank={stats?.rank_agency_mtd ?? null} />
            <RankCell label="Agency WTD" rank={stats?.rank_agency_wtd ?? null} />
            <RankCell label="Team MTD" rank={stats?.rank_team_mtd ?? null} />
          </div>
          <div className="mt-4 pt-3 border-t border-border/40 space-y-2">
            <StatRow label="Lifetime AP" value={fmtUsd(Number(lifetime.data?.lifetime_alp ?? 0))} />
            <StatRow label="Lifetime deals" value={fmtNum(lifetime.data?.lifetime_deals ?? 0)} />
            <StatRow label="Commission · lifetime" value={fmtUsd(commissionLifetimeUsd, true)} />
            <StatRow label="Chargebacks · lapses" value={`${stats?.chargebacks ?? 0} · ${stats?.lapses ?? 0}`} muted />
          </div>
          <Button asChild variant="ghost" size="sm" className="w-full mt-3">
            <Link to="/dashboard/leaderboard">View leaderboard <ArrowRight className="h-3 w-3 ml-1" /></Link>
          </Button>
        </GlassCard>
      </div>

      {/* ── PL-040 · Region peers + Upcoming chargebacks ────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <RegionPeerCard agentId={agentId} />
        <UpcomingChargebackCard agentId={agentId} />
      </div>

      {/* ── RECENT DEALS + DAILY DEAL BAR ──────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        {/* Recent deals */}
        <GlassCard className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Recent deals</p>
              <h3 className="text-lg font-bold">Last 8 closed</h3>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link to="/dashboard/my-deals">All deals <ArrowRight className="h-3 w-3 ml-1" /></Link>
            </Button>
          </div>
          {deals.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (deals.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Trophy className="h-6 w-6" />}
              title="No deals yet"
              description="First deal coming up? Log it the moment the policy submits — it shows here within seconds."
              actions={<Button asChild size="sm"><Link to="/dashboard/agent-pipeline">Open pipeline</Link></Button>}
            />
          ) : (
            <ul className="divide-y divide-border/40">
              {(deals.data ?? []).map((d) => (
                <li key={d.id} className="py-2.5 flex items-center justify-between gap-3 hover:bg-primary/[0.04] rounded px-2 -mx-2 transition-colors">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">
                      {[d.client_first_name, d.client_last_name].filter(Boolean).join(" ") || "Unknown client"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {d.product_sold ?? "—"} · {d.pipeline_stage ?? d.status ?? "—"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold tabular-nums text-emerald-500 dark:text-emerald-400">
                      {fmtUsd(Number(d.annual_premium ?? 0), true)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {d.posted_at ? formatDistanceToNow(new Date(d.posted_at), { addSuffix: true }) : "—"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {/* Daily deals bar */}
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Daily deals · 30d</p>
              <h3 className="text-lg font-bold">{fmtNum(stats?.deals_30d ?? 0)} total</h3>
            </div>
            <Flame className="h-5 w-5 text-rose-500 dark:text-rose-400" />
          </div>
          {daily.isLoading ? (
            <Skeleton className="h-[180px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={sparkline}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
                <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d), "M/d")} fontSize={9} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                  labelFormatter={(d) => format(new Date(d), "PPP")}
                />
                <Bar dataKey="deals" fill="hsl(168 70% 45%)" name="Deals" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassCard>
      </div>

      {/* ── QUICK ACTIONS ──────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <QuickAction icon={Activity}  to="/numbers"                 label="Log production" desc="Calls, presentations, deals" />
        <QuickAction icon={Briefcase} to="/dashboard/agent-pipeline" label="Client pipeline" desc="Active book of business" />
        <QuickAction icon={Users}     to="/dashboard/recruit-pipeline" label="Recruit pipeline" desc="Applicants in progress" />
        <QuickAction icon={Calendar}  to="/dashboard/calendar"      label="Calendar" desc="Today + upcoming" />
        <QuickAction icon={Wallet}    to="/dashboard/my-commissions" label="Commissions" desc="Earnings + projections" />
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface KpiTileProps {
  icon: React.ElementType;
  label: string;
  value: string;
  subValue: string;
  trendPct?: number | null;
  color: string;
  loading: boolean;
}
function KpiTile({ icon: Icon, label, value, subValue, trendPct, color, loading }: KpiTileProps) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</p>
          {loading ? <Skeleton className="h-9 w-32 mt-1" /> : (
            <p className={`text-3xl font-bold tabular-nums mt-1 ${color}`}>{value}</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{subValue}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Icon className={`h-7 w-7 ${color} opacity-70`} />
          {trendPct != null && Number.isFinite(trendPct) && (
            <Badge variant="outline" className={`text-[10px] gap-0.5 ${
              trendPct >= 0
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
                : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/40"
            }`}>
              {trendPct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(trendPct).toFixed(0)}%
            </Badge>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

interface FunnelStep { label: string; value: number; color: string; }
function FunnelStrip({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-2">
      {steps.map((s) => (
        <div key={s.label} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-semibold tabular-nums">{fmtNum(s.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${s.color} rounded-full transition-all duration-500`}
              style={{ width: `${(s.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

interface RankCellProps { label: string; rank: number | null; }
function RankCell({ label, rank }: RankCellProps) {
  const isTop = rank != null && rank <= 10;
  return (
    <div className="rounded-md border border-border/40 p-2 text-center">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-0.5 ${isTop ? "text-amber-500 dark:text-amber-400" : ""}`}>
        {rank != null ? `#${rank}` : "—"}
      </p>
    </div>
  );
}

interface StatRowProps { label: string; value: string; muted?: boolean; }
function StatRow({ label, value, muted }: StatRowProps) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${muted ? "text-muted-foreground" : ""}`}>{value}</span>
    </div>
  );
}

interface QuickActionProps { icon: React.ElementType; to: string; label: string; desc: string; }
function QuickAction({ icon: Icon, to, label, desc }: QuickActionProps) {
  return (
    <Link to={to} className="group">
      <GlassCard className="p-4 h-full group-hover:border-primary/40 transition-colors">
        <div className="flex items-start gap-3">
          <span className="h-10 w-10 rounded-lg flex items-center justify-center bg-primary/10 border border-primary/30 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-[11px] text-muted-foreground truncate">{desc}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </div>
      </GlassCard>
    </Link>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// AGENCY VIEW — what Sam (admin/owner) sees instead of the per-agent panel.
//
// Sam's complaint was real: as the OWNER, his "rank #17" wasn't a bug — it
// was the wrong perspective entirely. He doesn't sell deals personally any
// more, he runs the agency. So this view is built around v_ceo_command_center
// + live aggregations, NOT v_agent_command_center filtered to his agent_id.
// ═════════════════════════════════════════════════════════════════════════════

interface CeoRow {
  deals_today: number; deals_wtd: number; deals_mtd: number; deals_30d: number;
  ap_wtd: number | string; ap_mtd: number | string;
  ap_30d: number | string; ap_prev_30d: number | string;
  chargebacks_30d: number; lapses_30d: number;
  total_agents: number; active_agents: number; inactive_agents: number;
  licensed_agents: number; unlicensed_agents: number; onboarding_agents: number;
  producing_agents_30d: number;
  total_applications: number; apps_today: number; apps_wtd: number; apps_mtd: number;
  paid_mtd: number; stale_new_3d: number; unassigned_open: number; uncontacted_24h: number;
  ref_total: number; ref_open: number; ref_30d: number; ref_won: number;
  top_producers_mtd: Array<{ agent_id: string; display_name: string | null; ap_mtd: number; deals_mtd: number; rank_agency_mtd: number }> | null;
  ap_trend_pct: number | null;
  as_of: string | null;
}

interface AgencyTrendRow { day: string; deals: number; ap: number | string; }

type AgencyPeriod = "day" | "week" | "month" | "custom";

const AGENCY_PERIODS: Array<{ value: AgencyPeriod; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "custom", label: "Custom" },
];

function dateInputValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function getAgencyPeriodBounds(period: AgencyPeriod, customStart: string, customEnd: string) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (period === "week") {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
  } else if (period === "month") {
    start.setDate(1);
  } else if (period === "custom") {
    const parsedStart = new Date(`${customStart}T00:00:00`);
    const parsedEnd = new Date(`${customEnd}T23:59:59.999`);
    if (Number.isFinite(parsedStart.getTime()) && Number.isFinite(parsedEnd.getTime()) && parsedStart <= parsedEnd) {
      return {
        startIso: parsedStart.toISOString(),
        endIso: parsedEnd.toISOString(),
        label: `${format(parsedStart, "MMM d")} - ${format(parsedEnd, "MMM d")}`,
      };
    }
  }

  const label = period === "day" ? "Today" : period === "week" ? "This week" : "This month";
  return { startIso: start.toISOString(), endIso: end.toISOString(), label };
}

function AgencyCommandView() {
  usePageTitle("Agency Command · APEX");
  const [period, setPeriod] = useState<AgencyPeriod>("month");
  const [customStart, setCustomStart] = useState(() => dateInputValue(new Date(Date.now() - 6 * 86_400_000)));
  const [customEnd, setCustomEnd] = useState(() => dateInputValue(new Date()));
  const periodBounds = useMemo(
    () => getAgencyPeriodBounds(period, customStart, customEnd),
    [period, customStart, customEnd],
  );

  // ── CEO rollup ────────────────────────────────────────────────────────
  const ceo = useQuery({
    queryKey: ["agency-ceo"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_ceo_command_center" as any)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as CeoRow | null;
    },
  });

  // ── Period truth: one query drives owner KPIs, top producers, and
  // manager production share. This stops the owner view from mixing MTD
  // cards with day/week/custom context.
  const periodDeals = useQuery({
    queryKey: ["agency-period-deals", periodBounds.startIso, periodBounds.endIso],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals" as any)
        .select("id, annual_premium, posted_at, created_at, agent_id")
        .or(dealTruthWindowOr(periodBounds.startIso, periodBounds.endIso))
        .in("status", DEAL_TRUTH_STATUS_FILTER);
      if (error) throw error;

      const dealRows = (data ?? []) as Array<{
        id: string;
        annual_premium: number | string | null;
        posted_at: string | null;
        created_at: string | null;
        agent_id: string | null;
      }>;
      const agentIds = Array.from(new Set(dealRows.map((row) => row.agent_id).filter(Boolean))) as string[];
      if (agentIds.length === 0) return dealRows.map((row) => ({ ...row, agent: null }));

      const { data: agentRows, error: agentError } = await supabase
        .from("agents")
        .select("id, display_name, agent_code, manager_id")
        .in("id", agentIds);
      if (agentError) throw agentError;

      const agents = (agentRows ?? []) as Array<{
        id: string;
        display_name: string | null;
        agent_code: string | null;
        manager_id: string | null;
      }>;
      const managerIds = Array.from(new Set(agents.map((agent) => agent.manager_id).filter(Boolean))) as string[];
      const managerById = new Map<string, { id: string; display_name: string | null }>();
      if (managerIds.length > 0) {
        const { data: managers, error: managerError } = await supabase
          .from("agents")
          .select("id, display_name")
          .in("id", managerIds);
        if (managerError) throw managerError;
        for (const manager of (managers ?? []) as Array<{ id: string; display_name: string | null }>) {
          managerById.set(manager.id, manager);
        }
      }

      const agentById = new Map(agents.map((agent) => [
        agent.id,
        { ...agent, manager: agent.manager_id ? managerById.get(agent.manager_id) ?? null : null },
      ]));

      return dealRows.map((row) => ({ ...row, agent: row.agent_id ? agentById.get(row.agent_id) ?? null : null }));
    },
  });

  // PL: Agency AP should be ALL deals (excl chargebacks), NOT only "trusted"
  // statuses (submitted + active). Sam flagged that the headline number was
  // being filtered down and undercounting actual production.
  const periodDealsAllStatuses = useQuery({
    queryKey: ["agency-period-deals-all", periodBounds.startIso, periodBounds.endIso],
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals" as any)
        .select("annual_premium, status")
        .or(dealTruthWindowOr(periodBounds.startIso, periodBounds.endIso))
        .is("chargeback_at", null);
      if (error) throw error;
      const rows = data ?? [];
      const totalAp = rows.reduce((s: number, r: any) => s + Number(r.annual_premium ?? 0), 0);
      return { totalAp, count: rows.length };
    },
  });

  const periodSummary = useMemo(() => {
    const byAgent = new Map<string, {
      agent_id: string;
      display_name: string;
      agent_code: string | null;
      avatar_url: string | null;
      ap: number;
      deals: number;
    }>();
    const byManager = new Map<string, { name: string; ap: number; deals: number }>();
    let totalAp = 0;

    for (const deal of (periodDeals.data ?? []) as any[]) {
      const ap = Number(deal.annual_premium ?? 0);
      const agent = deal.agent;
      const agentId = deal.agent_id ?? agent?.id ?? "unknown";
      const agentName = agent?.display_name ?? "Unknown";
      totalAp += ap;

      const existingAgent = byAgent.get(agentId) ?? {
        agent_id: agentId,
        display_name: agentName,
        agent_code: agent?.agent_code ?? null,
        avatar_url: null,
        ap: 0,
        deals: 0,
      };
      byAgent.set(agentId, { ...existingAgent, ap: existingAgent.ap + ap, deals: existingAgent.deals + 1 });

      const manager = agent?.manager;
      const managerId = manager?.id ?? "direct";
      const managerName = manager?.display_name ?? "Direct to Sam / no manager";
      const existingManager = byManager.get(managerId) ?? { name: managerName, ap: 0, deals: 0 };
      byManager.set(managerId, {
        name: managerName,
        ap: existingManager.ap + ap,
        deals: existingManager.deals + 1,
      });
    }

    const producers = Array.from(byAgent.values())
      .sort((a, b) => b.ap - a.ap)
      .slice(0, 10);

    const managers = Array.from(byManager.values())
      .map((row) => ({ ...row, pct: totalAp > 0 ? (row.ap / totalAp) * 100 : 0 }))
      .sort((a, b) => b.ap - a.ap)
      .slice(0, 6);

    return {
      totalAp,
      dealCount: (periodDeals.data ?? []).length,
      producingAgents: byAgent.size,
      producers,
      managers,
    };
  }, [periodDeals.data]);

  const priorPeriodDeals = useQuery({
    queryKey: ["agency-prior-period-deals", periodBounds.startIso, periodBounds.endIso],
    refetchInterval: 120_000,
    queryFn: async () => {
      const start = new Date(periodBounds.startIso);
      const end = new Date(periodBounds.endIso);
      const lengthMs = Math.max(86_400_000, end.getTime() - start.getTime());
      const priorStart = new Date(start.getTime() - lengthMs);
      const priorEnd = new Date(start.getTime());
      const { data, error } = await supabase
        .from("deals" as any)
        .select("annual_premium")
        .or(dealTruthWindowOr(priorStart.toISOString(), priorEnd.toISOString()))
        .in("status", DEAL_TRUTH_STATUS_FILTER);
      if (error) throw error;
      return (data ?? []).reduce((sum: number, row: any) => sum + Number(row.annual_premium ?? 0), 0);
    },
  });

  const periodTrendPct = priorPeriodDeals.data && priorPeriodDeals.data > 0
    ? ((periodSummary.totalAp - priorPeriodDeals.data) / priorPeriodDeals.data) * 100
    : null;

  // ── Recent hires (last 14d) — surfaces just-hired agents who have
  // zero production yet and would otherwise be invisible in the agency
  // view. v_recent_hires filters out deactivated/inactive/ghost rows
  // and joins managers, so we just sort by hired_on. (PL-017)
  const recentHires = useQuery({
    queryKey: ["agency-recent-hires-14d"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("v_recent_hires" as any)
        .select("id, display_name, agent_code, hired_on, manager_name, onboarding_stage, days_on_team, total_premium, total_policies")
        .gte("hired_on", since)
        .order("hired_on", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; display_name: string; agent_code: string | null;
        hired_on: string; manager_name: string | null;
        onboarding_stage: string | null; days_on_team: number;
        total_premium: number | string; total_policies: number;
      }>;
    },
  });

  // ── 30-day production trend (real daily AP + deals) ──────────────────
  const trend = useQuery({
    queryKey: ["agency-trend-30d"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("deals")
        .select("posted_at, created_at, annual_premium, status")
        .or(dealTruthWindowOr(since, new Date().toISOString()))
        .in("status", DEAL_TRUTH_STATUS_FILTER)
        .order("posted_at", { ascending: true });
      if (error) throw error;
      // Bucket into 30 days
      const map = new Map<string, { deals: number; ap: number }>();
      for (let i = 29; i >= 0; i--) {
        const k = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        map.set(k, { deals: 0, ap: 0 });
      }
      for (const d of (data ?? []) as Array<{ posted_at: string | null; created_at: string | null; annual_premium: number | string }>) {
        const ts = getDealTruthTimestamp(d);
        if (!ts) continue;
        const k = ts.slice(0, 10);
        const bucket = map.get(k);
        if (bucket) {
          bucket.deals += 1;
          bucket.ap += Number(d.annual_premium ?? 0);
        }
      }
      return Array.from(map.entries()).map(([day, v]) => ({ day, deals: v.deals, ap: v.ap }));
    },
  });

  // ── Tighter active-agent + licensed-hire counts + PLE pipeline ───────
  // PL-019: "producing" window dropped 30d → 10d so we flag stalls fast.
  // Sam: "we fire people a lot, so put it for one who has not produced a
  // deal inside the last ten days."
  const tight = useQuery({
    queryKey: ["agency-tight-counts", periodBounds.startIso, periodBounds.endIso],
    refetchInterval: 60_000,
    queryFn: async () => {
      const since10 = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const [dealAgents, prodAgents, licensedMtdRes, contractedMtdRes, inCourseRes, finishedRes, examScheduledRes] = await Promise.all([
        supabase.from("deals").select("agent_id").gte("posted_at", since10).in("status", DEAL_TRUTH_STATUS_FILTER),
        supabase.from("daily_production").select("agent_id").gte("production_date", since10.slice(0, 10)),
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("licensed_at", periodBounds.startIso).lte("licensed_at", periodBounds.endIso).is("terminated_at", null),
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("contracted_at", periodBounds.startIso).lte("contracted_at", periodBounds.endIso).is("terminated_at", null),
        // Pre-licensing education (PLE) pipeline — from license_progress
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("license_progress", "course_purchased").is("terminated_at", null),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("license_progress", "finished_course").is("terminated_at", null),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("license_progress", "test_scheduled").is("terminated_at", null),
      ]);
      const ids = new Set<string>();
      for (const r of (dealAgents.data ?? []) as Array<{ agent_id: string | null }>) {
        if (r.agent_id) ids.add(r.agent_id);
      }
      for (const r of (prodAgents.data ?? []) as Array<{ agent_id: string | null }>) {
        if (r.agent_id) ids.add(r.agent_id);
      }
      return {
        active30d: ids.size,
        licensedMtd: licensedMtdRes.count ?? 0,
        contractedMtd: contractedMtdRes.count ?? 0,
        pleInCourse: inCourseRes.count ?? 0,
        pleFinished: finishedRes.count ?? 0,
        pleExamScheduled: examScheduledRes.count ?? 0,
      };
    },
  });

  const c = ceo.data;
  const ap30 = Number(c?.ap_30d ?? 0);

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      {/* PL-018: Agency Command top widget redesign — Sam said the box
          was "bare" and hard to read. Boosted contrast, added gradient
          frame + scanline animation, bumped title size, swapped the
          green-on-green live indicator to amber-pulse for visibility. */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/[0.03] to-transparent p-5 sm:p-6 shadow-[0_0_60px_hsl(168_80%_50%/0.12)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <div className="absolute top-0 right-0 w-72 h-72 rounded-full bg-primary/[0.08] blur-3xl pointer-events-none" />
        <PageHeader
          eyebrow="Agency · Owner Mode"
          eyebrowIcon={<Crown className="h-3 w-3" />}
          title="Agency Command"
          subtitle={
            <>
              Live agency-wide production, pipeline, and team activity.
              {c?.as_of && <> · As of {format(new Date(c.as_of), "MMM d, h:mm a")}</>}
            </>
          }
          accent="primary"
          actions={
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-amber-500/15 text-amber-300 border-amber-400/50 font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 mr-1.5 animate-pulse" /> Live · 60s refresh
              </Badge>
              <Button asChild variant="outline" size="sm">
                <Link to="/dashboard/command">CEO panel <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
              </Button>
            </div>
          }
        />
      </div>

      <GlassCard className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Owner metric window</p>
            <p className="mt-1 text-sm text-muted-foreground">
              KPIs, top producers, licensed hires, and manager share are reading <span className="font-semibold text-foreground">{periodBounds.label}</span>.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="grid grid-cols-4 gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
              {AGENCY_PERIODS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={period === option.value ? "default" : "ghost"}
                  className="h-8 px-2 text-xs"
                  onClick={() => setPeriod(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {period === "custom" && (
              <div className="grid grid-cols-2 gap-2 sm:w-[17rem]">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-9 text-xs"
                  aria-label="Custom period start"
                />
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-9 text-xs"
                  aria-label="Custom period end"
                />
              </div>
            )}
          </div>
        </div>
      </GlassCard>

      {/* ── 4 KPI TILES (real verified numbers) ─────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          icon={DollarSign}
          label={`Agency AP · ${periodBounds.label}`}
          value={fmtUsd(periodDealsAllStatuses.data?.totalAp ?? periodSummary.totalAp)}
          subValue={`${fmtNum(periodDealsAllStatuses.data?.count ?? periodSummary.dealCount)} deals (${fmtNum(periodSummary.dealCount)} trusted) · prior period ${priorPeriodDeals.data == null ? "…" : fmtUsd(priorPeriodDeals.data, true)}`}
          trendPct={periodTrendPct}
          color="text-emerald-500 dark:text-emerald-400"
          loading={periodDeals.isLoading || priorPeriodDeals.isLoading || periodDealsAllStatuses.isLoading}
        />
        <KpiTile
          icon={Trophy}
          label={`Deals · ${periodBounds.label}`}
          value={fmtNum(periodSummary.dealCount)}
          subValue={`${fmtNum(periodSummary.producingAgents)} producing agents in selected window`}
          color="text-amber-500 dark:text-amber-400"
          loading={periodDeals.isLoading}
        />
        <KpiTile
          icon={Users}
          label={`Producers · ${periodBounds.label}`}
          value={fmtNum(periodSummary.producingAgents)}
          subValue={`${fmtNum(tight.data?.active30d ?? 0)} agents have any deal or production log in last 10d`}
          color="text-primary"
          loading={periodDeals.isLoading || tight.isLoading}
        />
        <KpiTile
          icon={ShieldCheck}
          label={`Licensed hires · ${periodBounds.label}`}
          value={fmtNum(tight.data?.licensedMtd ?? 0)}
          subValue={`${fmtNum(tight.data?.contractedMtd ?? 0)} contracted · ${fmtNum(tight.data?.pleInCourse ?? 0)} in pre-license course · ${fmtNum(tight.data?.pleExamScheduled ?? 0)} exam scheduled`}
          color="text-violet-500 dark:text-violet-400"
          loading={tight.isLoading}
        />
      </div>

      {/* ── 30d trend chart (real data) + Top producers leaderboard ── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <GlassCard className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">30-day agency production</p>
              <h3 className="text-lg font-bold">Daily AP across all agents</h3>
            </div>
            <Badge variant="outline" className="text-xs">{fmtUsd(ap30, true)} · last 30d</Badge>
          </div>
          {trend.isLoading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend.data}>
                <defs>
                  <linearGradient id="ceoApGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(168 70% 45%)" stopOpacity={0.65} />
                    <stop offset="100%" stopColor="hsl(168 70% 45%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" />
                <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d), "MMM d")} fontSize={10} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={10} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                  labelFormatter={(d) => format(new Date(d), "PPP")}
                  formatter={(v: number, name: string) => name === "ap" ? fmtUsd(v) : v}
                />
                <Area type="monotone" dataKey="ap" stroke="hsl(168 70% 45%)" fill="url(#ceoApGrad)" name="ap" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Top producers · {periodBounds.label}</p>
              <h3 className="text-lg font-bold">Leaderboard</h3>
            </div>
            <Crown className="h-5 w-5 text-amber-500 dark:text-amber-400" />
          </div>
          {periodDeals.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : periodSummary.producers.length === 0 ? (
            <EmptyState icon={<Trophy className="h-6 w-6" />} title={`No production in ${periodBounds.label.toLowerCase()}`} />
          ) : (
            <ul className="space-y-1.5">
              {periodSummary.producers.map((a, i) => (
                <li
                  key={a.agent_id}
                  className="flex items-center gap-3 rounded-lg border border-border/30 px-2.5 py-2 hover:border-primary/40 hover:bg-primary/[0.04] transition-colors"
                >
                  <span className={`h-6 w-6 rounded-md text-[11px] font-bold flex items-center justify-center shrink-0 ${
                    i === 0 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" :
                    i === 1 ? "bg-slate-400/15 text-slate-600 dark:text-slate-300" :
                    i === 2 ? "bg-orange-500/15 text-orange-600 dark:text-orange-400" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {i + 1}
                  </span>
                  {a.avatar_url ? (
                    <img src={a.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover ring-1 ring-border" />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center">
                      {(a.display_name ?? "?").split(" ").map(s => s[0]).slice(0, 2).join("")}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{a.display_name ?? "Unknown"}</p>
                    <p className="text-[11px] text-muted-foreground">{a.agent_code ?? "—"} · {fmtNum(a.deals)} deals</p>
                  </div>
                  <p className="text-sm font-bold tabular-nums text-emerald-500 dark:text-emerald-400 shrink-0">
                    {fmtUsd(a.ap, true)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="ghost" size="sm" className="w-full mt-3">
            <Link to="/dashboard/leaderboard">Full leaderboard <ArrowRight className="h-3 w-3 ml-1" /></Link>
          </Button>
        </GlassCard>
      </div>

      {/* ── Manager hierarchy production share (selected period) ─── */}
      {periodSummary.managers.length > 0 && (
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Manager production share · {periodBounds.label}</p>
              <h3 className="text-lg font-bold">
                Hierarchy breakdown
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {fmtUsd(periodSummary.totalAp, true)} total
                </span>
              </h3>
            </div>
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            {periodSummary.managers.map((m, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-28 text-sm font-medium truncate shrink-0">{m.name}</div>
                <div className="flex-1">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/70 transition-all"
                      style={{ width: `${Math.min(m.pct, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="text-right shrink-0 min-w-[4rem]">
                  <span className="text-sm font-bold tabular-nums text-emerald-500 dark:text-emerald-400">
                    {fmtUsd(m.ap, true)}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-1.5">{m.pct.toFixed(0)}%</span>
                </div>
                <div className="text-[10px] text-muted-foreground w-14 text-right tabular-nums shrink-0">
                  {fmtNum(m.deals)} deal{m.deals !== 1 ? "s" : ""}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* ── Pipeline funnel + period production stats ──────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Agency funnel</p>
              <h3 className="text-lg font-bold">Pipeline state</h3>
            </div>
            <Briefcase className="h-5 w-5 text-muted-foreground" />
          </div>
          <FunnelStrip
            steps={[
              { label: "Active applications", value: c?.total_applications ?? 0, color: "bg-violet-500" },
              { label: "Contracts signed · MTD", value: c?.paid_mtd ?? 0,        color: "bg-primary" },
              { label: "Apps this week",      value: c?.apps_wtd ?? 0,           color: "bg-amber-500" },
              { label: "Uncontacted >24h",    value: c?.uncontacted_24h ?? 0,    color: "bg-rose-500" },
              { label: "Stale 3 days+",       value: c?.stale_new_3d ?? 0,       color: "bg-orange-500" },
            ]}
          />
          <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {c?.unassigned_open ? `${c.unassigned_open} unassigned` : "All assigned"}
            </span>
            <Button asChild size="sm" variant="ghost">
              <Link to="/dashboard/applicants">Open <ChevronRight className="h-3 w-3 ml-0.5" /></Link>
            </Button>
          </div>
        </GlassCard>

        <GlassCard className="p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Pipeline stats · {periodBounds.label}</p>
              <h3 className="text-lg font-bold">Production and leakage snapshot</h3>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link to="/dashboard/admin/content-command">Content loop <ArrowRight className="h-3 w-3 ml-1" /></Link>
            </Button>
          </div>
          {periodDeals.isLoading ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <PipelineStat label="AP selected" value={fmtUsd(periodSummary.totalAp)} detail={`${fmtNum(periodSummary.dealCount)} trusted deals`} tone="success" />
              <PipelineStat label="Producers selected" value={fmtNum(periodSummary.producingAgents)} detail="Unique agents with trusted deals" />
              <PipelineStat label="Avg AP / deal" value={fmtUsd(periodSummary.dealCount ? periodSummary.totalAp / periodSummary.dealCount : 0, true)} detail="Selected period efficiency" />
              <PipelineStat label="Managers producing" value={fmtNum(periodSummary.managers.filter((m) => m.name !== "Direct to Sam / no manager").length)} detail={`${fmtNum(periodSummary.managers.length)} total buckets`} />
              <PipelineStat label="Direct to Sam / no manager" value={fmtUsd(periodSummary.managers.find((m) => m.name === "Direct to Sam / no manager")?.ap ?? 0, true)} detail={`${fmtNum(periodSummary.managers.find((m) => m.name === "Direct to Sam / no manager")?.deals ?? 0)} deals`} tone="warning" />
              <PipelineStat label="Uncontacted >24h" value={fmtNum(c?.uncontacted_24h ?? 0)} detail={`${fmtNum(c?.stale_new_3d ?? 0)} stale 3d+`} tone={(c?.uncontacted_24h ?? 0) > 0 ? "warning" : "default"} />
            </div>
          )}
        </GlassCard>
      </div>

      {/* ── Recent hires (last 14d) — PL-017 visibility fix ────────── */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Just hired · last 14 days</p>
            <h3 className="text-lg font-bold">
              Recent hires{recentHires.data ? ` (${recentHires.data.length})` : ""}
            </h3>
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link to="/dashboard/team-hierarchy">All agents <ArrowRight className="h-3 w-3 ml-1" /></Link>
          </Button>
        </div>
        {recentHires.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (recentHires.data ?? []).length === 0 ? (
          <EmptyState icon={<UserPlus className="h-6 w-6" />} title="No new hires in the last 14 days" description="When a new agent is onboarded they'll surface here even before their first deal." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(recentHires.data ?? []).map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{h.display_name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {h.agent_code ?? "—"}{h.manager_name ? ` · mgr ${h.manager_name}` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold text-primary tabular-nums">{h.days_on_team}d</p>
                  <p className="text-[10px] text-muted-foreground truncate max-w-[8rem]">{h.onboarding_stage ?? "—"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* ── System health + Referrals + Underperformers ─────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatRowCard
          icon={Activity}
          label="Chargebacks · 30d"
          value={fmtNum(c?.chargebacks_30d ?? 0)}
          color={(c?.chargebacks_30d ?? 0) > 0 ? "text-rose-500 dark:text-rose-400" : "text-emerald-500 dark:text-emerald-400"}
        />
        <StatRowCard
          icon={Activity}
          label="Lapses · 30d"
          value={fmtNum(c?.lapses_30d ?? 0)}
          color={(c?.lapses_30d ?? 0) > 10 ? "text-rose-500 dark:text-rose-400" : "text-amber-500 dark:text-amber-400"}
        />
        <StatRowCard
          icon={Users}
          label="Referrals · 30d"
          value={fmtNum(c?.ref_30d ?? 0)}
          color="text-primary"
        />
        <StatRowCard
          icon={Crown}
          label="Referrals · won"
          value={fmtNum(c?.ref_won ?? 0)}
          color="text-emerald-500 dark:text-emerald-400"
        />
      </div>

      {/* ── Quick admin actions ─────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <QuickAction icon={Users}      to="/dashboard/applicants"      label="Applicants" desc="Review + assign" />
        <QuickAction icon={Briefcase}  to="/dashboard/recruit-pipeline" label="Recruit pipeline" desc="Kanban board" />
        <QuickAction icon={Trophy}     to="/dashboard/leaderboard"     label="Leaderboard" desc="Top producers" />
        <QuickAction icon={Wallet}     to="/dashboard/charges-audit"   label="Charges audit" desc="Stripe anomalies" />
        <QuickAction icon={Sparkles}   to="/dashboard/conduct"         label="Conduct center" desc="Strikes + audit" />
      </div>
    </div>
  );
}

interface StatRowCardProps { icon: React.ElementType; label: string; value: string; color: string; onClick?: () => void; }
function PipelineStat({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "success" | "warning";
}) {
  const valueColor =
    tone === "success" ? "text-emerald-500 dark:text-emerald-400" :
    tone === "warning" ? "text-amber-500 dark:text-amber-400" :
    "text-foreground";
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{detail}</p>
    </div>
  );
}

function StatRowCard({ icon: Icon, label, value, color, onClick }: StatRowCardProps) {
  // PL-025: rows with drilldown handlers render as buttons so keyboard and
  // screen-reader users can open the modal too — not just mouse tappers.
  const inner = (
    <>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</p>
        <p className={`text-2xl font-bold tabular-nums mt-1 ${color}`}>{value}</p>
      </div>
      <Icon className={`h-6 w-6 ${color} opacity-70`} />
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-left w-full hover:scale-[1.01] transition-transform"
      >
        <GlassCard className="p-4 flex items-center justify-between cursor-pointer hover:border-primary/40">
          {inner}
        </GlassCard>
      </button>
    );
  }
  return (
    <GlassCard className="p-4 flex items-center justify-between">
      {inner}
    </GlassCard>
  );
}
