import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
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
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { ConfettiCelebration } from "@/components/dashboard/ConfettiCelebration";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
import { AgencyGrowthCard } from "@/components/dashboard/AgencyGrowthCard";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSoundEffects } from "@/hooks/useSoundEffects";

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

async function fetchDashboardData(userId: string, profileName: string | null | undefined, userEmail: string | undefined) {
  const userName = profileName || userEmail?.split("@")[0] || "Agent";

  const { data: agentData } = await supabase
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!agentData) {
    return { stats: defaultStats, dailyData: emptyChartData, weeklyData: emptyChartData, monthlyData: emptyChartData, sourceData: emptySourceData, userName, currentAgentId: undefined };
  }

  const { data: applications } = await supabase
    .from("applications")
    .select("*")
    .eq("assigned_agent_id", agentData.id);

  if (!applications || applications.length === 0) {
    return { stats: defaultStats, dailyData: emptyChartData, weeklyData: emptyChartData, monthlyData: emptyChartData, sourceData: emptySourceData, userName, currentAgentId: agentData.id };
  }

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

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const currentPeriodLeads = applications.filter(a => new Date(a.created_at) >= thirtyDaysAgo).length;
  const previousPeriodLeads = applications.filter(a => {
    const date = new Date(a.created_at);
    return date >= sixtyDaysAgo && date < thirtyDaysAgo;
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
  };
}

const quickActions = [
  { to: "/numbers", icon: Edit3, color: "primary", title: "Log Numbers", sub: "Enter today's stats" },
  { to: "/agent-portal", icon: BarChart3, color: "violet-500", title: "Agent Portal", sub: "View performance" },
  { to: "/dashboard/crm", icon: Users, color: "emerald-500", title: "CRM", sub: "Manage agents" },
  { to: "/dashboard/applicants", icon: Sparkles, color: "amber-500", title: "Pipeline", sub: "View applicants" },
] as const;

export default function Dashboard() {
  const { profile, user, isManager, isAdmin, isAgent, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { playSound } = useSoundEffects();
  const [showConfetti, setShowConfetti] = useState(false);

  const { data } = useQuery({
    queryKey: ["dashboard-stats", user?.id],
    queryFn: () => fetchDashboardData(user!.id, profile?.full_name, user!.email),
    enabled: !!user,
  });

  const stats = data?.stats ?? defaultStats;
  const dailyData = data?.dailyData ?? emptyChartData;
  const weeklyData = data?.weeklyData ?? emptyChartData;
  const monthlyData = data?.monthlyData ?? emptyChartData;
  const sourceData = data?.sourceData ?? emptySourceData;
  const userName = data?.userName ?? "";
  const currentAgentId = data?.currentAgentId;

  const licenseData = useMemo(() => [
    { name: "Licensed", value: stats.licensed, color: "hsl(168, 84%, 42%)" },
    { name: "Unlicensed", value: stats.unlicensed, color: "hsl(222, 47%, 40%)" },
  ], [stats.licensed, stats.unlicensed]);

  useEffect(() => {
    const hasSeenConfetti = sessionStorage.getItem('dashboard-confetti');
    if (!hasSeenConfetti) {
      setShowConfetti(true);
      sessionStorage.setItem('dashboard-confetti', 'true');
      setTimeout(() => setShowConfetti(false), 4000);
    }
  }, []);

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
      {/* Confetti on first load */}
      {showConfetti && <ConfettiCelebration trigger={showConfetti} />}
      
      {/* Animated Welcome */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <motion.h2 
          className="text-xl font-bold"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Welcome back, <span className="text-primary">{userName}</span>! 👋
        </motion.h2>
        <div className="h-0.5 w-24 mt-1 bg-gradient-to-r from-primary to-emerald-400 rounded-full" />
        <p className="text-sm text-muted-foreground mt-2">
          {isAdmin ? "Here's your agency overview" : isManager ? "Here's your team performance" : "Track your progress"}
        </p>
      </motion.div>

      {/* ====== QUICK ACTIONS ROW ====== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
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

      {/* ====== Agency Growth Stats (Admin/Manager) ====== */}
      {(isAdmin || isManager) && (
        <div className="mb-6">
          <AgencyGrowthCard />
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
              previousPeriodTotal={Math.round(stats.totalLeads * 0.87)}
            />
          </div>
        </div>
      )}
    </>
  );
}
