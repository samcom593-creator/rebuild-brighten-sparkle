import { useEffect, useState, useMemo, useCallback } from "react";
import { toast } from "sonner";

import {
  Users,
  Phone,
  CheckCircle,
  Award,
  Percent,
  MapPin,
  TrendingUp,
  DollarSign,
  UserPlus,
  Edit3,
  BarChart3,
  Sparkles,
  ChevronDown,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ActivationRiskBanner } from "@/components/dashboard/ActivationRiskBanner";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/dashboard/StatCard";
import { GrowthChart } from "@/components/dashboard/GrowthChart";
import { AnalyticsPieChart } from "@/components/dashboard/AnalyticsPieChart";
import { ManagerTeamView } from "@/components/dashboard/ManagerTeamView";

import { LeaderboardTabs } from "@/components/dashboard/LeaderboardTabs";
import { ClosingRateLeaderboard } from "@/components/dashboard/ClosingRateLeaderboard";
import { ReferralLeaderboard } from "@/components/dashboard/ReferralLeaderboard";
import { TeamSnapshotCard } from "@/components/dashboard/TeamSnapshotCard";
import { TeamPerformanceBreakdown } from "@/components/dashboard/TeamPerformanceBreakdown";
import { OnboardingPipelineCard } from "@/components/dashboard/OnboardingPipelineCard";
import { RecruitingQuickView } from "@/components/dashboard/RecruitingQuickView";
import { StreakBanner } from "@/components/celebrations/StreakBanner";
import { LivePulse } from "@/components/dashboard/LivePulse";
import { FocusNow } from "@/components/dashboard/FocusNow";
import { ForecastCard } from "@/components/dashboard/ForecastCard";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
import { PageLoadingSkeleton } from "@/components/ui/page-loading-skeleton";
import { DatePeriodSelector, type DatePeriod } from "@/components/ui/date-period-selector";

import { TotalApplicationsBanner } from "@/components/dashboard/TotalApplicationsBanner";
import { EstimatedEarningsCard } from "@/components/dashboard/EstimatedEarningsCard";
import { TeamOverviewDashboard } from "@/components/dashboard/TeamOverviewDashboard";

import { ChurnRiskBanner } from "@/components/dashboard/ChurnRiskBanner";
import { AchievementFeed } from "@/components/dashboard/AchievementFeed";
import { TeamTasksWidget } from "@/components/dashboard/TeamTasksWidget";
import { AwardFeedLive } from "@/components/dashboard/AwardFeedLive";
import { AddAgentModal } from "@/components/dashboard/AddAgentModal";
import { DashboardInsightCards } from "@/components/dashboard/DashboardInsightCards";
import { AgentPersonalDashboard } from "@/components/dashboard/AgentPersonalDashboard";
import { useMyDownline } from "@/hooks/useMyDownline";

import { StalledAgentsAlert } from "@/components/dashboard/StalledAgentsAlert";
import { ReferralTrackingCard } from "@/components/dashboard/ReferralTrackingCard";
import { StatCardDrilldown } from "@/components/dashboard/StatCardDrilldown";
import { HideableCard } from "@/components/dashboard/HideableCard";
import { HiddenCardsManager } from "@/components/dashboard/HiddenCardsManager";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSoundEffects } from "@/hooks/useSoundEffects";

const HIDEABLE_CARDS: Record<string, string> = {
  "dashboard.insight-cards": "Insight Cards",
  "dashboard.applications-banner": "Total Applications Banner",
  "dashboard.churn-risk": "Churn Risk Banner",
  "dashboard.team-snapshot": "Production Snapshot",
  "dashboard.activation-risk": "Activation Risk Banner",
  "dashboard.team-overview": "Team Overview",
  "dashboard.performance-breakdown": "Performance Breakdown",
  "dashboard.top-producers": "Top Producers Section",
  "dashboard.recruiting": "Recruiting & Growth Section",
  "dashboard.team-view": "Your Team",
  "dashboard.achievement-feed": "Achievements & Tasks",
};

interface DashboardStats {
  totalLeads: number;
  contacted: number;
  closed: number;
  licensed: number;
  unlicensed: number;
  closeRate: number;
  avgWaitTime: number;
  growthPercent: number;
  staleLeads: number;
}

const defaultStats: DashboardStats = {
  totalLeads: 0,
  contacted: 0,
  closed: 0,
  licensed: 0,
  unlicensed: 0,
  closeRate: 0,
  avgWaitTime: 0,
  growthPercent: 0,
  staleLeads: 0,
};

