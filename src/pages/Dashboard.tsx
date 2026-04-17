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
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
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
import { PipelineVelocityCard } from "@/components/dashboard/PipelineVelocityCard";
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

import { Shield, Settings, Send, KeyRound, ShoppingCart, Activity, AlertCircle, Flame } from "lucide-react";

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

  // Fetch top-row real metrics
  const { data: topMetrics } = useQuery({
    queryKey: ["dashboard-top-metrics"],
    queryFn: async () => {
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      const weekStartStr = weekStart.toISOString().split("T")[0];

      // Active = at least 1 deal in last 30 days
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

      const [activeProducersRes, prodRes, appsRes] = await Promise.all([
        supabase.from("daily_production").select("agent_id").gte("production_date", thirtyDaysAgoStr).gt("deals_closed", 0),
        supabase.from("daily_production").select("aop, deals_closed, presentations").gte("production_date", weekStartStr),
        supabase.from("applications").select("id", { count: "exact", head: true }).gte("created_at", weekStart.toISOString()),
      ]);

      // Count distinct agents with deals in last 30 days
      const activeAgentIds = new Set((activeProducersRes.data || []).map((r: any) => r.agent_id));

      const weeklyALP = (prodRes.data || []).reduce((s: number, r: any) => s + (Number(r.aop) || 0), 0);
      const totalDeals = (prodRes.data || []).reduce((s: number, r: any) => s + (Number(r.deals_closed) || 0), 0);
      const totalPres = (prodRes.data || []).reduce((s: number, r: any) => s + (Number(r.presentations) || 0), 0);
      const closeRate = totalPres > 0 ? (totalDeals / totalPres) * 100 : 0;

      return {
        activeAgents: activeAgentIds.size,
        weeklyALP,
        appsThisWeek: appsRes.count || 0,
        closeRate: Math.round(closeRate * 10) / 10,
      };
    },
    enabled: !!user && !authLoading,
    staleTime: 60000,
  });

  // Fetch agents who haven't logged production in 7+ days
  const { data: staleAgents } = useQuery({
    queryKey: ["dashboard-stale-agents"],
    queryFn: async () => {
      if (!isAdmin) return [];
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: agents } = await supabase
        .from("agents")
        .select("id, display_name, profiles:profile_id(full_name)")
        .eq("is_deactivated", false);

      if (!agents || agents.length === 0) return [];

      const { data: recentProd } = await supabase
        .from("daily_production")
        .select("agent_id")
        .gte("production_date", sevenDaysAgo.toISOString().split("T")[0]);

      const activeIds = new Set((recentProd || []).map((p: any) => p.agent_id));
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
    return <SkeletonLoader variant="page" />;
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
          <p className="text-sm text-muted-foreground mt-2">
            {isAdmin ? "Here's your agency overview" : isManager ? "Here's your team performance" : "Track your progress"}
          </p>
        </div>
        {(isAdmin || isManager) && <AddAgentModal />}
      </div>

      {/* ====== TOP METRIC CARDS (Real Data) ====== */}
      {(isAdmin || isManager) && topMetrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div onClick={() => setActiveDrilldown("agents")} className="cursor-pointer hover:ring-2 ring-primary/30 rounded-xl transition-all">
            <StatCard title="Active Agents" value={topMetrics.activeAgents} icon={Users} variant="primary" />
          </div>
          <div onClick={() => setActiveDrilldown("alp")} className="cursor-pointer hover:ring-2 ring-primary/30 rounded-xl transition-all">
            <StatCard title="Weekly ALP" value={`$${topMetrics.weeklyALP.toLocaleString()}`} icon={DollarSign} variant="success" />
          </div>
          <div onClick={() => setActiveDrilldown("apps")} className="cursor-pointer hover:ring-2 ring-primary/30 rounded-xl transition-all">
            <StatCard title="Apps This Week" value={topMetrics.appsThisWeek} icon={UserPlus} variant="default" />
          </div>
          <div onClick={() => setActiveDrilldown("closerate")} className="cursor-pointer hover:ring-2 ring-primary/30 rounded-xl transition-all">
            <StatCard title="Close Rate" value={`${topMetrics.closeRate}%`} icon={Percent} variant="success" />
          </div>
        </div>
      )}

      {/* Stat Card Drilldown */}
      <StatCardDrilldown activeModal={activeDrilldown} onClose={() => setActiveDrilldown(null)} />

      {/* Insight Data Cards */}
      {(isAdmin || isManager) && <DashboardInsightCards />}

      {/* ====== ALERT BANNERS (Admin) ====== */}
      {isAdmin && staleAgents && staleAgents.length > 0 && (
        <div className="mb-4 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm font-semibold text-destructive">{staleAgents.length} agents haven't logged production in 7+ days</span>
          </div>
          <p className="text-xs text-muted-foreground ml-6">{staleAgents.slice(0, 5).join(", ")}{staleAgents.length > 5 ? ` +${staleAgents.length - 5} more` : ""}</p>
        </div>
      )}

      {isAdmin && pendingPurchases && pendingPurchases > 0 && (
        <Link to="/purchase-leads">
          <div className="mb-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 cursor-pointer hover:border-amber-500/50 transition-all">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-semibold text-amber-400">{pendingPurchases} lead purchase request{pendingPurchases > 1 ? "s" : ""} pending your confirmation</span>
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
          <Button
            variant="outline"
            className="h-auto py-3 flex flex-col items-center gap-1 hover:border-primary/50"
            onClick={async () => {
              toast.info("Sending portal logins...");
              await supabase.functions.invoke("send-bulk-portal-logins");
              toast.success("Portal logins sent!");
            }}
          >
            <KeyRound className="h-4 w-4 text-primary" />
            <span className="text-xs">Send Portal Logins</span>
          </Button>
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
      <TotalApplicationsBanner />

      {/* ====== CHURN RISK BANNER ====== */}
      {(isAdmin || isManager) && <ChurnRiskBanner />}

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
      <div className="mb-6">
        <TeamSnapshotCard />
      </div>

      {/* ====== Activation Risk Banner (Admin/Manager) ====== */}
      {(isAdmin || isManager) && (
        <div className="mb-6">
          <ActivationRiskBanner />
        </div>
      )}

      {/* ====== TEAM OVERVIEW (Admin Only) ====== */}
      {isAdmin && (
        <div className="mb-6">
          <TeamOverviewDashboard />
        </div>
      )}


      {/* ====== 1.5. WEEKLY PERFORMANCE BREAKDOWN (Managers/Admins) ====== */}
      {(isManager || isAdmin) && (
        <div className="mb-6">
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
        </div>
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

          {/* Pipeline Velocity & Referral Tracking */}
          {(isManager || isAdmin) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <PipelineVelocityCard />
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
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="text-base font-bold">Your Team</h3>
          </div>
          <ManagerTeamView />
        </div>
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
            />
            <StatCard
              title="Contacted"
              value={stats.contacted}
              icon={Phone}
              variant="default"
            />
            <StatCard
              title="Closed"
              value={stats.closed}
              icon={CheckCircle}
              variant="success"
            />
            <StatCard
              title="Close Rate"
              value={`${stats.closeRate.toFixed(1)}%`}
              icon={Percent}
              variant="success"
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
        <div className="mb-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TeamTasksWidget />
            <AwardFeedLive />
          </div>
          <AchievementFeed />
        </div>
      )}
    </>
  );
}
