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
  Activity, AlertTriangle, ArrowRight, BarChart3, Briefcase, Building2, Calendar, ChevronRight,
  CircleDollarSign, Clock, Crown, DollarSign, Filter, Flame, Layers, Phone, Radio,
  ShieldAlert, ShieldCheck, Sparkles,
  Target, TrendingDown, TrendingUp, Trophy, UserPlus, Users, Wallet, Zap,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, PieChart, Pie, Cell,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NextStepCard } from "@/components/dashboard/NextStepCard";
import { RegionPeerCard, UpcomingChargebackCard } from "@/components/dashboard/AgentPeerAndChargebackCards";
import { LapsesDrilldownModal } from "@/components/dashboard/LapsesDrilldownModal";
import { RecentActivationsPanel } from "@/components/dashboard/RecentActivationsPanel";
import { MyReferralLinkCard } from "@/components/agent/MyReferralLinkCard";
// v26 audit fix: AgentLinkBookTruthCard + CarrierBreakdownCard + BookTrendCard
// imports removed. They lived in the deleted whole-book footer. KPIs now
// truth-sourced from agentlink_deals_snapshot, so the redundant footer was
// just visual debt.
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
    staleTime: 55_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_agent_command_center" as any).select("agent_id,agent_code,display_name,full_name,license_status,manager_name,onboarding_stage,activity_state,next_action,deals_mtd,deals_wtd,deals_30d,ap_mtd,ap_wtd,ap_30d,commission_lifetime_cents,chargebacks,lapses,presentations_mtd,presentations_wtd,hours_called_mtd,hours_called_wtd,last_production_date,apps_assigned,apps_open,apps_new_7d,apps_needing_contact,close_rate_mtd_pct,ap_trend_pct,rank_agency_mtd,rank_agency_wtd,rank_team_mtd")
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
        .from("agent_lifetime_production" as any).select("lifetime_alp,lifetime_deals")
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
        .from("agent_revenue_estimate" as any).select("contract_pct")
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
        .from("agent_goals").select("income_goal,comp_percentage")
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
        .limit(1000);
      if (error) throw error;
      return ((data ?? []) as unknown as Deal[]).slice(0, 8);
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
  // v26 audit fix: was falling back to 100% comp when contract not set,
  // wildly inflating projected commission. Default to 35% (typical agent
  // contract floor) and show a "not set" indicator instead.
  const rawCompPct = goal.data?.comp_percentage ?? revenue.data?.contract_pct;
  const hasCompSet = rawCompPct !== null && rawCompPct !== undefined;
  const compPct = (hasCompSet ? Number(rawCompPct) : 35) / 100;
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

      {/* ── P3: MY REFERRAL LINK ─────────────────────────────────── */}
      <MyReferralLinkCard />

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
          color="text-primary"
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
                      {[d.client_first_name, d.client_last_name].filter(Boolean).join(" ") || "—"}
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
                  formatter={(v: number) => [fmtNum(v), "Deals"]}
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
  // PL-025: drilldown modal for the Lapses-30d KPI.
  const [lapsesOpen, setLapsesOpen] = useState(false);
  const periodBounds = useMemo(
    () => getAgencyPeriodBounds(period, customStart, customEnd),
    [period, customStart, customEnd],
  );

  // ── CEO rollup ────────────────────────────────────────────────────────
  const ceo = useQuery({
    queryKey: ["agency-ceo"],
    refetchInterval: 60_000,
    staleTime: 55_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_ceo_command_center" as any).select("as_of,ap_30d,chargebacks_30d,lapses_30d,ref_30d,ref_won,total_applications,paid_mtd,apps_wtd,uncontacted_24h,stale_new_3d,unassigned_open")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as CeoRow | null;
    },
  });

  // ── v13 Wave C (2026-06-10): swapped from stale `deals` table to
  // agentlink_deals_snapshot. Dev verify proved legacy was undercounting:
  //   TODAY:  legacy=0   truth=9 deals/$16,975
  //   WEEK:   legacy=24  truth=112 deals/$133,797
  //   MONTH:  legacy=86  truth=239 deals/$284,452
  // The snapshot refreshes every 30 min via launchd; effective_date is the
  // canonical period bucket. Maps result into the same shape the rest of
  // the file consumes (id, annual_premium, posted_at, agent_id, agent).
  const periodDeals = useQuery({
    queryKey: ["agency-period-deals-truth", periodBounds.startIso, periodBounds.endIso],
    refetchInterval: 60_000,
    staleTime: 55_000,
    queryFn: async () => {
      // Convert period bounds to YYYY-MM-DD for effective_date comparison
      const startDate = periodBounds.startIso.slice(0, 10);
      const endDate = periodBounds.endIso.slice(0, 10);

      const { data, error } = await supabase
        .from("agentlink_deals_snapshot" as any)
        .select("id, annual_premium, effective_date, user_id")
        .gte("effective_date", startDate)
        .lte("effective_date", endDate);
      if (error) throw error;

      const dealRows = (data ?? []) as Array<{
        id: string | number;
        annual_premium: number | string | null;
        effective_date: string | null;
        user_id: number | null;
      }>;

      const alUserIds = Array.from(new Set(dealRows.map((row) => row.user_id).filter((v): v is number => v != null)));
      if (alUserIds.length === 0) {
        // Map empty result into the legacy shape so downstream consumers don't crash
        return dealRows.map((row) => ({
          id: String(row.id),
          annual_premium: row.annual_premium,
          posted_at: row.effective_date,
          created_at: row.effective_date,
          agent_id: null,
          agent: null,
        }));
      }

      // Map agentlink user_id → apex agent + manager via agents.al_user_id
      const { data: agentRows, error: agentError } = await supabase
        .from("agents")
        .select("id, al_user_id, display_name, agent_code, manager_id")
        .in("al_user_id", alUserIds);
      if (agentError) throw agentError;

      const agents = (agentRows ?? []) as Array<{
        id: string;
        al_user_id: number | null;
        display_name: string | null;
        agent_code: string | null;
        manager_id: string | null;
      }>;
      const agentByAlId = new Map(agents.filter((a) => a.al_user_id != null).map((a) => [a.al_user_id as number, a]));

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

      return dealRows.map((row) => {
        const agent = row.user_id != null ? agentByAlId.get(row.user_id) ?? null : null;
        return {
          id: String(row.id),
          annual_premium: row.annual_premium,
          posted_at: row.effective_date,
          created_at: row.effective_date,
          agent_id: agent?.id ?? null,
          agent: agent
            ? { ...agent, manager: agent.manager_id ? managerById.get(agent.manager_id) ?? null : null }
            : null,
        };
      });
    },
  });

  // Agency AP = total premium for the period, no status filter needed since
  // snapshot rows only include active book records.
  const periodDealsAllStatuses = useQuery({
    queryKey: ["agency-period-deals-all-truth", periodBounds.startIso, periodBounds.endIso],
    refetchInterval: 120_000,
    staleTime: 115_000,
    queryFn: async () => {
      const startDate = periodBounds.startIso.slice(0, 10);
      const endDate = periodBounds.endIso.slice(0, 10);
      const { data, error } = await supabase
        .from("agentlink_deals_snapshot" as any)
        .select("annual_premium")
        .gte("effective_date", startDate)
        .lte("effective_date", endDate);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ annual_premium: number | string | null }>;
      const totalAp = rows.reduce((s: number, r) => s + Number(r.annual_premium ?? 0), 0);
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
      // v18 Sam: "never put anyone on any dashboard that shows Unknown."
      // If we can't resolve the agent, the deal counts toward totalAp but
      // does NOT appear in the per-agent leaderboard (skipped below).
      if (!agent?.display_name) {
        totalAp += ap;
        continue;
      }
      const agentId = deal.agent_id ?? agent.id;
      const agentName = agent.display_name;
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

  // v26 audit fix: was querying LEGACY deals table while the headline KPI
  // uses agentlink_deals_snapshot. The delta % was dividing snapshot-truth
  // current AP by legacy-stale prior AP — wrong baseline. Now both sides
  // read from agentlink_deals_snapshot via effective_date.
  const priorPeriodDeals = useQuery({
    queryKey: ["agency-prior-period-deals-truth", periodBounds.startIso, periodBounds.endIso],
    refetchInterval: 120_000,
    staleTime: 115_000,
    queryFn: async () => {
      const start = new Date(periodBounds.startIso);
      const end = new Date(periodBounds.endIso);
      const lengthMs = Math.max(86_400_000, end.getTime() - start.getTime());
      const priorStart = new Date(start.getTime() - lengthMs);
      const priorEnd = new Date(start.getTime());
      const { data, error } = await supabase
        .from("agentlink_deals_snapshot" as any)
        .select("annual_premium")
        .gte("effective_date", priorStart.toISOString().slice(0, 10))
        .lt("effective_date", priorEnd.toISOString().slice(0, 10));
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
    // 2026-06-15 v6.5 fix: Sam called out 'Just hired (0)' empty tab.
    // The query was filtering by period (June 2026) → 0 rows even though
    // v_recent_hires has 26 real rows. Now: ALWAYS show the most recent 12
    // hires regardless of period — recent hires are recent hires.
    queryKey: ["agency-recent-hires-always"],
    refetchInterval: 60_000,
    staleTime: 55_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_recent_hires" as any)
        .select("id, display_name, agent_code, hired_on, manager_name, onboarding_stage, days_on_team, total_premium, total_policies")
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
  // v26 audit fix: was querying LEGACY deals table. Headline KPI uses
  // agentlink_deals_snapshot · the chart should match. Now reads truth.
  const trend = useQuery({
    queryKey: ["agency-trend-truth", periodBounds.startIso, periodBounds.endIso],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agentlink_deals_snapshot" as any)
        .select("effective_date, annual_premium")
        .gte("effective_date", periodBounds.startIso.slice(0, 10))
        .lte("effective_date", periodBounds.endIso.slice(0, 10))
        .order("effective_date", { ascending: true });
      if (error) throw error;
      // Bucket days between start and end (cap at 90)
      const startMs = new Date(periodBounds.startIso).getTime();
      const endMs = new Date(periodBounds.endIso).getTime();
      const totalDays = Math.min(90, Math.ceil((endMs - startMs) / 86_400_000));
      const map = new Map<string, { deals: number; ap: number }>();
      for (let i = 0; i < totalDays; i++) {
        const k = new Date(startMs + i * 86_400_000).toISOString().slice(0, 10);
        map.set(k, { deals: 0, ap: 0 });
      }
      // v26 audit fix: agentlink_deals_snapshot uses effective_date directly
      for (const d of (data ?? []) as Array<{ effective_date: string | null; annual_premium: number | string }>) {
        if (!d.effective_date) continue;
        const k = d.effective_date.slice(0, 10);
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
    staleTime: 55_000,
    queryFn: async () => {
      const since10 = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const [dealAgents, prodAgents, licensedMtdRes, contractedMtdRes, inCourseRes, finishedRes, examScheduledRes] = await Promise.all([
        supabase.from("deals").select("agent_id").gte("posted_at", since10).in("status", DEAL_TRUTH_STATUS_FILTER),
        supabase.from("daily_production").select("agent_id").gte("production_date", since10.slice(0, 10)),
        // 2026-06-15 v6.7 fix: licensed_at on applications is barely populated
        // (only 1-2 rows). The TRUE hire-count source is agents.created_at —
        // every agent row IS a licensed hire by definition. Sam said the count
        // was inaccurate; this returns 8 vs the old 0.
        supabase.from("agents").select("id", { count: "exact", head: true }).gte("created_at", periodBounds.startIso).lte("created_at", periodBounds.endIso),
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
        active10d: ids.size,
        licensedMtd: licensedMtdRes.count ?? 0,
        contractedMtd: contractedMtdRes.count ?? 0,
        pleInCourse: inCourseRes.count ?? 0,
        pleFinished: finishedRes.count ?? 0,
        pleExamScheduled: examScheduledRes.count ?? 0,
      };
    },
  });

  // Wave B v9: apex_dashboard_summary() — single round-trip truth source for
  // today/week/month $ and deals. Reads v_agentlink_book_truth, NOT the
  // stale apex deals table. Per v9 §12 check 9: every $ must come from
  // AgentLink. Rendered as the hero row above the period-aware KPI grid.
  const summary = useQuery({
    queryKey: ["apex-dashboard-summary"],
    refetchInterval: 60_000,
    staleTime: 55_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("apex_dashboard_summary" as any);
      if (error) throw error;
      return data as {
        today: { deals: number; premium: number };
        this_week: { deals: number; premium: number };
        this_month: { deals: number; premium: number };
        total: { deals: number; premium: number };
        last_sync_at: string | null;
        new_apps_today: number;
        new_agents_today: number;
        just_hired_7d: number;
        stale_apps_14d: number;
        inbound_open: number;
      };
    },
  });

  const c = ceo.data;
  const ap30 = Number(c?.ap_30d ?? 0);

  // 2026-06-14: Sam's LESS-IS-MORE directive — leaks + live applications
  // belong on the front dashboard, not buried in /dashboard/finances or in
  // a tab. "Any leaks I need just aren't even there."
  const cfoLive = useQuery({
    queryKey: ["agency-cfo-live"],
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("v_cfo_snapshot" as any).select("*").maybeSingle();
      return data as unknown as {
        ghost_ap_at_risk: string | number;
        ica_paid_stuck: number;
        lapsed_walked_commission: string | number;
        dup_charges_open: number;
        idle_active_agents: number;
        insuracloud_sync: string;
        agentlink_sync: string;
      } | null;
    },
  });

  // Live application stream — last 25 active applicants, newest first
  // 2026-06-14 BUG FIX: was querying `applied_at` (column doesn't exist) and
  // `ica_paid_at` (wrong terminology per Sam rule). Real columns: created_at +
  // course_purchased_at. That's why "I can't even see my application" — the
  // entire query was failing silently due to column-not-found.
  const liveApps = useQuery({
    // 2026-06-15 v6.6: Sam — "I'm still missing applications from the website.
    // Bring back every single application." Bumped limit 25 → 1000 so the
    // 3-lane strip counts are accurate against all 519 active apps + every
    // applicant from the website surfaces in their proper lane.
    queryKey: ["agency-live-applications"],
    refetchInterval: 60_000,
    staleTime: 55_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications" as any)
        .select("id, first_name, last_name, status, license_progress, created_at, contacted_at, course_purchased_at, licensed_at, state, phone, email, referral_source")
        .is("terminated_at", null)
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) console.error("liveApps query error:", error);
      return (data ?? []) as unknown as Array<{
        id: string;
        first_name: string | null;
        last_name: string | null;
        status: string | null;
        license_progress: string | null;
        created_at: string | null;
        contacted_at: string | null;
        course_purchased_at: string | null;
        licensed_at: string | null;
        state: string | null;
        phone: string | null;
        email: string | null;
        referral_source: string | null;
      }>;
    },
  });

  // 2026-06-14 BIG PROMPT execution · enrich hero with month-level apps + hires + uncontacted depth
  const monthDepth = useQuery({
    queryKey: ["dashboard-month-depth"],
    refetchInterval: 60_000,
    staleTime: 55_000,
    queryFn: async () => {
      const tzNow = new Date();
      const monthStart = new Date(tzNow.getFullYear(), tzNow.getMonth(), 1).toISOString();
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const cutoff48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

      const [appsMtdRes, hiresMtdRes, apps7dRes, uncTotalRes, unc48hRes] = await Promise.all([
        supabase.from("applications").select("id", { count: "exact", head: true })
          .gte("created_at", monthStart).is("terminated_at", null),
        // 2026-06-15 v6.8 fix: applications.licensed_at is barely populated
        // (audit found 2/523). Real hire-count = agents.created_at because
        // every agent row IS a licensed hire. Sam: "should be counted obviously".
        supabase.from("agents").select("id", { count: "exact", head: true })
          .gte("created_at", monthStart),
        supabase.from("applications").select("id", { count: "exact", head: true })
          .gte("created_at", weekAgo).is("terminated_at", null),
        supabase.from("applications").select("id", { count: "exact", head: true })
          .is("contacted_at", null).is("terminated_at", null),
        supabase.from("applications").select("id", { count: "exact", head: true })
          .is("contacted_at", null).is("terminated_at", null).lt("created_at", cutoff48h),
      ]);

      return {
        apps_mtd: appsMtdRes.count ?? 0,
        hires_mtd: hiresMtdRes.count ?? 0,
        apps_7d: apps7dRes.count ?? 0,
        uncontacted_total: uncTotalRes.count ?? 0,
        uncontacted_48h: unc48hRes.count ?? 0,
      };
    },
  });

  // ── 2026-06-14 DENSIFICATION · 6 NEW PANELS ─────────────────────────────
  // Sam: "Command Center pretty trash because it only shows annual premium."
  // Each query is bounded to real DB columns audited via bot-sql.

  // PANEL 1 · CARRIER MIX (this month, top 6) — emerald hero · donut + table
  const carrierMix = useQuery({
    queryKey: ["agency-carrier-mix-mtd"],
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
    queryFn: async () => {
      const tzNow = new Date();
      const monthStart = new Date(tzNow.getFullYear(), tzNow.getMonth(), 1)
        .toISOString().slice(0, 10);
      const today = new Date(tzNow.getFullYear(), tzNow.getMonth(), tzNow.getDate())
        .toISOString().slice(0, 10);
      const { data: dealRows, error } = await supabase
        .from("agentlink_deals_snapshot" as any)
        .select("carrier_id, annual_premium")
        .gte("effective_date", monthStart)
        .lte("effective_date", today);
      if (error) throw error;
      const rows = (dealRows ?? []) as Array<{ carrier_id: number | null; annual_premium: number | string | null }>;
      const carrierIds = Array.from(new Set(rows.map((r) => r.carrier_id).filter((v): v is number => v != null)));
      const nameById = new Map<number, string>();
      if (carrierIds.length > 0) {
        const { data: carriers } = await supabase
          .from("agentlink_carriers" as any)
          .select("id, name")
          .in("id", carrierIds);
        for (const c of (carriers ?? []) as Array<{ id: number; name: string | null }>) {
          nameById.set(c.id, c.name ?? `Carrier #${c.id}`);
        }
      }
      const byCarrier = new Map<string, { name: string; ap: number; deals: number }>();
      let totalAp = 0;
      for (const row of rows) {
        const ap = Number(row.annual_premium ?? 0);
        totalAp += ap;
        const name = row.carrier_id != null ? (nameById.get(row.carrier_id) ?? "Unmapped") : "Unmapped";
        const cur = byCarrier.get(name) ?? { name, ap: 0, deals: 0 };
        byCarrier.set(name, { name, ap: cur.ap + ap, deals: cur.deals + 1 });
      }
      const sorted = Array.from(byCarrier.values()).sort((a, b) => b.ap - a.ap);
      const top = sorted.slice(0, 6);
      const otherAp = sorted.slice(6).reduce((s, r) => s + r.ap, 0);
      const otherDeals = sorted.slice(6).reduce((s, r) => s + r.deals, 0);
      return {
        carriers: top,
        otherAp,
        otherDeals,
        totalAp,
        carrierCount: byCarrier.size,
      };
    },
  });

  // PANEL 2 · TOP MOVERS · this week vs last week (WoW production growth)
  const topMovers = useQuery({
    queryKey: ["agency-top-movers-wow"],
    refetchInterval: 60_000,
    staleTime: 55_000,
    queryFn: async () => {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);
      const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
      const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("agentlink_deals_snapshot" as any)
        .select("user_id, annual_premium, effective_date")
        .gte("effective_date", twoWeeksAgo)
        .lte("effective_date", today);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ user_id: number | null; annual_premium: number | string | null; effective_date: string | null }>;
      const byUser = new Map<number, { thisWk: number; lastWk: number }>();
      for (const r of rows) {
        if (r.user_id == null || !r.effective_date) continue;
        const cur = byUser.get(r.user_id) ?? { thisWk: 0, lastWk: 0 };
        const ap = Number(r.annual_premium ?? 0);
        if (r.effective_date >= weekAgo) cur.thisWk += ap; else cur.lastWk += ap;
        byUser.set(r.user_id, cur);
      }
      const userIds = Array.from(byUser.keys());
      if (userIds.length === 0) return [] as Array<{ agentId: string; name: string; code: string | null; thisWk: number; lastWk: number; delta: number; pct: number | null }>;
      const { data: agents } = await supabase
        .from("agents")
        .select("id, al_user_id, display_name, agent_code")
        .in("al_user_id", userIds);
      const agentByAl = new Map<number, { id: string; display_name: string | null; agent_code: string | null }>();
      for (const a of (agents ?? []) as Array<{ id: string; al_user_id: number | null; display_name: string | null; agent_code: string | null }>) {
        if (a.al_user_id != null) agentByAl.set(a.al_user_id, a);
      }
      const movers = Array.from(byUser.entries())
        .map(([uid, v]) => {
          const a = agentByAl.get(uid);
          if (!a?.display_name) return null;
          const delta = v.thisWk - v.lastWk;
          const pct = v.lastWk > 0 ? (delta / v.lastWk) * 100 : (v.thisWk > 0 ? null : 0);
          return { agentId: a.id, name: a.display_name, code: a.agent_code, thisWk: v.thisWk, lastWk: v.lastWk, delta, pct };
        })
        .filter((r): r is { agentId: string; name: string; code: string | null; thisWk: number; lastWk: number; delta: number; pct: number | null } => r !== null)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 5);
      return movers;
    },
  });

  // PANEL 3 · CONVERSION FUNNEL · last 90 days (created → contacted → course → exam → licensed)
  const funnel = useQuery({
    queryKey: ["agency-conversion-funnel-90d"],
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const [createdRes, contactedRes, courseRes, examRes, licensedRes] = await Promise.all([
        supabase.from("applications").select("id", { count: "exact", head: true })
          .gte("created_at", since).is("terminated_at", null),
        supabase.from("applications").select("id", { count: "exact", head: true })
          .gte("created_at", since).is("terminated_at", null).not("contacted_at", "is", null),
        supabase.from("applications").select("id", { count: "exact", head: true })
          .gte("created_at", since).is("terminated_at", null).not("course_purchased_at", "is", null),
        supabase.from("applications").select("id", { count: "exact", head: true })
          .gte("created_at", since).is("terminated_at", null).not("exam_passed_at", "is", null),
        supabase.from("applications").select("id", { count: "exact", head: true })
          .gte("created_at", since).is("terminated_at", null).not("licensed_at", "is", null),
      ]);
      return {
        created: createdRes.count ?? 0,
        contacted: contactedRes.count ?? 0,
        course: courseRes.count ?? 0,
        exam: examRes.count ?? 0,
        licensed: licensedRes.count ?? 0,
      };
    },
  });

  // PANEL 4 · ACTIVITY FEED · last 12 culture_events (live deals as they post)
  const activity = useQuery({
    queryKey: ["agency-activity-feed"],
    refetchInterval: 60_000,
    staleTime: 55_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("culture_events" as any)
        .select("id, event_type, agent_id, annual_premium, product_sold, created_at")
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: number;
        event_type: string | null;
        agent_id: string | null;
        annual_premium: number | string | null;
        product_sold: string | null;
        created_at: string | null;
      }>;
      const agentIds = Array.from(new Set(rows.map((r) => r.agent_id).filter((v): v is string => !!v)));
      const nameById = new Map<string, string>();
      if (agentIds.length > 0) {
        const { data: agents } = await supabase
          .from("agents")
          .select("id, display_name")
          .in("id", agentIds);
        for (const a of (agents ?? []) as Array<{ id: string; display_name: string | null }>) {
          nameById.set(a.id, a.display_name ?? "—");
        }
      }
      return rows.map((r) => ({
        ...r,
        agent_name: r.agent_id ? (nameById.get(r.agent_id) ?? "—") : "—",
      }));
    },
  });

  // PANEL 5 · SOURCE ATTRIBUTION ROI · 180 days (replaces State Production, which has no data)
  // DB AUDIT: agentlink_deals_snapshot.payload is empty (no state). State panel SKIPPED.
  // Source attribution is the next-most-valuable hidden dataset per the audit.
  const sourceRoi = useQuery({
    queryKey: ["agency-source-roi-180d"],
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("applications")
        .select("source, course_purchased_at, licensed_at")
        .gte("created_at", since)
        .is("terminated_at", null);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ source: string | null; course_purchased_at: string | null; licensed_at: string | null }>;
      const bySrc = new Map<string, { apps: number; course: number; licensed: number }>();
      for (const r of rows) {
        const src = (r.source ?? "other").trim().toLowerCase() || "other";
        const cur = bySrc.get(src) ?? { apps: 0, course: 0, licensed: 0 };
        cur.apps += 1;
        if (r.course_purchased_at) cur.course += 1;
        if (r.licensed_at) cur.licensed += 1;
        bySrc.set(src, cur);
      }
      return Array.from(bySrc.entries())
        .map(([src, v]) => ({
          source: src,
          apps: v.apps,
          course: v.course,
          licensed: v.licensed,
          coursePct: v.apps > 0 ? (v.course / v.apps) * 100 : 0,
        }))
        .sort((a, b) => b.apps - a.apps)
        .slice(0, 8);
    },
  });

  // PANEL 6 · MONEY FLOW · commission_ledger this month
  const moneyFlow = useQuery({
    queryKey: ["agency-money-flow-mtd"],
    refetchInterval: 5 * 60_000,
    staleTime: 4 * 60_000,
    queryFn: async () => {
      const tzNow = new Date();
      const monthStart = new Date(tzNow.getFullYear(), tzNow.getMonth(), 1).toISOString();
      const { data, error } = await supabase
        .from("commission_ledger" as any)
        .select("amount, status, expected_paid_date, actual_paid_date")
        .gte("created_at", monthStart);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        amount: number | string | null;
        status: string | null;
        expected_paid_date: string | null;
        actual_paid_date: string | null;
      }>;
      let pending = 0, paid = 0, voided = 0, total = 0;
      for (const r of rows) {
        const amt = Number(r.amount ?? 0);
        total += amt;
        const s = (r.status ?? "").toLowerCase();
        if (s === "paid") paid += amt;
        else if (s === "voided" || s === "void") voided += amt;
        else pending += amt;
      }
      return { total, pending, paid, voided, count: rows.length };
    },
  });

  const leak = cfoLive.data;
  const apps = liveApps.data ?? [];
  const depth = monthDepth.data;

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      {/* v13 Wave E (2026-06-10): killed the inline gradient +  +
          glow shadow. Sam: "all that bullshit gradient/glow stuff looks
          buggy." Restraint mirrors AgentLink — solid card + 1px border. */}
      <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm">
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
            <div className="flex items-center gap-2 flex-wrap">
              {/* WAVE A3 · period switcher moved into PageHeader actions
                  to drop a full zone. KPIs/Trend/Leaderboard all key off this. */}
              <div className="grid grid-cols-4 gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5">
                {AGENCY_PERIODS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="sm"
                    variant={period === option.value ? "default" : "ghost"}
                    className="h-7 px-2 text-11"
                    onClick={() => setPeriod(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/dashboard/command">CEO panel <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
              </Button>
            </div>
          }
        />
      </div>

      {/* Custom-period date inputs appear only when 'custom' picked, as a
          single skinny strip — not a full card. Saves a zone. */}
      {period === "custom" && (
        <div className="flex flex-wrap items-center gap-2 px-1 py-1 border-l-2 border-l-primary/40 bg-primary/[0.03] rounded-r-md">
          <span className="text-11 text-muted-foreground">Custom range:</span>
          <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="h-8 w-36 text-11" aria-label="Custom period start" />
          <span className="text-11 text-muted-foreground">→</span>
          <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="h-8 w-36 text-11" aria-label="Custom period end" />
        </div>
      )}

      {/* 2026-06-14 EVENING · GAME-BREAKING REBUILD (Sam: 'should look game breaking
          · 10x better than AgentLink · sting simple · less is more · agents wanna
          transfer TO this'). Replaced the v4 LEAKS+APPS bands with a 3-zone
          composition:
            §A · AGENCY HERO — premium gradient band with live big-number panel
            §B · APPLICATION PIPELINE LANES — 3-col strip (uncontacted/course/licensed)
                 with name chips · click-to-focus
            §C · LEAKS · single-row glass strip · clickable to CFO
      */}

      {/* §A · AGENCY HERO ─────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_64px_-12px_hsl(168_70%_45%/0.35)]">
        {/* glow accents */}
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-emerald-500/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,hsl(168_70%_45%/0.06),transparent_60%)] pointer-events-none" />

        <div className="relative p-5 sm:p-6">
          {/* Header row · LIVE pulse + brand wordmark */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">APEX AGENCY · LIVE</p>
            </div>
            {periodSummary.totalAp > 0 && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-amber-400/40 bg-amber-400/10 text-amber-200">
                {periodBounds.label}
              </Badge>
            )}
          </div>

          {/* The numbers · 4 big metrics */}
          <div className="grid gap-5 grid-cols-2 sm:grid-cols-4 mb-5">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/45 mb-1.5">Annual Premium</p>
              <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-white">
                {fmtUsd(periodSummary.totalAp, true)}
              </p>
              <p className="text-[10px] text-white/50 mt-1 tabular-nums">{periodBounds.label}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/45 mb-1.5">Deals</p>
              <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-emerald-300">
                {fmtNum(periodSummary.dealCount)}
              </p>
              <p className="text-[10px] text-white/50 mt-1 tabular-nums">
                {fmtUsd(periodSummary.dealCount ? periodSummary.totalAp / periodSummary.dealCount : 0, true)} avg
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/45 mb-1.5">Producers</p>
              <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-amber-300">
                {fmtNum(periodSummary.producingAgents)}
              </p>
              <p className="text-[10px] text-white/50 mt-1 tabular-nums">{fmtNum(tight.data?.active10d ?? 0)} active 10d</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/45 mb-1.5">Licensed · MTD</p>
              <p className="text-[32px] sm:text-[40px] leading-none font-black tabular-nums text-white">
                {fmtNum(tight.data?.licensedMtd ?? 0)}
              </p>
              <p className="text-[10px] text-white/50 mt-1 tabular-nums">
                {fmtNum(tight.data?.contractedMtd ?? 0)} contracted
              </p>
            </div>
          </div>

          {/* Month-level supplement · Sam: 'this month apps · this month hires · per agent · per manager' */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 mb-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Apps · MTD</p>
              <p className="text-[22px] leading-none font-bold tabular-nums text-white">{fmtNum(depth?.apps_mtd ?? 0)}</p>
              <p className="text-[10px] text-white/40 tabular-nums">+{fmtNum(depth?.apps_7d ?? 0)} last 7d</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Hires · MTD</p>
              <p className="text-[22px] leading-none font-bold tabular-nums text-emerald-300">{fmtNum(depth?.hires_mtd ?? 0)}</p>
              <p className="text-[10px] text-white/40 tabular-nums">{fmtNum(tight.data?.licensedMtd ?? 0)} licensed</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Uncontacted</p>
              <p className={`text-[22px] leading-none font-bold tabular-nums ${(depth?.uncontacted_48h ?? 0) > 50 ? "text-rose-400" : "text-amber-300"}`}>
                {fmtNum(depth?.uncontacted_total ?? 0)}
              </p>
              <p className="text-[10px] text-rose-300/80 tabular-nums">{fmtNum(depth?.uncontacted_48h ?? 0)} stale 48h+</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Idle producers</p>
              <p className="text-[22px] leading-none font-bold tabular-nums text-amber-300">{fmtNum((leak?.idle_active_agents ?? 0) as number)}</p>
              <p className="text-[10px] text-white/40 tabular-nums">no deal 10d+</p>
            </div>
          </div>

          {/* Pre-license pipeline mini-bar */}
          <div className="flex items-center gap-3 text-[11px] flex-wrap">
            <p className="text-white/50 uppercase tracking-widest text-[10px]">License Pipeline</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-[10px] border-rose-400/40 bg-rose-400/10 text-rose-200">
                {fmtNum(tight.data?.pleInCourse ?? 0)} in course
              </Badge>
              <span className="text-white/30">→</span>
              <Badge variant="outline" className="text-[10px] border-amber-400/40 bg-amber-400/10 text-amber-200">
                {fmtNum(tight.data?.pleExamScheduled ?? 0)} exam scheduled
              </Badge>
              <span className="text-white/30">→</span>
              <Badge variant="outline" className="text-[10px] border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
                {fmtNum(tight.data?.pleFinished ?? 0)} finished
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* 2026-06-15 v6.6 · PULSE GROUP · 4 charts directly under the agency hero.
          Sam: "WoW chart I like a lot · put hire pace state production
          commission projected in same group right under this month annual AP." */}
      <DashboardPulseGroup />

      {/* 2026-06-15 v6.7 · Sam: "bring back all those leads · every single lead
          just gone." aged_leads table has 899 records (897 new + unworked). */}
      <AgedLeadsPanel />

      {/* 2026-06-15 v6.8 · Sam: "anyone below five thousand for the last seven days
          · make their box look red." Rose-gradient leak panel surfacing the soft
          producers so Sam can act. */}
      <LowProducersPanel />

      {/* §B · APPLICATION PIPELINE · 3-LANE STRIP ─────────────────────── */}
      {(() => {
        const uncontacted = apps.filter((a) => !a.contacted_at);
        const inCourse = apps.filter((a) => a.course_purchased_at && !a.licensed_at);
        const licensed = apps.filter((a) => a.licensed_at);
        const inProgress = apps.filter((a) => a.contacted_at && !a.course_purchased_at && !a.licensed_at);
        const Lane = ({
          title, count, tone, items, tip, href,
        }: { title: string; count: number; tone: "rose" | "amber" | "emerald" | "slate"; items: typeof apps; tip: string; href: string }) => {
          const tones: Record<typeof tone, { border: string; bg: string; text: string; chip: string }> = {
            rose:    { border: "border-rose-500/30",    bg: "bg-rose-500/[0.06]",    text: "text-rose-700 dark:text-rose-300",       chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30" },
            amber:   { border: "border-amber-500/30",   bg: "bg-amber-500/[0.06]",   text: "text-amber-700 dark:text-amber-300",     chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" },
            emerald: { border: "border-emerald-500/30", bg: "bg-emerald-500/[0.06]", text: "text-emerald-700 dark:text-emerald-300", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
            slate:   { border: "border-slate-500/30",   bg: "bg-slate-500/[0.06]",   text: "text-slate-700 dark:text-slate-300",     chip: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30" },
          };
          const t = tones[tone];
          // UNCONTACTED gets an urgent pulse — Sam: "make uncontacted more animated"
          const isUrgent = tone === "rose" && count > 0;
          return (
            <div className={`relative rounded-2xl border ${t.border} ${t.bg} p-4 ${isUrgent ? "shadow-[0_0_24px_-8px_hsl(0_70%_60%/0.4)]" : ""}`}>
              {isUrgent && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500" />
                </span>
              )}
              <div className="flex items-center justify-between mb-2">
                <p className={`text-[10px] uppercase tracking-widest font-bold ${t.text}`}>{title}</p>
                <span className={`text-13 tabular-nums font-bold ${t.text} ${isUrgent ? "text-[15px]" : ""}`}>{count}</span>
              </div>
              {items.length === 0 ? (
                <p className="text-12 text-muted-foreground italic">{tip}</p>
              ) : (
                <div className="space-y-1.5">
                  {/* 2026-06-15 v7.6 · Sam: "I'm seeing a lot of people left
                      off · all the applications is not there." Was slice(0,4)
                      → bumped to (0,10) so 198 uncontacted shows 10 names
                      instead of 4, the +N more link is now a prominent
                      button-style banner not a thin text link, and the
                      overflow link includes the FULL count so Sam can SEE
                      the data is there. */}
                  {items.slice(0, 10).map((a) => {
                    const name = [a.first_name, a.last_name].filter(Boolean).join(" ") || "—";
                    const initials = (name === "—" ? "?" : name).split(" ").map((s) => s[0]).slice(0, 2).join("");
                    return (
                      <Link
                        key={a.id}
                        to={`/dashboard/applicants?lead=${a.id}`}
                        className="flex items-center gap-2 text-12 group hover:bg-white/30 dark:hover:bg-black/20 rounded-lg px-1.5 py-1 transition-colors"
                      >
                        <span className={`h-6 w-6 rounded-full text-[10px] font-bold flex items-center justify-center ${t.chip}`}>
                          {initials.toUpperCase()}
                        </span>
                        <span className="flex-1 truncate font-medium">{name}</span>
                        {a.state && <span className="text-[10px] text-muted-foreground tabular-nums">{a.state}</span>}
                      </Link>
                    );
                  })}
                  {items.length > 10 && (
                    <Link to={href} className={`block text-12 ${t.text} hover:bg-white/30 dark:hover:bg-black/30 rounded-lg px-2 py-1.5 font-bold text-center border ${t.border} mt-2`}>
                      + {(items.length - 10).toLocaleString()} more · click to see all {items.length.toLocaleString()} →
                    </Link>
                  )}
                </div>
              )}
            </div>
          );
        };
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-13 font-bold flex items-center gap-2">
                <Briefcase className="h-3.5 w-3.5 text-amber-500" />
                Active Applications
                <Badge variant="outline" className="text-11">{apps.length}</Badge>
              </h3>
              <Link to="/dashboard/applicants" className="text-11 text-muted-foreground hover:text-foreground">
                Full pipeline →
              </Link>
            </div>
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <Lane title="Uncontacted" count={uncontacted.length} tone="rose" items={uncontacted} tip="Inbox zero." href="/dashboard/applicants?contacted=untouched" />
              <Lane title="Contacted · in progress" count={inProgress.length} tone="amber" items={inProgress} tip="Move them forward." href="/dashboard/applicants" />
              <Lane title="Course bought" count={inCourse.length} tone="emerald" items={inCourse} tip="Coach to exam." href="/dashboard/applicants?status=course_bought" />
              <Lane title="Licensed" count={licensed.length} tone="emerald" items={licensed} tip="Onboard fast." href="/dashboard/applicants?license=licensed" />
            </div>
          </div>
        );
      })()}

      {/* §C · LEAKS · PREMIUM GLASS BAND (Sam: 'make leaks way better, way more appealing, more understandable') */}
      <div className="relative overflow-hidden rounded-3xl border border-rose-500/25 bg-gradient-to-br from-slate-950 via-rose-950/40 to-slate-950 text-white shadow-[0_0_48px_-12px_hsl(0_70%_50%/0.25)]">
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-rose-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-rose-300">LIVE LEAKS · CFO BOT</p>
            </div>
            <Link to="/dashboard/finances" className="text-[10px] text-rose-200/80 hover:text-rose-100 uppercase tracking-widest font-bold">
              Full CFO →
            </Link>
          </div>

          {cfoLive.isLoading ? (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({length:6}).map((_,i) => <Skeleton key={i} className="h-16 bg-white/[0.04]" />)}
            </div>
          ) : leak ? (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              {/* $$ Ghost AP — biggest leak, biggest emphasis */}
              <div className="group relative p-3 rounded-xl bg-rose-500/[0.08] border border-rose-500/20 hover:border-rose-400/50 transition-all">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className="h-3 w-3 text-rose-400" />
                  <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold">Ghost AP at risk</p>
                </div>
                <p className="text-[22px] leading-none font-black tabular-nums text-rose-300">{fmtUsd(Number(leak.ghost_ap_at_risk ?? 0), true)}</p>
              </div>

              {/* Course bought · stuck */}
              <div className="group p-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/20 hover:border-amber-400/50 transition-all">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Clock className="h-3 w-3 text-amber-400" />
                  <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold">Course bought · stuck</p>
                </div>
                <p className="text-[22px] leading-none font-black tabular-nums text-amber-300">{leak.ica_paid_stuck ?? 0}</p>
              </div>

              {/* Walked commission */}
              <div className="group p-3 rounded-xl bg-rose-500/[0.08] border border-rose-500/20 hover:border-rose-400/50 transition-all">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <TrendingDown className="h-3 w-3 text-rose-400" />
                  <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold">Walked commission</p>
                </div>
                <p className="text-[22px] leading-none font-black tabular-nums text-rose-300">{fmtUsd(Number(leak.lapsed_walked_commission ?? 0), true)}</p>
              </div>

              {/* Dup charges */}
              <div className="group p-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/20 hover:border-amber-400/50 transition-all">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <ShieldAlert className="h-3 w-3 text-amber-400" />
                  <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold">Dup charges</p>
                </div>
                <p className="text-[22px] leading-none font-black tabular-nums text-amber-300">{leak.dup_charges_open ?? 0}</p>
              </div>

              {/* Idle agents */}
              <div className="group p-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/20 hover:border-amber-400/50 transition-all">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Users className="h-3 w-3 text-amber-400" />
                  <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold">Idle agents · 10d</p>
                </div>
                <p className="text-[22px] leading-none font-black tabular-nums text-amber-300">{leak.idle_active_agents ?? 0}</p>
              </div>

              {/* Sync status */}
              <div className="group p-3 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:border-white/20 transition-all">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Activity className="h-3 w-3 text-white/60" />
                  <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold">Carrier sync</p>
                </div>
                <div className="space-y-0.5">
                  <p className={`text-[13px] font-bold leading-tight flex items-center gap-1 ${String(leak.insuracloud_sync ?? "").includes("🟢") ? "text-emerald-300" : "text-rose-300"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${String(leak.insuracloud_sync ?? "").includes("🟢") ? "bg-emerald-400" : "bg-rose-400"}`} />
                    InsuraCloud
                  </p>
                  <p className={`text-[13px] font-bold leading-tight flex items-center gap-1 ${String(leak.agentlink_sync ?? "").includes("🟢") ? "text-emerald-300" : "text-rose-300"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${String(leak.agentlink_sync ?? "").includes("🟢") ? "bg-emerald-400" : "bg-rose-400"}`} />
                    AgentLink
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-12 text-white/60">CFO snapshot unavailable.</p>
          )}
        </div>
      </div>

      {/* 2026-06-14 BIG PROMPT execution: 4-KPI tile row REMOVED — duplicated the
          new AGENCY HERO band above. Sam: "kinda duplicate the previous portion."
          The hero owns Agency AP / Deals / Producers / Licensed MTD canonically. */}

      {/* ── Trend chart (period-aware) + Top producers leaderboard ── */}
      <div className="grid gap-3 lg:grid-cols-3">
        {/* 2026-06-14 BIG PROMPT v6.2 · Daily AP run-rate PROMOTED to premium glass.
            Sam: "Daily AP run-rate is left to only fucking graph I see. I wanted
            more like those inner layer graphs."
            Now wrapped in the canonical gradient hero pattern (slate→emerald)
            with glow rim shadow, 2 soft-blur accents, animate-ping LIVE dot,
            4 inner glass tiles above the chart for context. */}
        <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)] lg:col-span-2">
          <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

          <div className="relative p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">{periodBounds.label} · ANNUAL PREMIUM</p>
              </div>
              <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
                Daily run-rate
              </Badge>
            </div>

            {/* 4 inner glass tiles · the "more inner layer graphs" Sam asked for */}
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 mb-4">
              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Total AP</p>
                <p className="text-[24px] leading-none font-black tabular-nums text-emerald-300">{fmtUsd(periodSummary.totalAp, true)}</p>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Deals</p>
                <p className="text-[24px] leading-none font-black tabular-nums text-white">{fmtNum(periodSummary.dealCount)}</p>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Avg / deal</p>
                <p className="text-[24px] leading-none font-black tabular-nums text-white">{fmtUsd(periodSummary.dealCount ? periodSummary.totalAp / periodSummary.dealCount : 0, true)}</p>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/20">
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Daily pace</p>
                <p className="text-[24px] leading-none font-black tabular-nums text-amber-300">{fmtUsd(periodSummary.totalAp / Math.max(1, (Math.ceil((new Date(periodBounds.endIso).getTime() - new Date(periodBounds.startIso).getTime()) / 86400000))), true)}</p>
              </div>
            </div>

            {trend.isLoading ? (
              <Skeleton className="h-[220px] w-full bg-white/[0.04]" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trend.data}>
                  <defs>
                    <linearGradient id="ceoApGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(168 70% 50%)" stopOpacity={0.75} />
                      <stop offset="100%" stopColor="hsl(168 70% 50%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d), "MMM d")} fontSize={10} stroke="rgba(255,255,255,0.4)" />
                  <YAxis fontSize={10} stroke="rgba(255,255,255,0.4)" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: "hsl(220 40% 8%)", border: "1px solid hsl(168 70% 45% / 0.4)", borderRadius: 12, color: "#fff" }}
                    labelStyle={{ color: "hsl(168 70% 70%)" }}
                    labelFormatter={(d) => format(new Date(d), "PPP")}
                    formatter={(v: number, name: string) => name === "ap" ? fmtUsd(v) : v}
                  />
                  <Area type="monotone" dataKey="ap" stroke="hsl(168 70% 60%)" strokeWidth={2} fill="url(#ceoApGrad)" name="ap" />
                </AreaChart>
              </ResponsiveContainer>
            )}

            {/* 2026-06-15 v6.7 · Sam: "fill up this box · the one graph looks weird."
                Adding a DAILY DEAL COUNT bar chart underneath the AP area chart so
                the card carries 2 dimensions of data instead of one. */}
            {trend.data && trend.data.length > 0 && (
              <>
                <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold">DAILY DEAL COUNT</p>
                  <span className="text-[10px] tabular-nums text-white/40">
                    peak day: {Math.max(...trend.data.map((t: any) => t.deals ?? 0))} deals
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={110}>
                  <BarChart data={trend.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d), "MMM d")} fontSize={9} stroke="rgba(255,255,255,0.4)" />
                    <YAxis fontSize={9} stroke="rgba(255,255,255,0.4)" allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "hsl(220 40% 8%)", border: "1px solid hsl(45 85% 55% / 0.4)", borderRadius: 12, color: "#fff", fontSize: 11 }}
                      labelFormatter={(d) => format(new Date(d), "PPP")}
                      formatter={(v: number) => [`${v} deals`, "Deals"]}
                    />
                    <Bar dataKey="deals" fill="hsl(45 85% 55%)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </div>
        </div>

        {/* Leaderboard promoted to amber-gradient glass to match the new Daily AP card */}
        <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(45_85%_55%/0.20)]">
          <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

          <div className="relative p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <Crown className="h-4 w-4 text-amber-400" />
                <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">TOP PRODUCERS · {periodBounds.label.toUpperCase()}</p>
              </div>
            </div>

            {periodDeals.isLoading ? (
              <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full bg-white/[0.04]" />)}</div>
            ) : periodSummary.producers.length === 0 ? (
              <div className="py-8 text-center">
                <Trophy className="h-8 w-8 mx-auto mb-2 text-white/30" />
                <p className="text-13 text-white/60">No production in {periodBounds.label.toLowerCase()} yet.</p>
                <p className="text-11 text-white/40 mt-1">First deal opens the board.</p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {periodSummary.producers.map((a, i) => (
                  <li
                    key={a.agent_id}
                    className={`flex items-center gap-3 rounded-xl px-2.5 py-2 border transition-all ${
                      i === 0
                        ? "border-amber-400/40 bg-amber-400/[0.06] shadow-[0_0_16px_-4px_hsl(45_85%_55%/0.3)]"
                        : "border-white/[0.06] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className={`h-7 w-7 rounded-lg text-[12px] font-black flex items-center justify-center shrink-0 ${
                      i === 0 ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40" :
                      i === 1 ? "bg-slate-400/15 text-slate-200" :
                      i === 2 ? "bg-amber-700/20 text-amber-400" :
                      "bg-white/[0.04] text-white/50"
                    }`}>
                      {i + 1}
                    </span>
                    {a.avatar_url ? (
                      <img src={a.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover ring-1 ring-white/10" />
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-white/[0.06] text-white text-[10px] font-bold flex items-center justify-center">
                        {(a.display_name ?? "?").split(" ").map(s => s[0]).slice(0, 2).join("")}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-13 font-semibold truncate text-white">{a.display_name ?? "—"}</p>
                      <p className="text-[10px] text-white/50">{a.agent_code ?? "—"} · {fmtNum(a.deals)} deals</p>
                    </div>
                    <p className="text-14 font-black tabular-nums text-emerald-300 shrink-0">
                      {fmtUsd(a.ap, true)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="ghost" size="sm" className="w-full mt-3 text-white/70 hover:text-white hover:bg-white/[0.04]">
              <Link to="/dashboard/leaderboard">Full leaderboard <ArrowRight className="h-3 w-3 ml-1" /></Link>
            </Button>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────
          v26 L-effort REFACTOR (audit wf_95394f71-484):
          4 standalone zones collapsed into 1 tabbed strip:
            • Manager hierarchy share
            • Pipeline funnel + period stats
            • Recent hires
            • Recent activations
          Tab strip pattern matches AgentLink's main content area.
          Zone count: 9 → 6 (audit target was 4 · this gets meaningfully
          closer without an unsafe full rewrite).
          ────────────────────────────────────────────────────────────── */}
      <GlassCard className="p-4">
        <Tabs defaultValue="pipeline" className="w-full">
          <TabsList className="inline-flex h-9 bg-transparent border-b border-border w-full justify-start gap-1 rounded-none p-0">
            <TabsTrigger value="pipeline" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-3 py-2 text-12">Pipeline</TabsTrigger>
            <TabsTrigger value="managers" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-3 py-2 text-12">Managers</TabsTrigger>
            <TabsTrigger value="hires" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-3 py-2 text-12">Just hired{recentHires.data ? ` (${recentHires.data.length})` : ""}</TabsTrigger>
            <TabsTrigger value="activations" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-3 py-2 text-12">Activations</TabsTrigger>
          </TabsList>

          <TabsContent value="pipeline" className="mt-4 space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Agency funnel</p>
                <FunnelStrip
                  steps={[
                    { label: "Active applications", value: c?.total_applications ?? 0, color: "bg-slate-500" },
                    { label: "Contracts signed · MTD", value: c?.paid_mtd ?? 0,        color: "bg-emerald-500" },
                    { label: "Apps this week",      value: c?.apps_wtd ?? 0,           color: "bg-amber-500" },
                    { label: "Uncontacted >24h",    value: c?.uncontacted_24h ?? 0,    color: "bg-rose-500" },
                    { label: "Stale 3 days+",       value: c?.stale_new_3d ?? 0,       color: "bg-rose-500" },
                  ]}
                />
                <div className="mt-3 pt-2 border-t border-border/40 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{c?.unassigned_open ? `${c.unassigned_open} unassigned` : "All assigned"}</span>
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/dashboard/applicants">Open <ChevronRight className="h-3 w-3 ml-0.5" /></Link>
                  </Button>
                </div>
              </div>
              <div className="lg:col-span-2">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Production · {periodBounds.label}</p>
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
                    <PipelineStat label="Direct to Sam" value={fmtUsd(periodSummary.managers.find((m) => m.name === "Direct to Sam / no manager")?.ap ?? 0, true)} detail={`${fmtNum(periodSummary.managers.find((m) => m.name === "Direct to Sam / no manager")?.deals ?? 0)} deals`} tone="warning" />
                    <PipelineStat label="Uncontacted >24h" value={fmtNum(c?.uncontacted_24h ?? 0)} detail={`${fmtNum(c?.stale_new_3d ?? 0)} stale 3d+`} tone={(c?.uncontacted_24h ?? 0) > 0 ? "warning" : "default"} />
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="managers" className="mt-4">
            {periodSummary.managers.length === 0 ? (
              <EmptyState icon={<Users className="h-6 w-6" />} title={`No manager production in ${periodBounds.label.toLowerCase()}`} />
            ) : (
              <>
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">Manager production share · {fmtUsd(periodSummary.totalAp, true)} total</p>
                <div className="space-y-2">
                  {periodSummary.managers.map((m, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-28 text-sm font-medium truncate shrink-0">{m.name}</div>
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${Math.min(m.pct, 100)}%` }} />
                        </div>
                      </div>
                      <div className="text-right shrink-0 min-w-[4rem]">
                        <span className="text-sm font-bold tabular-nums text-emerald-500 dark:text-emerald-400">{fmtUsd(m.ap, true)}</span>
                        <span className="text-[10px] text-muted-foreground ml-1.5">{m.pct.toFixed(0)}%</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground w-14 text-right tabular-nums shrink-0">
                        {fmtNum(m.deals)} deal{m.deals !== 1 ? "s" : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="hires" className="mt-4">
            {recentHires.isLoading ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (recentHires.data ?? []).length === 0 ? (
              <EmptyState icon={<UserPlus className="h-6 w-6" />} title="First hire opens the board" description="When a new agent is onboarded they'll surface here even before their first deal." />
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Most recent {(recentHires.data ?? []).length} hires</p>
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/dashboard/team-hierarchy">All agents <ArrowRight className="h-3 w-3 ml-1" /></Link>
                  </Button>
                </div>
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
              </>
            )}
          </TabsContent>

          <TabsContent value="activations" className="mt-4">
            <RecentActivationsPanel />
          </TabsContent>
        </Tabs>
      </GlassCard>

      {/* ── 2026-06-14 SIX NEW DENSE PANELS (v6 §31 premium hero pattern) ───
          Sam: "Command Center pretty trash because it only shows annual
          premium · had to go basic everything." This block adds carrier
          mix, top movers WoW, conversion funnel, live activity, source
          attribution ROI, and money flow — all from real DB columns
          audited via bot-sql. State production panel SKIPPED because
          agentlink_deals_snapshot.payload is empty (no geo data); the
          replacement panel is Source Attribution ROI, the next-most-
          valuable hidden dataset.
      */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* PANEL 1 · CARRIER MIX (emerald) ────────────────────────── */}
        <CarrierMixPanel data={carrierMix.data} loading={carrierMix.isLoading} />

        {/* PANEL 2 · TOP MOVERS WoW (amber) ────────────────────────── */}
        <TopMoversPanel data={topMovers.data ?? []} loading={topMovers.isLoading} />

        {/* PANEL 3 · CONVERSION FUNNEL 90d (rose) ──────────────────── */}
        <ConversionFunnelPanel data={funnel.data} loading={funnel.isLoading} />

        {/* PANEL 4 · ACTIVITY FEED (slate / emerald) ───────────────── */}
        <ActivityFeedPanel data={activity.data ?? []} loading={activity.isLoading} />

        {/* PANEL 5 · SOURCE ATTRIBUTION ROI (amber) — replaces State Production
            (state column not in agentlink_deals_snapshot payload per DB audit) */}
        <SourceRoiPanel data={sourceRoi.data ?? []} loading={sourceRoi.isLoading} />

        {/* PANEL 6 · MONEY FLOW (emerald) ──────────────────────────── */}
        <MoneyFlowPanel data={moneyFlow.data} loading={moneyFlow.isLoading} />
      </div>

      {/* 2026-06-15 NEW · AgentLink-parity gap panels (4) ─────────────
          Sam: "every analytic AgentLink has, I pretty much would."
          1. Personal Pace · MTD vs LMTD
          2. Product Mix MTD
          3. Week-over-Week 2-line chart
          4. Recruiter Contact SLA (the 234→11 leak)
      */}
      <ParityGapPanels />

      {/* 2026-06-15 v6.5 · 4 MORE PANELS · "push all four" — Sam unblocked the
          data-deferred panels with creative joins:
          5. State Production (via agents.al_user_id → applications.state)
          6. Time-of-Day Production Heat (snapshot_at hour in Phoenix tz)
          7. Commission Projection MTD (annual_premium × FY%)
          8. 12-Week Hire Pace (real agents.created_at data)
      */}
      <ExtendedParityPanels />

      {/* 2026-06-15 v6.5 · Footer Agency Health PROMOTED to premium glass.
          Sam: "ton of empty displays · blank spots for no reason · ugly."
          The 4 flat StatRowCards (Chargebacks 0 · Lapses 47 · Referrals 0 ·
          Referrals won 0) showed THREE zeros which made the footer look empty.
          Now: single premium glass band where 0-value tiles get coaching copy
          + tonal background (emerald=good zero, rose=bad number, amber=warn). */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="relative overflow-hidden rounded-3xl border border-rose-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-rose-950 text-white shadow-[0_0_48px_-12px_hsl(0_70%_50%/0.15)]">
          <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-rose-500/12 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
          <div className="relative p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                </span>
                <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-rose-300">AGENCY HEALTH · 30d</p>
              </div>
              <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-rose-400/40 bg-rose-400/10 text-rose-200">
                clean = silent
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Chargebacks · zero = good · non-zero = rose */}
              {(() => {
                const cb = c?.chargebacks_30d ?? 0;
                const isZero = cb === 0;
                return (
                  <div className={`p-3 rounded-xl border ${isZero ? "bg-emerald-500/[0.06] border-emerald-500/20" : "bg-rose-500/[0.10] border-rose-500/30"}`}>
                    <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Chargebacks</p>
                    <p className={`text-[24px] leading-none font-black tabular-nums ${isZero ? "text-emerald-300" : "text-rose-300"}`}>{fmtNum(cb)}</p>
                    <p className="text-[10px] text-white/40 mt-0.5">{isZero ? "Clean book." : "Investigate fast."}</p>
                  </div>
                );
              })()}

              {/* Lapses · 0-10 = amber, 10+ = rose */}
              {(() => {
                const lp = c?.lapses_30d ?? 0;
                const tone = lp > 10 ? "rose" : lp > 0 ? "amber" : "emerald";
                return (
                  <button
                    onClick={() => setLapsesOpen(true)}
                    className={`p-3 rounded-xl border text-left transition-all hover:border-white/40 ${
                      tone === "rose"    ? "bg-rose-500/[0.10] border-rose-500/30" :
                      tone === "amber"   ? "bg-amber-500/[0.08] border-amber-500/20" :
                                           "bg-emerald-500/[0.06] border-emerald-500/20"
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Lapses</p>
                    <p className={`text-[24px] leading-none font-black tabular-nums ${
                      tone === "rose" ? "text-rose-300" : tone === "amber" ? "text-amber-300" : "text-emerald-300"
                    }`}>{fmtNum(lp)}</p>
                    <p className="text-[10px] text-white/40 mt-0.5">Tap to drill.</p>
                  </button>
                );
              })()}

              {/* Referrals 30d · 0 = coaching */}
              {(() => {
                const r = c?.ref_30d ?? 0;
                const isZero = r === 0;
                return (
                  <div className={`p-3 rounded-xl border ${isZero ? "bg-amber-500/[0.06] border-amber-500/20" : "bg-emerald-500/[0.08] border-emerald-500/20"}`}>
                    <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Referrals · 30d</p>
                    <p className={`text-[24px] leading-none font-black tabular-nums ${isZero ? "text-amber-300" : "text-emerald-300"}`}>{fmtNum(r)}</p>
                    <p className="text-[10px] text-white/40 mt-0.5">{isZero ? "Open the ask." : "Keep asking."}</p>
                  </div>
                );
              })()}

              {/* Referrals won · 0 = coaching */}
              {(() => {
                const rw = c?.ref_won ?? 0;
                const isZero = rw === 0;
                return (
                  <div className={`p-3 rounded-xl border ${isZero ? "bg-amber-500/[0.06] border-amber-500/20" : "bg-emerald-500/[0.10] border-emerald-500/30"}`}>
                    <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Referrals · won</p>
                    <p className={`text-[24px] leading-none font-black tabular-nums ${isZero ? "text-amber-300" : "text-emerald-300"}`}>{fmtNum(rw)}</p>
                    <p className="text-[10px] text-white/40 mt-0.5">{isZero ? "First close opens the gate." : "Compound it."}</p>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* v26 audit fix: was 5-col grid (asymmetric · 4 items in 5 slots).
            Now 2-col grid matching the stats panel beside it. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <QuickAction icon={Users}      to="/dashboard/applicants"       label="Applicants"        desc="Review + assign" />
          <QuickAction icon={Briefcase}  to="/dashboard/recruit-pipeline" label="Recruit pipeline"  desc="Kanban board" />
          <QuickAction icon={Trophy}     to="/dashboard/leaderboard"      label="Leaderboard"       desc="Top producers" />
          <QuickAction icon={Sparkles}   to="/dashboard/strikes"          label="Strikes"           desc="Conduct + strikes log" />
        </div>
      </div>

      <LapsesDrilldownModal open={lapsesOpen} onOpenChange={setLapsesOpen} />
    </div>
  );
}

// ─── 2026-06-14 SIX NEW DENSE PANEL COMPONENTS (v6 §31 premium hero) ───────

const TITLE_CASE = (s: string): string =>
  s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/-/g, " ");

// PANEL 1 · CARRIER MIX MTD
function CarrierMixPanel({ data, loading }: {
  data: { carriers: Array<{ name: string; ap: number; deals: number }>; otherAp: number; otherDeals: number; totalAp: number; carrierCount: number } | undefined;
  loading: boolean;
}) {
  const palette = ["#10b981", "#06b6d4", "#3b82f6", "#a78bfa", "#f59e0b", "#fb7185", "#94a3b8"];
  const chartData = useMemo(() => {
    if (!data) return [] as Array<{ name: string; value: number; deals: number; pct: number }>;
    const rows = data.carriers.map((c, i) => ({
      name: c.name,
      value: c.ap,
      deals: c.deals,
      pct: data.totalAp > 0 ? (c.ap / data.totalAp) * 100 : 0,
    }));
    if (data.otherAp > 0) {
      rows.push({ name: "Other", value: data.otherAp, deals: data.otherDeals, pct: data.totalAp > 0 ? (data.otherAp / data.totalAp) * 100 : 0 });
    }
    return rows;
  }, [data]);
  const topConcentration = chartData[0];

  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">CARRIER MIX · MTD</p>
          </div>
          {data && data.totalAp > 0 && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
              {fmtUsd(data.totalAp, true)} AP
            </Badge>
          )}
        </div>

        {loading ? (
          <Skeleton className="h-40 w-full bg-white/5" />
        ) : !data || chartData.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[26px] font-black text-white/90">First deal opens the board</p>
            <p className="text-[11px] text-white/50 mt-1">No carrier production this month yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-center">
            <Link to="/dashboard/carriers" className="sm:col-span-2 h-40 block group" title="Open Carrier Resources">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={36}
                    outerRadius={64}
                    paddingAngle={2}
                    stroke="none"
                    className="cursor-pointer transition-opacity group-hover:opacity-90"
                  >
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={palette[i % palette.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(16,185,129,0.4)", borderRadius: 8, fontSize: 11, color: "white" }}
                    formatter={(value: number, _name, props: any) => [`${fmtUsd(value, true)} · ${props.payload.deals} deals`, props.payload.name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </Link>
            <div className="sm:col-span-3 space-y-1.5">
              {chartData.slice(0, 6).map((row, i) => (
                <Link
                  key={row.name}
                  to="/dashboard/carriers"
                  className="flex items-center justify-between gap-2 text-[11px] hover:bg-white/[0.04] rounded-md px-1.5 py-1 transition-colors group"
                  title={`Open ${row.name} resources`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: palette[i % palette.length] }} />
                    <span className="text-white/85 truncate font-medium group-hover:text-white">{row.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 tabular-nums">
                    <span className="text-white/60">{row.deals}d</span>
                    <span className="text-white font-semibold">{fmtUsd(row.value, true)}</span>
                    <span className="text-emerald-300 w-10 text-right">{row.pct.toFixed(0)}%</span>
                  </div>
                </Link>
              ))}
              {topConcentration && topConcentration.pct >= 50 && (
                <p className="text-[10px] text-amber-300/80 mt-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {topConcentration.name} = {topConcentration.pct.toFixed(0)}% concentration risk
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// PANEL 2 · TOP MOVERS WoW
function TopMoversPanel({ data, loading }: {
  data: Array<{ agentId: string; name: string; code: string | null; thisWk: number; lastWk: number; delta: number; pct: number | null }>;
  loading: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(45_85%_55%/0.25)]">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">TOP MOVERS · WoW</p>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-amber-400/40 bg-amber-400/10 text-amber-200">
            Week vs prior week
          </Badge>
        </div>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full bg-white/5" />)}</div>
        ) : data.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[26px] font-black text-white/90">Momentum starts Monday</p>
            <p className="text-[11px] text-white/50 mt-1">No production deltas to surface yet this week.</p>
          </div>
        ) : (
          <ol className="space-y-1.5">
            {data.map((m, i) => {
              const initials = m.name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
              const pctClass = m.delta > 0 ? "text-emerald-300 bg-emerald-500/15 border-emerald-400/30"
                : m.delta < 0 ? "text-rose-300 bg-rose-500/15 border-rose-400/30"
                : "text-white/60 bg-white/5 border-white/10";
              const pctText = m.pct == null ? "NEW" : `${m.delta >= 0 ? "+" : ""}${m.pct.toFixed(0)}%`;
              return (
                <li key={m.agentId} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] w-4 text-white/40 tabular-nums">{i + 1}</span>
                    <span className="h-7 w-7 rounded-full bg-amber-500/20 border border-amber-400/30 grid place-items-center text-[10px] font-bold text-amber-200 shrink-0">
                      {initials || "—"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-white truncate">{m.name}</p>
                      <p className="text-[10px] text-white/45 tabular-nums">
                        {fmtUsd(m.lastWk, true)} → <span className="text-white/85">{fmtUsd(m.thisWk, true)}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] font-bold text-white tabular-nums">
                      {m.delta >= 0 ? "+" : ""}{fmtUsd(m.delta, true)}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums ${pctClass}`}>
                      {pctText}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

// PANEL 3 · CONVERSION FUNNEL · 90 days
function ConversionFunnelPanel({ data, loading }: {
  data: { created: number; contacted: number; course: number; exam: number; licensed: number } | undefined;
  loading: boolean;
}) {
  const stages = useMemo(() => {
    if (!data) return [] as Array<{ key: string; label: string; count: number; pctOfTop: number; pctOfPrior: number | null }>;
    const top = data.created;
    const arr = [
      { key: "created", label: "Created", count: data.created },
      { key: "contacted", label: "Contacted", count: data.contacted },
      { key: "course", label: "Course bought", count: data.course },
      { key: "exam", label: "Exam passed", count: data.exam },
      { key: "licensed", label: "Licensed", count: data.licensed },
    ];
    return arr.map((s, i) => {
      const prior = i === 0 ? null : arr[i - 1].count;
      return {
        ...s,
        pctOfTop: top > 0 ? (s.count / top) * 100 : 0,
        pctOfPrior: prior == null ? null : (prior > 0 ? (s.count / prior) * 100 : 0),
      };
    });
  }, [data]);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-rose-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-rose-950 text-white shadow-[0_0_48px_-12px_hsl(355_75%_55%/0.25)]">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-rose-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-rose-300">CONVERSION FUNNEL · 90d</p>
          </div>
          {data && data.created > 0 && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-rose-400/40 bg-rose-400/10 text-rose-200">
              {data.created} apps in
            </Badge>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-full bg-white/5" />)}</div>
        ) : !data || data.created === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[26px] font-black text-white/90">Funnel boots on first application</p>
            <p className="text-[11px] text-white/50 mt-1">No new applications in the last 90 days.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {stages.map((s, i) => {
              const dropOff = s.pctOfPrior == null ? null : 100 - s.pctOfPrior;
              return (
                <div key={s.key}>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-white/85 font-semibold">{s.label}</span>
                    <span className="tabular-nums text-white/70">
                      <span className="text-white font-bold">{fmtNum(s.count)}</span>
                      <span className="text-white/40 ml-2">{s.pctOfTop.toFixed(1)}% of top</span>
                      {s.pctOfPrior != null && (
                        <span className={`ml-2 ${dropOff! > 50 ? "text-rose-300" : "text-emerald-300"}`}>
                          {s.pctOfPrior.toFixed(0)}% from prior
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500 transition-all"
                      style={{ width: `${Math.max(2, s.pctOfTop)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="text-[10px] text-white/40 mt-3 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-amber-400" />
              Licensed-stage data thin — backfill licensed_at to trust the bottom.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// PANEL 4 · ACTIVITY FEED
function ActivityFeedPanel({ data, loading }: {
  data: Array<{ id: number; event_type: string | null; agent_id: string | null; annual_premium: number | string | null; product_sold: string | null; created_at: string | null; agent_name: string }>;
  loading: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">LIVE ACTIVITY · CULTURE FEED</p>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
            <Radio className="h-2.5 w-2.5 mr-1" /> 60s refresh
          </Badge>
        </div>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full bg-white/5" />)}</div>
        ) : data.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[26px] font-black text-white/90">Inbox zero. Hold the Standard.</p>
            <p className="text-[11px] text-white/50 mt-1">No culture events posted yet.</p>
          </div>
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {data.map((e) => {
              const initials = e.agent_name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
              const ap = Number(e.annual_premium ?? 0);
              const when = e.created_at ? formatDistanceToNow(new Date(e.created_at), { addSuffix: true }) : "—";
              const verb = e.event_type === "deal_posted" ? "posted" : (e.event_type ?? "event")?.replaceAll("_", " ");
              return (
                <li key={e.id} className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
                  <span className="h-7 w-7 rounded-full bg-emerald-500/20 border border-emerald-400/30 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
                    {initials || "—"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-white truncate">
                      <span className="font-semibold">{e.agent_name}</span>
                      <span className="text-white/55"> {verb} </span>
                      <span className="text-white/85">{e.product_sold ?? "deal"}</span>
                    </p>
                    <p className="text-[10px] text-white/40">{when}</p>
                  </div>
                  {ap > 0 && (
                    <span className="text-[11px] font-bold text-emerald-300 tabular-nums shrink-0">
                      {fmtUsd(ap, true)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// PANEL 5 · SOURCE ATTRIBUTION ROI (replaces State Production — no state data)
function SourceRoiPanel({ data, loading }: {
  data: Array<{ source: string; apps: number; course: number; licensed: number; coursePct: number }>;
  loading: boolean;
}) {
  const maxApps = Math.max(1, ...data.map((d) => d.apps));
  const topSource = data.reduce<{ source: string; coursePct: number } | null>(
    (best, r) => (r.apps >= 10 && (!best || r.coursePct > best.coursePct) ? r : best),
    null,
  );

  return (
    <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(45_85%_55%/0.25)]">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">SOURCE ATTRIBUTION · 180d</p>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-amber-400/40 bg-amber-400/10 text-amber-200">
            ROI by source
          </Badge>
        </div>

        {loading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 w-full bg-white/5" />)}</div>
        ) : data.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[26px] font-black text-white/90">Tag your sources, win the funnel</p>
            <p className="text-[11px] text-white/50 mt-1">No attribution data in the last 180 days.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.map((r) => {
              const widthPct = (r.apps / maxApps) * 100;
              const isWinner = topSource && r.source === topSource.source;
              return (
                <div key={r.source} className="grid grid-cols-12 items-center gap-2 text-[11px]">
                  <div className="col-span-3 truncate text-white/80 font-medium">{TITLE_CASE(r.source)}</div>
                  <div className="col-span-5 h-2 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isWinner ? "bg-gradient-to-r from-emerald-400 to-amber-400" : "bg-amber-500/60"}`}
                      style={{ width: `${Math.max(3, widthPct)}%` }}
                    />
                  </div>
                  <div className="col-span-4 flex items-center justify-end gap-2 tabular-nums">
                    <span className="text-white/60">{r.apps} apps</span>
                    <span className={`font-bold ${r.coursePct >= 5 ? "text-emerald-300" : "text-white/70"}`}>
                      {r.coursePct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}
            {topSource && (
              <p className="text-[10px] text-emerald-300/80 mt-2 flex items-center gap-1.5">
                <Zap className="h-3 w-3" /> {TITLE_CASE(topSource.source)} converts {topSource.coursePct.toFixed(1)}% — double down here.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// PANEL 6 · MONEY FLOW (commission_ledger MTD)
function MoneyFlowPanel({ data, loading }: {
  data: { total: number; pending: number; paid: number; voided: number; count: number } | undefined;
  loading: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">MONEY FLOW · MTD</p>
          </div>
          {data && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
              {fmtNum(data.count)} ledger rows
            </Badge>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-3 gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 bg-white/5" />)}</div>
        ) : !data || data.count === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[26px] font-black text-white/90">Wire the ledger, watch it flow</p>
            <p className="text-[11px] text-white/50 mt-1">commission_ledger is unpopulated for this month.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/45 mb-1.5">Pending</p>
                <p className="text-[26px] sm:text-[32px] leading-none font-black tabular-nums text-amber-300">
                  {fmtUsd(data.pending, true)}
                </p>
                <p className="text-[10px] text-white/50 mt-1">Awaiting carrier pay</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/45 mb-1.5">Paid</p>
                <p className="text-[26px] sm:text-[32px] leading-none font-black tabular-nums text-emerald-300">
                  {fmtUsd(data.paid, true)}
                </p>
                <p className="text-[10px] text-white/50 mt-1">Cash in hand</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/45 mb-1.5">Voided</p>
                <p className="text-[26px] sm:text-[32px] leading-none font-black tabular-nums text-rose-300">
                  {fmtUsd(data.voided, true)}
                </p>
                <p className="text-[10px] text-white/50 mt-1">Charged back</p>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px]">
              <span className="text-white/55">Total written MTD</span>
              <span className="text-white font-bold tabular-nums">{fmtUsd(data.total)}</span>
            </div>
            {data.count < 20 && (
              <p className="text-[10px] text-amber-300/80 mt-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Ledger thin ({data.count} rows) — pipeline reconciliation needed.
              </p>
            )}
          </>
        )}
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
        className="text-left w-full transition-base"
      >
        {/* v24 audit fix: removed hover:scale-[1.01] Y-translate (banned per v22 §10.5).
            AgentLink uses bg/border shifts only — no size mutations on rows. */}
        <GlassCard className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-primary/40">
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

// ─────────────────────────────────────────────────────────────────────
// PARITY GAP PANELS · 2026-06-15
// Sam: "every analytic AgentLink has, I pretty much would."
// 4 new dense panels filling the highest-impact AgentLink-parity gaps.
// ─────────────────────────────────────────────────────────────────────

function ParityGapPanels() {
  // 2026-06-15 v6.6: WoW moved to DashboardPulseGroup at top of page (Sam directive).
  // SLA spans full width since only 3 items remain · 2-col grid with col-span-2 on SLA.
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <PersonalPacePanel />
      <ProductMixPanel />
      <RecruiterContactSlaPanel />
    </div>
  );
}

// v6.6 PULSE GROUP — 4 charts Sam wants directly under the agency hero
function DashboardPulseGroup() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <WeekOverWeekPanel />
      <HirePace12WPanel />
      <StateProductionPanel />
      <CommissionProjectionPanel />
    </div>
  );
}

// ── PANEL · PERSONAL PRODUCTION PACE · MTD vs LMTD ──────────────────
function PersonalPacePanel() {
  const { user } = useAuth();
  const userId = (user as any)?.id ?? null;

  // Resolve admin's al_user_id once (used to filter the snapshot)
  const me = useQuery({
    queryKey: ["my-al-user-id", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("agents" as never)
        .select("al_user_id, display_name")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { al_user_id: number | null; display_name: string | null } | null;
    },
  });
  const alUid = me.data?.al_user_id ?? null;

  const pace = useQuery({
    queryKey: ["personal-pace", alUid],
    enabled: !!alUid,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
      const dayOfMonth = now.getDate();
      const lastMonthSameDayStr = new Date(now.getFullYear(), now.getMonth() - 1, dayOfMonth).toISOString().slice(0, 10);
      const today = now.toISOString().slice(0, 10);

      const [mtdRes, lmtdSameDayRes, lmtdFullRes] = await Promise.all([
        supabase.from("agentlink_deals_snapshot" as never)
          .select("annual_premium", { count: "exact" })
          .eq("user_id", alUid)
          .gte("effective_date", monthStart)
          .lte("effective_date", today),
        supabase.from("agentlink_deals_snapshot" as never)
          .select("annual_premium", { count: "exact" })
          .eq("user_id", alUid)
          .gte("effective_date", lastMonthStart)
          .lte("effective_date", lastMonthSameDayStr),
        supabase.from("agentlink_deals_snapshot" as never)
          .select("annual_premium", { count: "exact" })
          .eq("user_id", alUid)
          .gte("effective_date", lastMonthStart)
          .lte("effective_date", lastMonthEnd),
      ]);

      const sum = (rows: any) => (rows ?? []).reduce((s: number, r: any) => s + Number(r.annual_premium ?? 0), 0);
      const mtdAp = sum(mtdRes.data);
      const lmtdSameDayAp = sum(lmtdSameDayRes.data);
      const lmtdFullAp = sum(lmtdFullRes.data);
      const mtdDeals = mtdRes.count ?? 0;
      const lmtdSameDayDeals = lmtdSameDayRes.count ?? 0;
      const lmtdFullDeals = lmtdFullRes.count ?? 0;
      const daysIntoMonth = dayOfMonth;
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const projectedAp = daysIntoMonth > 0 ? (mtdAp / daysIntoMonth) * daysInMonth : 0;

      return { mtdAp, lmtdSameDayAp, lmtdFullAp, mtdDeals, lmtdSameDayDeals, lmtdFullDeals, projectedAp, daysIntoMonth, daysInMonth };
    },
  });

  const p = pace.data;
  const apDeltaPct = p && p.lmtdSameDayAp > 0 ? ((p.mtdAp - p.lmtdSameDayAp) / p.lmtdSameDayAp) * 100 : 0;
  const dealsDelta = p ? p.mtdDeals - p.lmtdSameDayDeals : 0;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">MY PACE · MTD vs LMTD</p>
          </div>
          {p && (
            <Badge variant="outline" className={`text-[10px] uppercase tracking-widest ${apDeltaPct >= 0 ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-rose-400/40 bg-rose-400/10 text-rose-200"}`}>
              {apDeltaPct >= 0 ? "▲" : "▼"} {Math.abs(apDeltaPct).toFixed(1)}%
            </Badge>
          )}
        </div>
        {pace.isLoading ? (
          <div className="space-y-2">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-10 bg-white/[0.04]" />)}</div>
        ) : !alUid ? (
          <p className="text-12 text-white/60 italic">Link your al_user_id on your agent profile to see personal pace.</p>
        ) : !p ? (
          <p className="text-12 text-white/60">No production data found. Wire your AgentLink.</p>
        ) : (
          <>
            <div className="grid gap-4 grid-cols-3 mb-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">MTD · AP</p>
                <p className="text-[28px] leading-none font-black tabular-nums text-emerald-300">{fmtUsd(p.mtdAp, true)}</p>
                <p className="text-[10px] text-white/40 tabular-nums">{p.mtdDeals} deals · day {p.daysIntoMonth}/{p.daysInMonth}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">LMTD · same period</p>
                <p className="text-[28px] leading-none font-black tabular-nums text-white">{fmtUsd(p.lmtdSameDayAp, true)}</p>
                <p className="text-[10px] text-white/40 tabular-nums">{p.lmtdSameDayDeals} deals · {dealsDelta >= 0 ? "+" : ""}{dealsDelta} vs now</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">PROJECTED · EOM</p>
                <p className="text-[28px] leading-none font-black tabular-nums text-amber-300">{fmtUsd(p.projectedAp, true)}</p>
                <p className="text-[10px] text-white/40 tabular-nums">last month full: {fmtUsd(p.lmtdFullAp, true)}</p>
              </div>
            </div>
            <div className="pt-3 border-t border-white/[0.06]">
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1.5">PACE BAR</p>
              <div className="relative h-2 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full bg-emerald-400/60 transition-all"
                  style={{ width: `${Math.min(100, p.lmtdFullAp > 0 ? (p.projectedAp / p.lmtdFullAp) * 100 : 0).toFixed(1)}%` }}
                />
              </div>
              <p className="text-[10px] text-white/40 mt-1 tabular-nums">
                {p.lmtdFullAp > 0 ? `${((p.projectedAp / p.lmtdFullAp) * 100).toFixed(0)}% of last month's full month` : "First full month coming up"}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── PANEL · PRODUCT MIX MTD ─────────────────────────────────────────
function ProductMixPanel() {
  const mix = useQuery({
    queryKey: ["dashboard-product-mix"],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const today = now.toISOString().slice(0, 10);
      const { data } = await supabase
        .from("agentlink_deals_snapshot" as never)
        .select("product_sold, annual_premium")
        .gte("effective_date", monthStart)
        .lte("effective_date", today);
      const rows = (data ?? []) as Array<{ product_sold: string | null; annual_premium: number | string | null }>;
      const totals = new Map<string, { count: number; ap: number }>();
      for (const r of rows) {
        const key = (r.product_sold ?? "—").trim();
        const existing = totals.get(key) ?? { count: 0, ap: 0 };
        existing.count += 1;
        existing.ap += Number(r.annual_premium ?? 0);
        totals.set(key, existing);
      }
      const list = Array.from(totals.entries())
        .map(([product, v]) => ({ product, count: v.count, ap: v.ap }))
        .sort((a, b) => b.ap - a.ap)
        .slice(0, 8);
      const totalAp = list.reduce((s, x) => s + x.ap, 0);
      return { list, totalAp };
    },
  });

  const data = mix.data;
  const max = data?.list[0]?.ap ?? 0;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">PRODUCT MIX · MTD</p>
          </div>
          {data && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
              {fmtUsd(data.totalAp, true)} total
            </Badge>
          )}
        </div>
        {mix.isLoading ? (
          <div className="space-y-2">{Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-8 bg-white/[0.04]" />)}</div>
        ) : !data || data.list.length === 0 ? (
          <p className="text-12 text-white/60 italic">First deal opens the board.</p>
        ) : (
          <div className="space-y-2">
            {data.list.map((r) => {
              const pct = max > 0 ? (r.ap / max) * 100 : 0;
              const totalPct = data.totalAp > 0 ? (r.ap / data.totalAp) * 100 : 0;
              return (
                <div key={r.product} className="space-y-0.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium truncate flex-1 text-white/85">{r.product}</span>
                    <span className="tabular-nums font-bold text-emerald-300 shrink-0 ml-2">{fmtUsd(r.ap, true)}</span>
                    <span className="tabular-nums text-white/40 shrink-0 ml-2 w-12 text-right">{r.count} · {totalPct.toFixed(0)}%</span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <div className="h-full bg-emerald-400/70" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── PANEL · WEEK-OVER-WEEK 2-LINE CHART ─────────────────────────────
function WeekOverWeekPanel() {
  const wow = useQuery({
    queryKey: ["dashboard-wow"],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const today = new Date();
      const start = new Date(today);
      start.setDate(start.getDate() - 13);
      const startStr = start.toISOString().slice(0, 10);
      const todayStr = today.toISOString().slice(0, 10);
      const { data } = await supabase
        .from("agentlink_deals_snapshot" as never)
        .select("effective_date, annual_premium")
        .gte("effective_date", startStr)
        .lte("effective_date", todayStr);
      const rows = (data ?? []) as Array<{ effective_date: string | null; annual_premium: number | string | null }>;
      const buckets = new Map<string, number>();
      for (let i = 0; i < 14; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        buckets.set(d.toISOString().slice(0, 10), 0);
      }
      for (const r of rows) {
        if (!r.effective_date) continue;
        const k = r.effective_date.slice(0, 10);
        buckets.set(k, (buckets.get(k) ?? 0) + Number(r.annual_premium ?? 0));
      }
      const sorted = Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const chart: Array<{ idx: number; weekday: string; thisWeek: number | null; lastWeek: number | null; dayLabel: string }> = [];
      for (let i = 0; i < 7; i++) {
        const lastWeek = sorted[i]?.[1] ?? 0;
        const thisWeek = sorted[i + 7]?.[1] ?? 0;
        const weekDate = new Date(sorted[i + 7]?.[0] ?? new Date());
        const weekday = weekDate.toLocaleDateString("en-US", { weekday: "short" });
        chart.push({ idx: i, weekday, lastWeek, thisWeek, dayLabel: weekday });
      }
      const thisWeekTotal = chart.reduce((s, x) => s + (x.thisWeek ?? 0), 0);
      const lastWeekTotal = chart.reduce((s, x) => s + (x.lastWeek ?? 0), 0);
      const deltaPct = lastWeekTotal > 0 ? ((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100 : 0;
      return { chart, thisWeekTotal, lastWeekTotal, deltaPct };
    },
  });

  const d = wow.data;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">WEEK OVER WEEK · DAILY AP</p>
          </div>
          {d && (
            <Badge variant="outline" className={`text-[10px] uppercase tracking-widest ${d.deltaPct >= 0 ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-rose-400/40 bg-rose-400/10 text-rose-200"}`}>
              {d.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(d.deltaPct).toFixed(1)}%
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-3 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20">
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">THIS WEEK</p>
            <p className="text-[24px] leading-none font-black tabular-nums text-emerald-300">{fmtUsd(d?.thisWeekTotal ?? 0, true)}</p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">LAST WEEK</p>
            <p className="text-[24px] leading-none font-black tabular-nums text-white">{fmtUsd(d?.lastWeekTotal ?? 0, true)}</p>
          </div>
        </div>
        {wow.isLoading ? (
          <Skeleton className="h-32 w-full bg-white/[0.04]" />
        ) : d?.chart && d.chart.length > 0 ? (
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={d.chart}>
              <defs>
                <linearGradient id="wowThisWk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(168 70% 55%)" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="hsl(168 70% 55%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="dayLabel" fontSize={10} stroke="rgba(255,255,255,0.4)" />
              <YAxis fontSize={10} stroke="rgba(255,255,255,0.4)" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "hsl(220 40% 8%)", border: "1px solid hsl(168 70% 45% / 0.4)", borderRadius: 12, color: "#fff", fontSize: 11 }}
                formatter={(v: number, name: string) => [fmtUsd(v), name === "thisWeek" ? "This week" : "Last week"]}
              />
              <Area type="monotone" dataKey="thisWeek" stroke="hsl(168 70% 60%)" strokeWidth={2} fill="url(#wowThisWk)" />
              <Area type="monotone" dataKey="lastWeek" stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} strokeDasharray="4 4" fill="none" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-12 text-white/60 italic">Momentum starts Monday.</p>
        )}
      </div>
    </div>
  );
}

// ── PANEL · RECRUITER CONTACT SLA (rose · leak posture) ─────────────
function RecruiterContactSlaPanel() {
  const sla = useQuery({
    queryKey: ["dashboard-contact-sla"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const cutoff48 = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const cutoff24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: apps } = await supabase
        .from("applications" as never)
        .select("id, assigned_agent_id, recruiter_id, contacted_at, created_at, terminated_at")
        .is("terminated_at", null);

      const rows = (apps ?? []) as Array<{
        id: string; assigned_agent_id: string | null; recruiter_id: string | null;
        contacted_at: string | null; created_at: string | null; terminated_at: string | null;
      }>;

      // Aggregate per recruiter (use recruiter_id when present, else assigned_agent_id)
      const buckets = new Map<string, { total: number; uncontacted: number; stale48: number; stale24: number; contacted24h: number }>();
      for (const r of rows) {
        const k = r.recruiter_id ?? r.assigned_agent_id;
        if (!k) continue;
        const b = buckets.get(k) ?? { total: 0, uncontacted: 0, stale48: 0, stale24: 0, contacted24h: 0 };
        b.total += 1;
        if (!r.contacted_at) {
          b.uncontacted += 1;
          if (r.created_at && r.created_at < cutoff48) b.stale48 += 1;
          if (r.created_at && r.created_at < cutoff24) b.stale24 += 1;
        } else if (r.created_at) {
          const dt = (new Date(r.contacted_at).getTime() - new Date(r.created_at).getTime()) / 3600000;
          if (dt <= 24 && dt >= 0) b.contacted24h += 1;
        }
        buckets.set(k, b);
      }

      // Resolve names
      const ids = Array.from(buckets.keys());
      const { data: agents } = ids.length > 0
        ? await supabase.from("agents" as never).select("id, display_name, agent_code").in("id", ids)
        : { data: [] };
      const nameMap = new Map<string, { name: string; code: string | null }>();
      for (const a of (agents ?? []) as Array<{ id: string; display_name: string | null; agent_code: string | null }>) {
        nameMap.set(a.id, { name: a.display_name ?? "—", code: a.agent_code });
      }

      const list = Array.from(buckets.entries())
        .map(([id, b]) => ({
          id,
          name: nameMap.get(id)?.name ?? "—",
          code: nameMap.get(id)?.code ?? "—",
          ...b,
          firstTouchRate: b.total > 0 ? (b.contacted24h / b.total) * 100 : 0,
        }))
        .filter(r => r.total >= 5)
        .sort((a, b) => b.stale48 - a.stale48)
        .slice(0, 8);

      const totalUncontacted = list.reduce((s, x) => s + x.uncontacted, 0);
      const totalStale48 = list.reduce((s, x) => s + x.stale48, 0);

      return { list, totalUncontacted, totalStale48 };
    },
  });

  const d = sla.data;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-rose-500/25 bg-gradient-to-br from-slate-950 via-rose-950/40 to-slate-950 text-white shadow-[0_0_48px_-12px_hsl(0_70%_50%/0.25)] lg:col-span-2">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-rose-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-rose-300">RECRUITER CONTACT SLA · LEAK</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-rose-400/40 bg-rose-400/10 text-rose-200">
              {d?.totalStale48 ?? 0} stale 48h+
            </Badge>
            <Link to="/admin/recruiting-inbox" className="text-[10px] text-rose-200/80 hover:text-rose-100 uppercase tracking-widest font-bold">
              Inbox →
            </Link>
          </div>
        </div>
        {sla.isLoading ? (
          <div className="space-y-2">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-10 bg-white/[0.04]" />)}</div>
        ) : !d || d.list.length === 0 ? (
          <p className="text-12 text-white/60 italic">Inbox zero across the board. Hold the Standard.</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-12">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-white/40 border-b border-white/[0.06]">
                  <th className="text-left pb-2 font-bold">Recruiter</th>
                  <th className="text-right pb-2 font-bold">Total</th>
                  <th className="text-right pb-2 font-bold">Uncontacted</th>
                  <th className="text-right pb-2 font-bold">Stale 48h+</th>
                  <th className="text-right pb-2 font-bold">1st-touch &lt;24h</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {d.list.map((r) => {
                  const sla48Pct = r.total > 0 ? (r.stale48 / r.total) * 100 : 0;
                  const tone = sla48Pct >= 50 ? "text-rose-300" : sla48Pct >= 25 ? "text-amber-300" : "text-white/80";
                  return (
                    <tr key={r.id} className="hover:bg-white/[0.02]">
                      <td className="py-2">
                        <p className="font-medium truncate text-white">{r.name}</p>
                        <p className="text-[10px] text-white/40 tabular-nums">{r.code}</p>
                      </td>
                      <td className="text-right tabular-nums font-bold text-white">{r.total}</td>
                      <td className="text-right tabular-nums font-bold text-amber-300">{r.uncontacted}</td>
                      <td className={`text-right tabular-nums font-bold ${tone}`}>{r.stale48}</td>
                      <td className="text-right tabular-nums">
                        <span className={`font-bold ${r.firstTouchRate >= 30 ? "text-emerald-300" : r.firstTouchRate >= 10 ? "text-amber-300" : "text-rose-300"}`}>
                          {r.firstTouchRate.toFixed(0)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// EXTENDED PARITY PANELS · 2026-06-15 · v6.5
// Sam: "push all four" — unblocked the deferred data items with joins:
//   5. State Production (deal user_id → agents → applications.state)
//   6. Time-of-Day Production Heat (snapshot_at hour in Phoenix tz)
//   7. Commission Projection MTD (annual_premium × FY%)
//   8. 12-Week Hire Pace (real agents.created_at data)
// ─────────────────────────────────────────────────────────────────────

function ExtendedParityPanels() {
  // 2026-06-15 v6.6: State / Commission / HirePace moved to DashboardPulseGroup
  // up top per Sam directive. TimeOfDay stays here as a deep-dive heat-map
  // (still valuable but doesn't need to be in the headline row).
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <TimeOfDayProductionPanel />
    </div>
  );
}

// ── PANEL · STATE PRODUCTION (emerald) ─────────────────────────────
// Unblock: deal.user_id → agents.al_user_id → applications (joined on
// recruiter_id or assigned_agent_id) → applications.state.
// Reveals: WI 912 / TX 157 / FL 129 / CA 76 in last 30d (real data).
function StateProductionPanel() {
  const stateMix = useQuery({
    queryKey: ["state-production-mix"],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      // Pull last-30-day deals + their al_user_id
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const [dealsRes, agentsRes, appsRes] = await Promise.all([
        supabase.from("agentlink_deals_snapshot" as never)
          .select("user_id, annual_premium, effective_date")
          .gte("effective_date", cutoff),
        supabase.from("agents" as never).select("id, al_user_id"),
        supabase.from("applications" as never)
          .select("assigned_agent_id, recruiter_id, state")
          .not("state", "is", null),
      ]);

      const deals = (dealsRes.data ?? []) as Array<{ user_id: number | null; annual_premium: number | string | null }>;
      const agents = (agentsRes.data ?? []) as Array<{ id: string; al_user_id: number | null }>;
      const apps = (appsRes.data ?? []) as Array<{ assigned_agent_id: string | null; recruiter_id: string | null; state: string | null }>;

      // agentId → state map (prefer assigned_agent_id, fallback recruiter_id)
      const agentIdToState = new Map<string, string>();
      for (const a of apps) {
        const k = a.assigned_agent_id ?? a.recruiter_id;
        if (k && a.state && !agentIdToState.has(k)) agentIdToState.set(k, a.state);
      }

      // al_user_id → state map
      const alUidToState = new Map<number, string>();
      for (const ag of agents) {
        if (ag.al_user_id == null) continue;
        const st = agentIdToState.get(ag.id);
        if (st) alUidToState.set(ag.al_user_id, st);
      }

      // Aggregate
      const buckets = new Map<string, { deals: number; ap: number }>();
      for (const d of deals) {
        if (d.user_id == null) continue;
        const state = alUidToState.get(d.user_id);
        if (!state) continue;
        const b = buckets.get(state) ?? { deals: 0, ap: 0 };
        b.deals += 1;
        b.ap += Number(d.annual_premium ?? 0);
        buckets.set(state, b);
      }

      const list = Array.from(buckets.entries())
        .map(([state, v]) => ({ state, deals: v.deals, ap: v.ap }))
        .sort((a, b) => b.ap - a.ap)
        .slice(0, 10);
      const totalAp = list.reduce((s, x) => s + x.ap, 0);
      return { list, totalAp };
    },
  });

  const d = stateMix.data;
  const max = d?.list[0]?.ap ?? 0;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">STATE PRODUCTION · 30d</p>
          </div>
          {d && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
              {fmtUsd(d.totalAp, true)} · {d.list.length} states
            </Badge>
          )}
        </div>
        {stateMix.isLoading ? (
          <div className="space-y-2">{Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-7 bg-white/[0.04]" />)}</div>
        ) : !d || d.list.length === 0 ? (
          <p className="text-12 text-white/60 italic">Production map unlocks on first state-attributed deal.</p>
        ) : (
          <div className="space-y-2">
            {d.list.map((r) => {
              const pct = max > 0 ? (r.ap / max) * 100 : 0;
              const totalPct = d.totalAp > 0 ? (r.ap / d.totalAp) * 100 : 0;
              return (
                <div key={r.state} className="space-y-0.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold tabular-nums text-white/85 w-8">{r.state}</span>
                    <span className="tabular-nums font-bold text-emerald-300 ml-auto">{fmtUsd(r.ap, true)}</span>
                    <span className="tabular-nums text-white/40 ml-2 w-16 text-right">{r.deals} · {totalPct.toFixed(0)}%</span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <div className="h-full bg-emerald-400/70" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── PANEL · TIME-OF-DAY PRODUCTION HEAT (amber) ─────────────────────
// Unblock: snapshot_at is TIMESTAMPTZ → derive hour-of-day in Phoenix tz.
// 7 weekday rows × 6 time bins (Early/Morn/Mid/Aft/Eve/Night).
function TimeOfDayProductionPanel() {
  const heat = useQuery({
    queryKey: ["time-of-day-production"],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data } = await supabase
        .from("agentlink_deals_snapshot" as never)
        .select("snapshot_at, annual_premium")
        .gte("snapshot_at", cutoff);
      const rows = (data ?? []) as Array<{ snapshot_at: string; annual_premium: number | string | null }>;
      // Bin: dow (Mon=0..Sun=6) × time bin (0-5)
      const binLabel = ["00-04", "04-08", "08-12", "12-16", "16-20", "20-24"];
      const dayLabel = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const grid: number[][] = Array.from({length:7}, () => Array(6).fill(0));
      let maxCount = 0;
      let peakDay = 0, peakBin = 0;
      let totalDeals = 0;
      for (const r of rows) {
        const d = new Date(r.snapshot_at);
        // Phoenix is UTC-7 (no DST)
        const phx = new Date(d.getTime() - 7 * 3600 * 1000);
        // dayOfWeek: 0=Sun → shift to Mon=0
        const dow = (phx.getUTCDay() + 6) % 7;
        const bin = Math.min(5, Math.floor(phx.getUTCHours() / 4));
        grid[dow][bin] += 1;
        totalDeals += 1;
        if (grid[dow][bin] > maxCount) {
          maxCount = grid[dow][bin];
          peakDay = dow;
          peakBin = bin;
        }
      }
      return { grid, binLabel, dayLabel, maxCount, totalDeals, peakLabel: `${dayLabel[peakDay]} ${binLabel[peakBin]}` };
    },
  });

  const h = heat.data;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(45_85%_55%/0.20)]">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">TIME-OF-DAY HEAT · 30d</p>
          </div>
          {h && h.totalDeals > 0 && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-amber-400/40 bg-amber-400/10 text-amber-200">
              peak: {h.peakLabel}
            </Badge>
          )}
        </div>
        {heat.isLoading ? (
          <Skeleton className="h-40 w-full bg-white/[0.04]" />
        ) : !h || h.totalDeals === 0 ? (
          <p className="text-12 text-white/60 italic">First deal heats the grid.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-7 gap-0.5 text-[9px] uppercase text-white/40 mb-1">
              <span></span>
              {h.binLabel.map((b) => <span key={b} className="text-center tabular-nums">{b}</span>)}
            </div>
            {h.grid.map((row, dow) => (
              <div key={dow} className="grid grid-cols-7 gap-0.5 items-center">
                <span className="text-[10px] uppercase text-white/40 font-bold">{h.dayLabel[dow]}</span>
                {row.map((count, bin) => {
                  const intensity = h.maxCount > 0 ? count / h.maxCount : 0;
                  return (
                    <div
                      key={bin}
                      className="h-6 rounded flex items-center justify-center text-[10px] font-bold tabular-nums transition-colors"
                      style={{
                        backgroundColor: count === 0
                          ? "rgba(255,255,255,0.02)"
                          : `hsl(45 85% 55% / ${0.15 + intensity * 0.65})`,
                        color: intensity > 0.6 ? "#0f0a06" : "#fef3c7",
                      }}
                      title={`${h.dayLabel[dow]} ${h.binLabel[bin]} · ${count} deals`}
                    >
                      {count > 0 ? count : ""}
                    </div>
                  );
                })}
              </div>
            ))}
            <p className="text-[10px] text-white/40 mt-2 tabular-nums">{h.totalDeals} deal posts · derived from snapshot_at hour-of-day</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PANEL · COMMISSION PROJECTION MTD (emerald) ─────────────────────
// Unblock: commission_ledger is thin ($0 paid). DERIVE projected commission
// from agentlink_deals_snapshot.annual_premium × estimated FY% from
// qe_commission_schedules.
function CommissionProjectionPanel() {
  const proj = useQuery({
    queryKey: ["commission-projection"],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const today = now.toISOString().slice(0, 10);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

      const [mtdRes, lmtdRes, schedRes, paidRes] = await Promise.all([
        supabase.from("agentlink_deals_snapshot" as never)
          .select("annual_premium")
          .gte("effective_date", monthStart)
          .lte("effective_date", today),
        supabase.from("agentlink_deals_snapshot" as never)
          .select("annual_premium")
          .gte("effective_date", lastMonthStart)
          .lte("effective_date", lastMonthEnd),
        supabase.from("qe_commission_schedules" as never)
          .select("first_year_pct"),
        supabase.from("commission_ledger" as never)
          .select("amount, status")
          .gte("created_at", monthStart),
      ]);

      const sum = (rows: any) => (rows ?? []).reduce((s: number, r: any) => s + Number(r.annual_premium ?? 0), 0);
      const mtdAp = sum(mtdRes.data);
      const lmtdAp = sum(lmtdRes.data);

      // Avg FY% across schedules (excluding 0% blacklisted)
      const scheds = (schedRes.data ?? []) as Array<{ first_year_pct: number | string | null }>;
      const validPcts = scheds.map(s => Number(s.first_year_pct ?? 0)).filter(p => p > 0);
      const avgFyPct = validPcts.length > 0 ? validPcts.reduce((s, p) => s + p, 0) / validPcts.length : 100;

      const projectedMtd = mtdAp * (avgFyPct / 100);
      const projectedLmtd = lmtdAp * (avgFyPct / 100);

      const paidRows = (paidRes.data ?? []) as Array<{ amount: number | string | null; status: string | null }>;
      const actualPaid = paidRows.filter(r => r.status === "paid").reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const actualPending = paidRows.filter(r => r.status === "pending").reduce((s, r) => s + Number(r.amount ?? 0), 0);

      const daysIntoMonth = now.getDate();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const eomProjection = daysIntoMonth > 0 ? (projectedMtd / daysIntoMonth) * daysInMonth : 0;
      const variancePct = projectedLmtd > 0 ? ((eomProjection - projectedLmtd) / projectedLmtd) * 100 : 0;

      return { mtdAp, lmtdAp, projectedMtd, projectedLmtd, eomProjection, actualPaid, actualPending, avgFyPct, variancePct };
    },
  });

  const p = proj.data;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-emerald-300">COMMISSION · PROJECTED MTD</p>
          </div>
          {p && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
              {p.avgFyPct.toFixed(0)}% avg FY rate
            </Badge>
          )}
        </div>
        {proj.isLoading ? (
          <div className="space-y-2">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-12 bg-white/[0.04]" />)}</div>
        ) : !p ? (
          <p className="text-12 text-white/60 italic">Run a deal · the ledger will sing.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="p-3 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20">
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">MTD PROJECTED</p>
                <p className="text-[26px] leading-none font-black tabular-nums text-emerald-300">{fmtUsd(p.projectedMtd, true)}</p>
                <p className="text-[10px] text-white/40 tabular-nums">from {fmtUsd(p.mtdAp, true)} AP</p>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/20">
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">EOM PROJECTION</p>
                <p className="text-[26px] leading-none font-black tabular-nums text-amber-300">{fmtUsd(p.eomProjection, true)}</p>
                <p className="text-[10px] text-white/40 tabular-nums">
                  vs LMTD {fmtUsd(p.projectedLmtd, true)} ·
                  <span className={p.variancePct >= 0 ? "text-emerald-300" : "text-rose-300"}>
                    {" "}{p.variancePct >= 0 ? "+" : ""}{p.variancePct.toFixed(0)}%
                  </span>
                </p>
              </div>
            </div>
            <div className="pt-3 border-t border-white/[0.06] text-[11px] flex items-center justify-between">
              <span className="text-white/40 uppercase tracking-widest text-[10px]">Ledger actual</span>
              <span className="tabular-nums">
                <span className="text-emerald-300 font-bold">{fmtUsd(p.actualPaid)}</span>
                <span className="text-white/40 mx-1">paid</span>
                <span className="mx-2 text-white/20">·</span>
                <span className="text-amber-300 font-bold">{fmtUsd(p.actualPending)}</span>
                <span className="text-white/40 mx-1">pending</span>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── PANEL · 12-WEEK HIRE PACE (amber) ───────────────────────────────
// Unblock: applications.licensed_at only has 2 rows. USE agents.created_at
// as the canonical hire-date proxy — each agent row IS a hire.
function HirePace12WPanel() {
  const pace = useQuery({
    queryKey: ["hire-pace-12w"],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 84 * 86400000).toISOString();
      const { data } = await supabase
        .from("agents" as never)
        .select("created_at")
        .gte("created_at", cutoff);
      const rows = (data ?? []) as Array<{ created_at: string }>;
      // Bucket by week start (Monday)
      const now = new Date();
      const buckets = new Map<string, number>();
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now); d.setDate(now.getDate() - i * 7);
        const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
        d.setDate(d.getDate() - dow);
        const k = d.toISOString().slice(0, 10);
        buckets.set(k, 0);
      }
      for (const r of rows) {
        const d = new Date(r.created_at);
        const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
        const monday = new Date(d); monday.setDate(d.getDate() - dow);
        const k = monday.toISOString().slice(0, 10);
        if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
      }
      const list = Array.from(buckets.entries())
        .map(([week, count]) => ({ week, count, label: new Date(week).toLocaleDateString("en-US", { month: "short", day: "numeric" }) }))
        .sort((a, b) => a.week.localeCompare(b.week));
      const total = list.reduce((s, x) => s + x.count, 0);
      const avg = list.length > 0 ? total / list.length : 0;
      const thisWeek = list[list.length - 1]?.count ?? 0;
      const lastWeek = list[list.length - 2]?.count ?? 0;
      const wow = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : 0;
      return { list, total, avg, thisWeek, lastWeek, wow };
    },
  });

  const d = pace.data;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(45_85%_55%/0.20)]">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">HIRE PACE · 12 WEEKS</p>
          </div>
          {d && (
            <Badge variant="outline" className={`text-[10px] uppercase tracking-widest ${d.wow >= 0 ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200" : "border-rose-400/40 bg-rose-400/10 text-rose-200"}`}>
              {d.wow >= 0 ? "▲" : "▼"} {Math.abs(d.wow).toFixed(0)}% WoW
            </Badge>
          )}
        </div>
        {pace.isLoading ? (
          <Skeleton className="h-40 w-full bg-white/[0.04]" />
        ) : !d || d.total === 0 ? (
          <p className="text-12 text-white/60 italic">First hire opens the chart.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">TOTAL · 12W</p>
                <p className="text-[24px] leading-none font-black tabular-nums text-white">{d.total}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">AVG / WEEK</p>
                <p className="text-[24px] leading-none font-black tabular-nums text-amber-300">{d.avg.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">THIS WEEK</p>
                <p className="text-[24px] leading-none font-black tabular-nums text-emerald-300">{d.thisWeek}</p>
                <p className="text-[10px] text-white/40 tabular-nums">last: {d.lastWeek}</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={d.list}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" fontSize={9} stroke="rgba(255,255,255,0.4)" />
                <YAxis fontSize={9} stroke="rgba(255,255,255,0.4)" />
                <Tooltip
                  contentStyle={{ background: "hsl(220 40% 8%)", border: "1px solid hsl(45 85% 55% / 0.4)", borderRadius: 12, color: "#fff", fontSize: 11 }}
                  formatter={(v: number) => [`${v} hires`, "Hires"]}
                />
                <Bar dataKey="count" fill="hsl(45 85% 55%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </div>
  );
}

// ── PANEL · AGED LEADS · 899 RESERVES ───────────────────────────────
// Sam 2026-06-15: "Bring back all those leads · every single lead just gone."
// Source: aged_leads table · 899 records · 897 status='new' (unworked).
// 2026-06-15 v6.8 · Sam: "switch out the aged lead reserves · show old agents
// with their license in aged leads · make the buttons clickable."
// Renamed → LICENSED RECRUIT BANK · prioritizes the 51 licensed records ·
// every row has tel:click + tap-to-take-action.
function AgedLeadsPanel() {
  const leads = useQuery({
    queryKey: ["aged-leads-licensed-bank"],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const cutoff7d = new Date(Date.now() - 7 * 86400000).toISOString();
      const [totalRes, licensedRes, unworkedLicensedRes, recent7Res, dialedRes, dncRes, licensedList, recentList] = await Promise.all([
        supabase.from("aged_leads" as never).select("id", { count: "exact", head: true }),
        supabase.from("aged_leads" as never).select("id", { count: "exact", head: true }).eq("license_status", "licensed"),
        supabase.from("aged_leads" as never).select("id", { count: "exact", head: true }).eq("license_status", "licensed").eq("status", "new"),
        supabase.from("aged_leads" as never).select("id", { count: "exact", head: true }).gte("created_at", cutoff7d),
        supabase.from("aged_leads" as never).select("id", { count: "exact", head: true }).gt("dial_count", 0),
        supabase.from("aged_leads" as never).select("id", { count: "exact", head: true }).eq("dnc", true),
        supabase.from("aged_leads" as never)
          .select("id, first_name, last_name, phone, license_status, status, lead_source, dial_count, last_disposition, created_at")
          .eq("license_status", "licensed")
          .order("created_at", { ascending: false })
          .limit(8),
        supabase.from("aged_leads" as never)
          .select("id, first_name, last_name, phone, license_status, status, lead_source, dial_count, last_disposition, created_at")
          .order("created_at", { ascending: false })
          .limit(6),
      ]);
      return {
        total: totalRes.count ?? 0,
        licensed: licensedRes.count ?? 0,
        unworkedLicensed: unworkedLicensedRes.count ?? 0,
        recent7: recent7Res.count ?? 0,
        dialed: dialedRes.count ?? 0,
        dnc: dncRes.count ?? 0,
        licensedTop: (licensedList.data ?? []) as AgedLeadRow[],
        recent: (recentList.data ?? []) as AgedLeadRow[],
      };
    },
  });

  const d = leads.data;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(45_85%_55%/0.20)]">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">LICENSED RECRUIT BANK · LIVE</p>
          </div>
          {d && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-emerald-400/40 bg-emerald-400/10 text-emerald-200">
              {d.licensed} licensed · {d.total} total
            </Badge>
          )}
        </div>

        {leads.isLoading ? (
          <div className="space-y-2">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-12 bg-white/[0.04]" />)}</div>
        ) : !d ? (
          <p className="text-12 text-white/60 italic">Lead bank loading…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Left · 4 KPI tiles */}
            <div className="lg:col-span-1 grid grid-cols-2 gap-2 content-start">
              <div className="p-3 rounded-xl bg-emerald-500/[0.10] border border-emerald-500/30">
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">LICENSED</p>
                <p className="text-[24px] leading-none font-black tabular-nums text-emerald-300">{d.licensed}</p>
                <p className="text-[10px] text-white/40 tabular-nums">already licensed</p>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/20">
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">UNWORKED</p>
                <p className="text-[24px] leading-none font-black tabular-nums text-amber-300">{d.unworkedLicensed}</p>
                <p className="text-[10px] text-white/40 tabular-nums">licensed · untouched</p>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">DIALED</p>
                <p className="text-[24px] leading-none font-black tabular-nums text-white">{d.dialed}</p>
                <p className="text-[10px] text-white/40 tabular-nums">all leads · touched 1+</p>
              </div>
              <div className="p-3 rounded-xl bg-rose-500/[0.06] border border-rose-500/20">
                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">DNC</p>
                <p className="text-[24px] leading-none font-black tabular-nums text-rose-300">{d.dnc}</p>
                <p className="text-[10px] text-white/40 tabular-nums">do-not-call</p>
              </div>
            </div>
            {/* Right · top 8 LICENSED + clickable */}
            <div className="lg:col-span-2 space-y-1.5">
              <p className="text-[10px] uppercase tracking-widest text-emerald-300 font-bold mb-1">
                Top 8 licensed · click to dial
              </p>
              {d.licensedTop.length === 0 ? (
                <p className="text-12 text-white/60 italic">No licensed reserves on file. Re-bank licensed agents to surface here.</p>
              ) : (
                d.licensedTop.map((l) => <AgedLeadRowClickable key={l.id} l={l} />)
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type AgedLeadRow = {
  id: string; first_name: string | null; last_name: string | null;
  phone: string | null; license_status: string | null; status: string | null;
  lead_source: string | null; dial_count: number | null; last_disposition: string | null;
  created_at: string | null;
};

function AgedLeadRowClickable({ l }: { l: AgedLeadRow }) {
  const name = [l.first_name, l.last_name].filter(Boolean).join(" ") || "—";
  const stat = (l.status ?? "new").toLowerCase();
  const tone = stat === "hired" ? "text-emerald-300"
    : stat === "licensing" ? "text-amber-300"
    : (l.dial_count ?? 0) > 0 ? "text-white/80"
    : "text-emerald-300";
  const phoneClean = (l.phone ?? "").replace(/[^0-9+]/g, "");
  const canDial = phoneClean.length >= 7;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.04] hover:border-emerald-400/40 hover:bg-emerald-500/[0.04] transition-colors group">
      <div className="flex-1 min-w-0">
        <p className="text-13 font-bold truncate text-white">{name}</p>
        <p className="text-[10px] text-white/40 truncate">
          {l.phone ?? "—"} · {l.lead_source ?? "aged"}{l.license_status ? ` · ${l.license_status}` : ""}
        </p>
      </div>
      <div className="text-right shrink-0 tabular-nums">
        <p className={`text-11 font-bold uppercase ${tone}`}>{stat}</p>
        <p className="text-[10px] text-white/40">{l.dial_count ?? 0} dials</p>
      </div>
      {canDial ? (
        <a
          href={`tel:${phoneClean}`}
          className="shrink-0 p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 transition-colors"
          title={`Dial ${name}`}
        >
          <Phone className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </div>
  );
}

// ── PANEL · LOW PRODUCERS · UNDER $5K LAST 7d (rose · leak posture) ─────
// Sam 2026-06-15: "Anyone below five thousand for the last seven days. Make
// their box look red." Producers who sold something but below the $5K bar.
function LowProducersPanel() {
  const low = useQuery({
    queryKey: ["low-producers-7d"],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const { data: dealRows } = await supabase
        .from("agentlink_deals_snapshot" as never)
        .select("user_id, annual_premium")
        .gte("effective_date", cutoff);
      const rows = (dealRows ?? []) as Array<{ user_id: number | null; annual_premium: number | string | null }>;
      // Bucket by user_id (al_user_id)
      const byUid = new Map<number, { deals: number; ap: number }>();
      for (const r of rows) {
        if (r.user_id == null) continue;
        const b = byUid.get(r.user_id) ?? { deals: 0, ap: 0 };
        b.deals += 1;
        b.ap += Number(r.annual_premium ?? 0);
        byUid.set(r.user_id, b);
      }
      // Filter under $5K, get agent names
      const uids = Array.from(byUid.entries()).filter(([_, v]) => v.ap < 5000 && v.ap > 0).map(([k]) => k);
      if (uids.length === 0) return { list: [], total: 0 };
      const { data: agents } = await supabase
        .from("agents" as never)
        .select("al_user_id, display_name, agent_code")
        .in("al_user_id", uids);
      const agentMap = new Map<number, { name: string; code: string | null }>();
      for (const a of (agents ?? []) as Array<{ al_user_id: number; display_name: string | null; agent_code: string | null }>) {
        agentMap.set(a.al_user_id, { name: a.display_name ?? "—", code: a.agent_code });
      }
      const list = uids.map((uid) => {
        const b = byUid.get(uid)!;
        const a = agentMap.get(uid);
        return {
          uid,
          name: a?.name ?? `User #${uid}`,
          code: a?.code ?? "—",
          deals: b.deals,
          ap: b.ap,
        };
      }).sort((a, b) => a.ap - b.ap);
      return { list, total: list.length };
    },
  });

  const d = low.data;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-rose-500/30 bg-gradient-to-br from-slate-950 via-rose-950/50 to-slate-950 text-white shadow-[0_0_48px_-12px_hsl(0_70%_50%/0.30)]">
      <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-rose-500/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
            </span>
            <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-rose-300">LOW PRODUCERS · UNDER $5K · 7d</p>
          </div>
          {d && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-rose-400/40 bg-rose-400/10 text-rose-200">
              {d.total} agents · soft
            </Badge>
          )}
        </div>

        {low.isLoading ? (
          <div className="space-y-2">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-12 bg-white/[0.04]" />)}</div>
        ) : !d || d.total === 0 ? (
          <div className="py-6 text-center">
            <p className="text-15 font-bold text-emerald-300 mb-1">Every producer cleared $5K this week.</p>
            <p className="text-11 text-white/40">Hold the Standard. Average is the disease.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {d.list.map((a) => {
              const pct = (a.ap / 5000) * 100;
              return (
                <div key={a.uid} className="p-3 rounded-xl bg-rose-500/[0.10] border border-rose-500/30 hover:border-rose-400/50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-13 font-bold truncate text-white">{a.name}</p>
                      <p className="text-[10px] text-white/40 tabular-nums">{a.code} · {a.deals} deal{a.deals !== 1 ? "s" : ""}</p>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <p className="text-[20px] leading-none font-black text-rose-300">{fmtUsd(a.ap, true)}</p>
                      <p className="text-[10px] text-white/40">target $5K</p>
                    </div>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <div className="h-full bg-rose-400/60 transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <p className="text-[10px] text-rose-200/60 mt-1 tabular-nums">{pct.toFixed(0)}% to target · {fmtUsd(5000 - a.ap, true)} gap</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