const emptyChartData: Array<{ label: string; leads: number; closed: number }> = [];
const emptySourceData: Array<{ name: string; value: number; color: string }> = [];

async function fetchDashboardData(
  userId: string,
  profileName: string | null | undefined,
  userEmail: string | undefined,
  dateRange: { start: Date; end: Date },
  myDirectsOnly: boolean,
) {
  const userName = profileName || userEmail?.split("@")[0] || "Agent";

  const { data: agentData } = await supabase
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!agentData) {
    return { stats: defaultStats, dailyData: emptyChartData, weeklyData: emptyChartData, monthlyData: emptyChartData, sourceData: emptySourceData, userName, currentAgentId: undefined, previousPeriodLeads: 0 };
  }

  let query = supabase
    .from("applications")
    .select("id, created_at, contacted_at, closed_at, license_status, referral_source, assigned_agent_id, terminated_at");

  if (myDirectsOnly) {
    query = query.eq("assigned_agent_id", agentData.id);
  }

  const { data: allApplications } = await query;

  if (!allApplications || allApplications.length === 0) {
    return { stats: defaultStats, dailyData: emptyChartData, weeklyData: emptyChartData, monthlyData: emptyChartData, sourceData: emptySourceData, userName, currentAgentId: agentData.id, previousPeriodLeads: 0 };
  }

  // Filter by selected date range for stats
  const applications = allApplications.filter(a => {
    const d = new Date(a.created_at);
    return d >= dateRange.start && d <= dateRange.end;
  });

  const totalLeads = applications.length;
  const contacted = applications.filter(a => a.contacted_at).length;
  const closed = applications.filter(a => a.closed_at).length;
  const licensed = applications.filter(a => a.license_status === "licensed").length;
  const unlicensed = applications.filter(a => a.license_status !== "licensed").length;

  const now = new Date();
  const staleLeads = applications.filter(a => {
    if (a.contacted_at) return false;
    const createdAt = new Date(a.created_at);
    return (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60) > 48;
  }).length;

  let totalWaitTime = 0;
  let countWithContact = 0;
  applications
    .filter(a => a.license_status === "licensed" && a.contacted_at)
    .forEach(a => {
      const created = new Date(a.created_at);
      const contactedDate = new Date(a.contacted_at!);
      totalWaitTime += (contactedDate.getTime() - created.getTime()) / (1000 * 60 * 60);
      countWithContact++;
    });

  // Growth comparison: current period vs same-length previous period
  const periodLength = dateRange.end.getTime() - dateRange.start.getTime();
  const prevStart = new Date(dateRange.start.getTime() - periodLength);
  const prevEnd = new Date(dateRange.start.getTime());

  const currentPeriodLeads = applications.length;
  const previousPeriodLeads = allApplications.filter(a => {
    const date = new Date(a.created_at);
    return date >= prevStart && date < prevEnd;
  }).length;

  const growthPercent = previousPeriodLeads > 0
    ? ((currentPeriodLeads - previousPeriodLeads) / previousPeriodLeads) * 100
    : currentPeriodLeads > 0 ? 100 : 0;

  const stats: DashboardStats = {
    totalLeads, contacted, closed, licensed, unlicensed,
    closeRate: totalLeads > 0 ? (closed / totalLeads) * 100 : 0,
    avgWaitTime: countWithContact > 0 ? totalWaitTime / countWithContact : 0,
    growthPercent: Math.round(growthPercent),
    staleLeads,
  };

  // Daily chart data
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    return date;
  });
  const dailyData = last7Days.map(date => {
    const dayApps = applications.filter(a => new Date(a.created_at).toDateString() === date.toDateString());
    return { label: dayNames[date.getDay()], leads: dayApps.length, closed: dayApps.filter(a => a.closed_at).length };
  });

  // Weekly chart data
  const weeklyData = Array.from({ length: 4 }, (_, i) => {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((3 - i) * 7 + 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekApps = applications.filter(a => {
      const appDate = new Date(a.created_at);
      return appDate >= weekStart && appDate < weekEnd;
    });
    return { label: `Week ${i + 1}`, leads: weekApps.length, closed: weekApps.filter(a => a.closed_at).length };
  });

  // Monthly chart data
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - i));
    const monthApps = applications.filter(a => {
      const appDate = new Date(a.created_at);
      return appDate.getMonth() === date.getMonth() && appDate.getFullYear() === date.getFullYear();
    });
    return { label: monthNames[date.getMonth()], leads: monthApps.length, closed: monthApps.filter(a => a.closed_at).length };
  });

  // Source data
  const sourceMap = new Map<string, number>();
  applications.forEach(a => {
    const source = a.referral_source || 'Direct';
    sourceMap.set(source, (sourceMap.get(source) || 0) + 1);
  });
  const colors = ["hsl(168, 84%, 42%)", "hsl(160, 84%, 39%)", "hsl(45, 93%, 58%)", "hsl(222, 47%, 40%)", "hsl(220, 15%, 50%)"];
  const sourceData = Array.from(sourceMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value], i) => ({ name, value, color: colors[i % colors.length] }));

  return {
    stats,
    dailyData,
    weeklyData,
    monthlyData,
    sourceData: sourceData.length > 0 ? sourceData : [{ name: "No data yet", value: 1, color: "hsl(222, 30%, 30%)" }],
    userName,
    currentAgentId: agentData.id,
    previousPeriodLeads,
  };
}

import { Shield, Settings, Send, KeyRound, ShoppingCart, Activity, AlertCircle, Flame, UserX, RefreshCw, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const quickActions = [
  { to: "/numbers", icon: Edit3, color: "primary", title: "Log Numbers", sub: "Enter today's stats" },
  { to: "/agent-portal", icon: BarChart3, color: "violet-500", title: "Agent Dashboard", sub: "View performance" },
  { to: "/dashboard/crm", icon: Users, color: "emerald-500", title: "CRM", sub: "Manage agents" },
  { to: "/dashboard/applicants", icon: Sparkles, color: "amber-500", title: "Pipeline", sub: "View applicants" },
] as const;

const adminQuickActions = [
  { to: "/dashboard/command", icon: Shield, color: "red-500", title: "Command Center", sub: "Full admin control" },
  { to: "/dashboard/accounts", icon: Settings, color: "indigo-500", title: "Accounts", sub: "Manage accounts" },
] as const;

export default function Dashboard() {
  const { profile, user, isManager, isAdmin, isAgent, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { playSound } = useSoundEffects();
  const [datePeriod, setDatePeriod] = useState<DatePeriod>("month");
  const [activeDrilldown, setActiveDrilldown] = useState<"agents" | "alp" | "apps" | "closerate" | null>(null);
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    end: new Date(),
  });

  const handleDatePeriodChange = useCallback((period: DatePeriod, range: { start: Date; end: Date }) => {
    setDatePeriod(period);
    setDateRange(range);
  }, []);

  const [myDirectsOnly, setMyDirectsOnly] = useState(false);

  // Hierarchy scope: managers see only their downline
  const { data: myDownlineIds = [] } = useMyDownline();

  // Fetch top-row real metrics, scoped by viewer.
  // SOURCES (Agent Link truth, not manual logs):
  //   - Active Agents: count of distinct agent_id with a deal in last 30d (deals table)
  //   - Weekly ALP: SUM(deals.annual_premium) this week by effective_date
  //   - Close Rate: deals count / daily_production.presentations
  //       (presentations has no other source; deals have to be Agent Link truth)
  const { data: topMetrics } = useQuery({
    queryKey: ["dashboard-top-metrics-v2-deals", isAdmin ? "agency" : "downline", myDownlineIds.join(",")],
    queryFn: async () => {
      const now = new Date();
      const weekStart = new Date(now);
      const day = now.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      weekStart.setDate(now.getDate() + diffToMonday);
      weekStart.setHours(0, 0, 0, 0);
      const weekStartStr = weekStart.toISOString().split("T")[0];

      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

      const shouldScope = !isAdmin && myDownlineIds.length > 0;

      // Deals-based queries (Agent Link truth)
      let activeQ  = supabase.from("deals").select("agent_id").gte("effective_date", thirtyDaysAgoStr);
      let weekDealsQ = supabase.from("deals").select("annual_premium, agent_id").gte("effective_date", weekStartStr);
      let presQ    = supabase.from("daily_production").select("presentations, agent_id").gte("production_date", weekStartStr);
      let appsQ    = supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", weekStart.toISOString());

      if (shouldScope) {
        activeQ     = activeQ.in("agent_id", myDownlineIds);
        weekDealsQ  = weekDealsQ.in("agent_id", myDownlineIds);
        presQ       = presQ.in("agent_id", myDownlineIds);
        appsQ       = appsQ.or(`assigned_agent_id.in.(${myDownlineIds.join(",")}),hiring_manager_user_id.eq.${user?.id}`);
      }

      const [activeRes, weekDealsRes, presRes, appsRes] = await Promise.all([activeQ, weekDealsQ, presQ, appsQ]);

      const activeAgentIds = new Set((activeRes.data || []).map((r: any) => r.agent_id).filter(Boolean));
      const weeklyALP      = (weekDealsRes.data || []).reduce((s: number, r: any) => s + (Number(r.annual_premium) || 0), 0);
      const totalDeals     = (weekDealsRes.data || []).length;
      const totalPres      = (presRes.data || []).reduce((s: number, r: any) => s + (Number(r.presentations) || 0), 0);
      const rawCloseRate   = totalPres > 0 ? (totalDeals / totalPres) * 100 : 0;
      // Cap the DISPLAYED rate at 100 — a 120%+ number means agents are
      // writing deals without logging presentations, not that they're
      // closing harder than physics allows. Keep the raw value around so
      // the UI can warn.
      const cappedCloseRate    = Math.min(rawCloseRate, 100);
      const presentationsUnderLogged = totalDeals > 0 && totalDeals > totalPres;

      return {
        activeAgents: activeAgentIds.size,
        weeklyALP,
        appsThisWeek: appsRes.count || 0,
        closeRate: Math.round(cappedCloseRate * 10) / 10,
        rawCloseRate: Math.round(rawCloseRate * 10) / 10,
        presentationsUnderLogged,
        totalDeals,
        totalPres,
        scope: shouldScope ? "team" : "agency",
      };
    },
    enabled: !!user && !authLoading && (isAdmin || myDownlineIds.length > 0),
    staleTime: 60000,
  });

  // Agents flagged only when they've done NEITHER in the last 7 days:
  //   - Logged numbers in daily_production
  //   - Closed a deal (deals table, Agent Link truth)
  // Previously this was daily_production-only, so producers who just
  // don't self-report activity were getting wrongly flagged even when
  // Agent Link showed them with fresh deals.
  const { data: staleAgents } = useQuery({
    queryKey: ["dashboard-stale-agents-v2"],
    queryFn: async () => {
      if (!isAdmin) return [];
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const cutoff = sevenDaysAgo.toISOString().split("T")[0];

      const { data: agents } = await supabase
        .from("agents")
        .select("id, display_name, profiles:profile_id(full_name)")
        .eq("is_deactivated", false)
        .eq("is_inactive", false)
        .eq("status", "active");

      if (!agents || agents.length === 0) return [];

      const [prodRes, dealsRes] = await Promise.all([
        supabase.from("daily_production").select("agent_id").gte("production_date", cutoff),
        supabase.from("deals").select("agent_id").gte("effective_date", cutoff),
      ]);

      const activeIds = new Set<string>();
      (prodRes.data  || []).forEach((p: any) => p.agent_id && activeIds.add(p.agent_id));
      (dealsRes.data || []).forEach((d: any) => d.agent_id && activeIds.add(d.agent_id));

      return agents
        .filter((a: any) => !activeIds.has(a.id))
        .map((a: any) => a.display_name || a.profiles?.full_name || "Agent")
        .slice(0, 10);
    },
    enabled: !!user && !authLoading && isAdmin,
    staleTime: 300000,
  });

  // Fetch pending lead purchase requests count
  const { data: pendingPurchases } = useQuery({
    queryKey: ["dashboard-pending-purchases"],
    queryFn: async () => {
      const { count } = await supabase
        .from("lead_purchase_requests" as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count || 0;
    },
    enabled: !!user && !authLoading && isAdmin,
    staleTime: 60000,
  });

  const { data } = useQuery({
    queryKey: ["dashboard-stats", user?.id, profile?.full_name, user?.email, dateRange.start.toISOString(), dateRange.end.toISOString(), myDirectsOnly],
    queryFn: () => fetchDashboardData(user!.id, profile?.full_name, user!.email, dateRange, myDirectsOnly),
    enabled: !!user && !authLoading,
    staleTime: 300_000,
    gcTime: 600_000,
    refetchOnWindowFocus: false,
  });

  const stats = data?.stats ?? defaultStats;
  const dailyData = data?.dailyData ?? emptyChartData;
  const weeklyData = data?.weeklyData ?? emptyChartData;
  const monthlyData = data?.monthlyData ?? emptyChartData;
  const sourceData = data?.sourceData ?? emptySourceData;
  const userName = data?.userName ?? "";
  const currentAgentId = data?.currentAgentId;
  const previousPeriodLeads = data?.previousPeriodLeads ?? 0;

  const licenseData = useMemo(() => [
    { name: "Licensed", value: stats.licensed, color: "hsl(168, 84%, 42%)" },
    { name: "Unlicensed", value: stats.unlicensed, color: "hsl(222, 47%, 40%)" },
  ], [stats.licensed, stats.unlicensed]);

  // Confetti removed — was firing on every session start with no earned trigger

  // Determine what to show based on role
  const showAgencyStats = isAdmin;
  const showTeamStats = isManager && !isAdmin;
  const showPersonalOnly = isAgent && !isManager && !isAdmin;

  // Show skeleton while auth is loading
  if (authLoading) {
    return <PageLoadingSkeleton variant="dashboard" />;
  }

  return (
    <>
      {/* Welcome */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">
            Welcome back, <span className="text-primary">{userName}</span>! 👋
          </h2>
          <div className="h-0.5 w-24 mt-1 bg-gradient-to-r from-primary to-emerald-400 rounded-full" />
          <div className="flex items-center gap-3 mt-2">
            <p className="text-sm text-muted-foreground">
              {isAdmin ? "Here's your agency overview" : isManager ? "Here's your team performance" : "Track your progress"}
            </p>
            <StreakBanner />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HiddenCardsManager catalog={HIDEABLE_CARDS} />
          {(isAdmin || isManager) && <AddAgentModal />}
        </div>
      </div>

      {/* Focus Now — top priority card from bot_priorities */}
      <FocusNow />

      {/* Month-end forecast */}
      <ForecastCard />

      {/* Live pulse — realtime counters */}
      <LivePulse />

      {/* ====== AGENT-ONLY VIEW ====== */}
      {showPersonalOnly && (
        <AgentPersonalDashboard agentId={currentAgentId} />
      )}

      {/* ====== TOP METRIC CARDS (Admin / Manager) ====== */}
      {(isAdmin || isManager) && topMetrics && (
        <>
          <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">
            {topMetrics.scope === "team" ? "Your team" : "Full agency"}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div onClick={() => setActiveDrilldown("agents")} className="cursor-pointer rounded-xl transition-all card-tilt reveal hover:ring-2 ring-primary/30">
              <StatCard
                title={topMetrics.scope === "team" ? "My Team Agents" : "Active Agents"}
                value={topMetrics.activeAgents}
                icon={Users}
                variant="primary"
              />
            </div>
            <div onClick={() => setActiveDrilldown("alp")} className="cursor-pointer rounded-xl transition-all card-tilt reveal hover:ring-2 ring-primary/30">
              <StatCard
                title={topMetrics.scope === "team" ? "Team Weekly ALP" : "Weekly ALP"}
                value={`$${topMetrics.weeklyALP.toLocaleString()}`}
                icon={DollarSign}
                variant="success"
              />
            </div>
            <div onClick={() => setActiveDrilldown("apps")} className="cursor-pointer rounded-xl transition-all card-tilt reveal hover:ring-2 ring-primary/30">
              <StatCard title="Applications This Week" value={topMetrics.appsThisWeek} icon={UserPlus} variant="default" />
            </div>
            <div
              onClick={() => setActiveDrilldown("closerate")}
              className="cursor-pointer rounded-xl transition-all card-tilt reveal hover:ring-2 ring-primary/30 relative"
              title={
                topMetrics.presentationsUnderLogged
                  ? `${topMetrics.totalDeals} deals written but only ${topMetrics.totalPres} presentations logged. Real rate: ${topMetrics.rawCloseRate}%. Ask agents to log every presentation.`
                  : undefined
              }
            >
              <StatCard title="Close Rate" value={`${topMetrics.closeRate}%`} icon={Percent} variant="success" />
              {topMetrics.presentationsUnderLogged && (
                <span className="absolute top-2 right-2 inline-flex items-center rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-medium px-2 py-0.5 border border-amber-500/40">
                  Presentations under-logged
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {/* Stat Card Drilldown */}
      <StatCardDrilldown activeModal={activeDrilldown} onClose={() => setActiveDrilldown(null)} />

      {/* Insight Data Cards */}
      {(isAdmin || isManager) && (
        <HideableCard cardKey="dashboard.insight-cards" label={HIDEABLE_CARDS["dashboard.insight-cards"]}>
          <DashboardInsightCards />
        </HideableCard>
      )}

      {/* ====== ALERT BANNERS (Admin) ====== */}
      {isAdmin && staleAgents && staleAgents.length > 0 && (
        <div className="mb-4 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm font-semibold text-destructive">
              {staleAgents.length} agent{staleAgents.length === 1 ? "" : "s"} haven't logged production in 7+ days
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Link to="/dashboard/inactive-agents">
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  <UserX className="h-3 w-3 mr-1" /> Review Queue
                </Button>
              </Link>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={async () => {
                  toast.info("Running inactivity scan...");
                  const { error } = await supabase.functions.invoke("detect-inactive-agents");
                  if (error) { toast.error("Scan failed: " + error.message); return; }
                  toast.success("Scan complete — check Inactive Agents queue");
                }}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Run Scan
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground ml-6">
            {staleAgents.slice(0, 5).join(", ")}
            {staleAgents.length > 5 ? ` +${staleAgents.length - 5} more` : ""}
          </p>
        </div>
      )}

      {isAdmin && (pendingPurchases ?? 0) > 0 && (
        <Link to="/purchase-leads">
          <div className="mb-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 cursor-pointer hover:border-amber-500/50 transition-all">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-semibold text-amber-400">{pendingPurchases} lead purchase request{(pendingPurchases ?? 0) > 1 ? "s" : ""} pending your confirmation</span>
            </div>
          </div>
        </Link>
      )}

      {/* ====== ADMIN QUICK ACTIONS ROW ====== */}
      {isAdmin && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Button
            variant="outline"
            className="h-auto py-3 flex flex-col items-center gap-1 hover:border-primary/50"
            onClick={async () => {
              toast.info("Sending licensing blast...");
              await supabase.functions.invoke("bulk-send-licensing");
              toast.success("Licensing blast sent!");
            }}
          >
            <Send className="h-4 w-4 text-primary" />
            <span className="text-xs">Send Licensing Blast</span>
          </Button>
          <PortalLoginsDialog />
          <Link to="/purchase-leads">
            <Button variant="outline" className="w-full h-auto py-3 flex flex-col items-center gap-1 hover:border-primary/50">
              <ShoppingCart className="h-4 w-4 text-primary" />
              <span className="text-xs">Confirm Lead Purchases</span>
            </Button>
          </Link>
          <Button
            variant="outline"
            className="h-auto py-3 flex flex-col items-center gap-1 hover:border-primary/50"
            onClick={async () => {
              toast.info("Running system check...");
              await supabase.functions.invoke("system-health-check");
              toast.success("System check complete!");
            }}
          >
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-xs">Run System Check</span>
          </Button>
        </div>
      )}

      {/* ====== FOMO APPLICATIONS BANNER ====== */}
      <HideableCard cardKey="dashboard.applications-banner" label={HIDEABLE_CARDS["dashboard.applications-banner"]}>
        <TotalApplicationsBanner />
      </HideableCard>

      {/* ====== CHURN RISK BANNER ====== */}
      {(isAdmin || isManager) && (
        <HideableCard cardKey="dashboard.churn-risk" label={HIDEABLE_CARDS["dashboard.churn-risk"]}>
          <ChurnRiskBanner />
        </HideableCard>
      )}

      {/* ====== DATE PERIOD SELECTOR ====== */}
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <DatePeriodSelector value={datePeriod} onChange={handleDatePeriodChange} />
        {(isAdmin || isManager) && currentAgentId && (
          <Button
            variant={myDirectsOnly ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setMyDirectsOnly(!myDirectsOnly)}
          >
            <Users className="h-3.5 w-3.5" />
            {myDirectsOnly ? "My Directs" : "Full Team"}
          </Button>
        )}
      </div>

      {/* ====== QUICK ACTIONS ROW ====== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 mt-4">
        {quickActions.map((card) => (
          <div key={card.to}>
            <Link to={card.to} onClick={() => playSound("click")}>
              <GlassCard className={`p-4 hover:border-${card.color}/50 hover:bg-${card.color}/5 cursor-pointer transition-all card-hover-lift group`}>
                <card.icon className={`h-5 w-5 text-${card.color} mb-2 group-hover:scale-110 transition-transform`} />
                <p className="font-semibold text-[13px] sm:text-sm">{card.title}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{card.sub}</p>
              </GlassCard>
            </Link>
          </div>
        ))}
        {isAdmin && adminQuickActions.map((card) => (
          <div key={card.to}>
            <Link to={card.to} onClick={() => playSound("click")}>
              <GlassCard className={`p-4 hover:border-${card.color}/50 hover:bg-${card.color}/5 cursor-pointer transition-all card-hover-lift group`}>
                <card.icon className={`h-5 w-5 text-${card.color} mb-2 group-hover:scale-110 transition-transform`} />
                <p className="font-semibold text-[13px] sm:text-sm">{card.title}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{card.sub}</p>
              </GlassCard>
            </Link>
          </div>
        ))}
      </div>

      {/* ====== 1. PRODUCTION SNAPSHOT (Top Priority - Role-based) ====== */}
      <HideableCard cardKey="dashboard.team-snapshot" label={HIDEABLE_CARDS["dashboard.team-snapshot"]} className="mb-6 block">
        <TeamSnapshotCard />
      </HideableCard>

      {/* ====== Activation Risk Banner (Admin/Manager) ====== */}
      {(isAdmin || isManager) && (
        <HideableCard cardKey="dashboard.activation-risk" label={HIDEABLE_CARDS["dashboard.activation-risk"]} className="mb-6 block">
          <ActivationRiskBanner />
        </HideableCard>
      )}

      {/* ====== TEAM OVERVIEW (Admin Only) ====== */}
      {isAdmin && (
        <HideableCard cardKey="dashboard.team-overview" label={HIDEABLE_CARDS["dashboard.team-overview"]} className="mb-6 block">
          <TeamOverviewDashboard />
        </HideableCard>
      )}


      {/* ====== 1.5. WEEKLY PERFORMANCE BREAKDOWN (Managers/Admins) ====== */}
      {(isManager || isAdmin) && (
        <HideableCard cardKey="dashboard.performance-breakdown" label={HIDEABLE_CARDS["dashboard.performance-breakdown"]} className="mb-6 block">
          {isMobile ? (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full gap-2">
                  <BarChart3 className="h-4 w-4" />
                  View Performance Breakdown
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4">
                <TeamPerformanceBreakdown />
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <TeamPerformanceBreakdown />
          )}
        </HideableCard>
      )}

      {/* ====== 2. MAIN CONTENT LAYOUT ====== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* LEFT COLUMN: Mini Leaderboard (Production) - 2/3 width */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            <h3 className="text-base font-bold">Top Producers</h3>
          </div>

          {/* Sales Leaderboard - Primary focus */}
          <LeaderboardTabs currentAgentId={currentAgentId} />

          {/* Secondary Leaderboards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ClosingRateLeaderboard />
            <ReferralLeaderboard />
          </div>

          {/* Estimated Earnings Card (Admin Only) */}
          {isAdmin && currentAgentId && <EstimatedEarningsCard currentAgentId={currentAgentId} />}

        </div>

        {/* RIGHT COLUMN: Recruiting Stats + Quick Actions - 1/3 width */}
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            <h3 className="text-base font-bold">
              {isAdmin ? "Recruiting & Growth" : isManager ? "Team Growth" : "Your Stats"}
            </h3>
          </div>

          {/* Onboarding Pipeline for Admin/Manager */}
          {(isManager || isAdmin) && <OnboardingPipelineCard />}

          {/* Referral Tracking */}
          {(isManager || isAdmin) && (
            <div className="grid grid-cols-1 gap-4">
              <ReferralTrackingCard />
            </div>
          )}

          {/* Stalled Agents Alert */}
          {(isManager || isAdmin) && <StalledAgentsAlert />}

          {/* Recruiting Quick-View Table */}
          {(isManager || isAdmin) && <RecruitingQuickView />}

          {/* Pipeline Alert Summary */}
          {(isManager || isAdmin) && (stats.unlicensed > 0 || stats.staleLeads > 0) && (
            <Link to="/dashboard/crm">
              <GlassCard className="p-4 border-amber-500/30 hover:border-amber-500/50 cursor-pointer transition-all">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <h4 className="font-semibold text-sm">Pipeline Alerts</h4>
                </div>
                <div className="space-y-1.5">
                  {stats.unlicensed > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Unlicensed in pipeline</span>
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">
                        {stats.unlicensed}
                      </Badge>
                    </div>
                  )}
                  {stats.staleLeads > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">No contact 48h+</span>
                      <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">
                        {stats.staleLeads}
                      </Badge>
                    </div>
                  )}
                </div>
              </GlassCard>
            </Link>
          )}

          {/* Lead Sources */}
          <AnalyticsPieChart
            title="Lead Sources"
            icon={<MapPin className="h-4 w-4 text-primary" />}
            data={sourceData}
          />

        </div>
      </div>


      {/* ====== 4. TEAM VIEW (Managers & Admins) ====== */}
      {(isManager || isAdmin) && (
        <HideableCard cardKey="dashboard.team-view" label={HIDEABLE_CARDS["dashboard.team-view"]} className="mb-6 block">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="text-base font-bold">Your Team</h3>
          </div>
          <ManagerTeamView />
        </HideableCard>
      )}

      {/* ====== 5. PERSONAL STATS (Agents only - NOT Admin) ====== */}
      {showPersonalOnly && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-muted-foreground">Your Recruiting Stats</h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              title="Total Leads"
              value={stats.totalLeads}
              icon={Users}
              variant="primary"
              href="/dashboard/leads"
              hint="View all"
            />
            <StatCard
              title="Contacted"
              value={stats.contacted}
              icon={Phone}
              variant="default"
              href="/dashboard/leads?status=has_contacted"
              hint="View contacted"
            />
            <StatCard
              title="Closed"
              value={stats.closed}
              icon={CheckCircle}
              variant="success"
              href="/dashboard/leads?status=contracting_only"
              hint="View closed"
            />
            <StatCard
              title="Close Rate"
              value={`${stats.closeRate.toFixed(1)}%`}
              icon={Percent}
              variant="success"
              href="/dashboard/command"
              hint="View producers"
            />
          </div>

          {/* Growth Chart for agents */}
          <div className="mt-6">
            <GrowthChart
              dailyData={dailyData}
              weeklyData={weeklyData}
              monthlyData={monthlyData}
              currentPeriodTotal={stats.totalLeads}
              previousPeriodTotal={previousPeriodLeads}
            />
          </div>
        </div>
      )}

      {/* ====== ACHIEVEMENT FEED + TASKS + AWARDS (Admin/Manager) ====== */}
      {(isAdmin || isManager) && (
        <HideableCard cardKey="dashboard.achievement-feed" label={HIDEABLE_CARDS["dashboard.achievement-feed"]} className="mb-6 block">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TeamTasksWidget />
              <AwardFeedLive />
            </div>
            <AchievementFeed />
          </div>
        </HideableCard>
      )}
    </>
  );
}

function PortalLoginsDialog() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"all" | "search">("all");
  const [search, setSearch] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const { data: agents = [] } = useQuery({
    queryKey: ["agents-for-portal-login"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agents")
        .select("id, display_name, user_id, is_deactivated, profile:profiles!agents_profile_id_fkey(full_name, email)")
        .eq("is_deactivated", false)
        .limit(1000);
      return ((data || []) as any[]).map(a => ({
        id: a.id,
        name: (a.profile as any)?.full_name || a.display_name || "Unknown",
        email: (a.profile as any)?.email,
      }));
    },
    enabled: open,
  });

  const filtered = search
    ? agents.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) || a.email?.toLowerCase().includes(search.toLowerCase()))
    : agents;

  const handleSend = async () => {
    setSending(true);
    try {
      if (mode === "all") {
        await supabase.functions.invoke("send-bulk-portal-logins");
        toast.success(`Portal logins sent to all ${agents.length} agents`);
      } else {
        if (selectedAgents.length === 0) {
          toast.error("Pick at least one agent");
          setSending(false);
          return;
        }
        await supabase.functions.invoke("send-bulk-portal-logins", {
          body: { agent_ids: selectedAgents },
        });
        toast.success(`Portal logins sent to ${selectedAgents.length} agents`);
      }
      setOpen(false);
      setSelectedAgents([]);
      setSearch("");
    } catch (e: any) {
      toast.error("Failed: " + (e.message || "unknown"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-auto py-3 flex flex-col items-center gap-1 hover:border-primary/50 w-full"
        >
          <KeyRound className="h-4 w-4 text-primary" />
          <span className="text-xs">Send Portal Logins</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Send Portal Logins</DialogTitle>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
          <TabsList className="w-full">
            <TabsTrigger value="all" className="flex-1">Send to All ({agents.length})</TabsTrigger>
            <TabsTrigger value="search" className="flex-1">Search & Select</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              This will email portal login credentials to every active agent ({agents.length} total).
            </p>
            <Button onClick={handleSend} disabled={sending} className="w-full">
              {sending ? "Sending..." : `Send to all ${agents.length} agents`}
            </Button>
          </TabsContent>
          <TabsContent value="search" className="space-y-4 pt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 max-h-[300px]">
              {filtered.map(a => (
                <label
                  key={a.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedAgents.includes(a.id)}
                    onCheckedChange={(checked) => {
                      setSelectedAgents(prev => checked
                        ? [...prev, a.id]
                        : prev.filter(x => x !== a.id));
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{a.email}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <p className="text-sm text-muted-foreground">{selectedAgents.length} selected</p>
              <Button onClick={handleSend} disabled={sending || selectedAgents.length === 0}>
                {sending ? "Sending..." : `Send to ${selectedAgents.length} agent${selectedAgents.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

