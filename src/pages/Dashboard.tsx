import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Phone,
  CheckCircle,
  Award,
  GraduationCap,
  Percent,
  Clock,
  MapPin,
  BarChart3,
  TrendingUp,
  DollarSign,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { LeaderboardCard } from "@/components/dashboard/LeaderboardCard";
import { AIInsightsCard } from "@/components/dashboard/AIInsightsCard";
import { AICoachingPanel } from "@/components/dashboard/AICoachingPanel";
import { GrowthChart } from "@/components/dashboard/GrowthChart";
import { AnalyticsPieChart } from "@/components/dashboard/AnalyticsPieChart";
import { EarningsPotentialCard } from "@/components/dashboard/EarningsPotentialCard";
import { ManagerTeamView } from "@/components/dashboard/ManagerTeamView";
import { InviteManagerCard } from "@/components/dashboard/InviteManagerCard";
import { LeadQualificationChat } from "@/components/dashboard/LeadQualificationChat";
import { ManagerLeaderboard } from "@/components/dashboard/ManagerLeaderboard";
import { LeaderboardTabs } from "@/components/dashboard/LeaderboardTabs";
import { ClosingRateLeaderboard } from "@/components/dashboard/ClosingRateLeaderboard";
import { ReferralLeaderboard } from "@/components/dashboard/ReferralLeaderboard";
import { DownlineStatsCard } from "@/components/dashboard/DownlineStatsCard";
import { GlassCard } from "@/components/ui/glass-card";
import { useAuth } from "@/hooks/useAuth";

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

interface LeaderboardEntry {
  rank: number;
  name: string;
  value: number;
  isCurrentUser?: boolean;
}

export default function Dashboard() {
  const { profile, user, isManager, isAdmin } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    totalLeads: 0,
    contacted: 0,
    closed: 0,
    licensed: 0,
    unlicensed: 0,
    closeRate: 0,
    avgWaitTime: 0,
    growthPercent: 0,
    staleLeads: 0,
  });
  const [userName, setUserName] = useState("");
  const [leaderboardApplicants, setLeaderboardApplicants] = useState<LeaderboardEntry[]>([]);
  const [leaderboardClosed, setLeaderboardClosed] = useState<LeaderboardEntry[]>([]);

  // Chart data - will populate from real data
  const [dailyData, setDailyData] = useState<Array<{ label: string; leads: number; closed: number }>>([]);
  const [weeklyData, setWeeklyData] = useState<Array<{ label: string; leads: number; closed: number }>>([]);
  const [monthlyData, setMonthlyData] = useState<Array<{ label: string; leads: number; closed: number }>>([]);
  const [sourceData, setSourceData] = useState<Array<{ name: string; value: number; color: string }>>([]);

  const licenseData = [
    { name: "Licensed", value: stats.licensed, color: "hsl(168, 84%, 42%)" },
    { name: "Unlicensed", value: stats.unlicensed, color: "hsl(222, 47%, 40%)" },
  ];

  useEffect(() => {
    const fetchData = async () => {
      if (user) {
        setUserName(profile?.full_name || user.email?.split("@")[0] || "Agent");
        
        // Fetch agent's assigned applications
        const { data: agentData } = await supabase
          .from("agents")
          .select("id")
          .eq("user_id", user.id)
          .single();

        if (agentData) {
          // Fetch applications assigned to this agent
          const { data: applications } = await supabase
            .from("applications")
            .select("*")
            .eq("assigned_agent_id", agentData.id);

          if (applications && applications.length > 0) {
            const totalLeads = applications.length;
            const contacted = applications.filter(a => a.contacted_at).length;
            const closed = applications.filter(a => a.closed_at).length;
            const licensed = applications.filter(a => a.license_status === "licensed").length;
            const unlicensed = applications.filter(a => a.license_status === "unlicensed").length;
            
            // Calculate stale leads (not contacted in 48+ hours)
            const now = new Date();
            const staleLeads = applications.filter(a => {
              if (a.contacted_at) return false;
              const createdAt = new Date(a.created_at);
              const hoursDiff = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
              return hoursDiff > 48;
            }).length;

            // Calculate average wait time ONLY for licensed leads
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

            // Calculate growth (compare to previous period)
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

            setStats({
              totalLeads,
              contacted,
              closed,
              licensed,
              unlicensed,
              closeRate: totalLeads > 0 ? (closed / totalLeads) * 100 : 0,
              avgWaitTime: countWithContact > 0 ? totalWaitTime / countWithContact : 0,
              growthPercent: Math.round(growthPercent),
              staleLeads,
            });

            // Build real chart data from applications
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const last7Days = Array.from({ length: 7 }, (_, i) => {
              const date = new Date();
              date.setDate(date.getDate() - (6 - i));
              return date;
            });
            
            const dailyChartData = last7Days.map(date => {
              const dayApps = applications.filter(a => {
                const appDate = new Date(a.created_at);
                return appDate.toDateString() === date.toDateString();
              });
              return {
                label: dayNames[date.getDay()],
                leads: dayApps.length,
                closed: dayApps.filter(a => a.closed_at).length,
              };
            });
            setDailyData(dailyChartData);

            // Weekly data (last 4 weeks)
            const weeklyChartData = Array.from({ length: 4 }, (_, i) => {
              const weekStart = new Date();
              weekStart.setDate(weekStart.getDate() - ((3 - i) * 7 + 7));
              const weekEnd = new Date(weekStart);
              weekEnd.setDate(weekEnd.getDate() + 7);
              
              const weekApps = applications.filter(a => {
                const appDate = new Date(a.created_at);
                return appDate >= weekStart && appDate < weekEnd;
              });
              return {
                label: `Week ${i + 1}`,
                leads: weekApps.length,
                closed: weekApps.filter(a => a.closed_at).length,
              };
            });
            setWeeklyData(weeklyChartData);

            // Monthly data (last 6 months)
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthlyChartData = Array.from({ length: 6 }, (_, i) => {
              const date = new Date();
              date.setMonth(date.getMonth() - (5 - i));
              const monthApps = applications.filter(a => {
                const appDate = new Date(a.created_at);
                return appDate.getMonth() === date.getMonth() && appDate.getFullYear() === date.getFullYear();
              });
              return {
                label: monthNames[date.getMonth()],
                leads: monthApps.length,
                closed: monthApps.filter(a => a.closed_at).length,
              };
            });
            setMonthlyData(monthlyChartData);

            // Source data from referral_source field
            const sourceMap = new Map<string, number>();
            applications.forEach(a => {
              const source = a.referral_source || 'Direct';
              sourceMap.set(source, (sourceMap.get(source) || 0) + 1);
            });
            const colors = ["hsl(168, 84%, 42%)", "hsl(160, 84%, 39%)", "hsl(45, 93%, 58%)", "hsl(222, 47%, 40%)", "hsl(220, 15%, 50%)"];
            const sourceChartData = Array.from(sourceMap.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([name, value], i) => ({ name, value, color: colors[i % colors.length] }));
            setSourceData(sourceChartData.length > 0 ? sourceChartData : [{ name: "No data yet", value: 1, color: "hsl(222, 30%, 30%)" }]);

            // Real leaderboard data - will populate as team grows
            if (totalLeads > 0) {
              setLeaderboardApplicants([
                { rank: 1, name: userName || "You", value: totalLeads, isCurrentUser: true },
              ]);
              
              if (closed > 0) {
                setLeaderboardClosed([
                  { rank: 1, name: userName || "You", value: closed, isCurrentUser: true },
                ]);
              } else {
                setLeaderboardClosed([]);
              }
            } else {
              setLeaderboardApplicants([]);
              setLeaderboardClosed([]);
            }
          } else {
            // No applications yet - empty state
            setStats({
              totalLeads: 0,
              contacted: 0,
              closed: 0,
              licensed: 0,
              unlicensed: 0,
              closeRate: 0,
              avgWaitTime: 0,
              growthPercent: 0,
              staleLeads: 0,
            });
            setDailyData([]);
            setWeeklyData([]);
            setMonthlyData([]);
            setSourceData([{ name: "No data yet", value: 1, color: "hsl(222, 30%, 30%)" }]);
            setLeaderboardApplicants([]);
            setLeaderboardClosed([]);
          }
        } else {
          // No agent record yet - empty state
          setStats({
            totalLeads: 0,
            contacted: 0,
            closed: 0,
            licensed: 0,
            unlicensed: 0,
            closeRate: 0,
            avgWaitTime: 0,
            growthPercent: 0,
            staleLeads: 0,
          });
          setDailyData([]);
          setWeeklyData([]);
          setMonthlyData([]);
          setSourceData([{ name: "No data yet", value: 1, color: "hsl(222, 30%, 30%)" }]);
          setLeaderboardApplicants([]);
          setLeaderboardClosed([]);
        }
      }
    };
    
    fetchData();
  }, [user, profile, userName]);

  return (
    <DashboardLayout>
      {/* Compact Welcome */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4"
      >
        <h2 className="text-xl font-bold">Welcome back, {userName}! 👋</h2>
      </motion.div>

      {/* ====== SALES SECTION ====== */}
      <div className="mb-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 mb-3"
        >
          <DollarSign className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-bold">Sales Performance</h3>
        </motion.div>

        {/* Primary Stats Row - Compact */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-4">
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
          <EarningsPotentialCard leadCount={stats.totalLeads} />
        </div>

        {/* Downline Stats for Managers */}
        {(isManager || isAdmin) && <DownlineStatsCard />}

        {/* Sales Leaderboard */}
        <div className="mt-4">
          <LeaderboardTabs />
        </div>

        {/* Performance Leaderboards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <ClosingRateLeaderboard />
          <ReferralLeaderboard />
        </div>
      </div>

      {/* ====== GROWTH SECTION ====== */}
      <div className="mb-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 mb-3"
        >
          <TrendingUp className="h-5 w-5 text-emerald-400" />
          <h3 className="text-lg font-bold">Growth & Recruitment</h3>
        </motion.div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard
            title="Licensed"
            value={stats.licensed}
            icon={Award}
            variant="primary"
          />
          <StatCard
            title="Unlicensed"
            value={stats.unlicensed}
            icon={GraduationCap}
            variant="default"
          />
          <StatCard
            title="Avg Wait (Licensed)"
            value={`${stats.avgWaitTime.toFixed(1)}h`}
            icon={Clock}
            variant={stats.avgWaitTime > 24 ? "warning" : "default"}
          />
          <StatCard
            title="Growth"
            value={`+${stats.growthPercent}%`}
            icon={BarChart3}
            trend={{ value: stats.growthPercent, isPositive: true }}
            variant="success"
          />
        </div>

        {/* Manager Leaderboard + Growth Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ManagerLeaderboard />
          <GrowthChart
            dailyData={dailyData}
            weeklyData={weeklyData}
            monthlyData={monthlyData}
            currentPeriodTotal={stats.totalLeads}
            previousPeriodTotal={Math.round(stats.totalLeads * 0.87)}
          />
        </div>
      </div>

      {/* License Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <AnalyticsPieChart
          title="Lead Sources"
          icon={<MapPin className="h-5 w-5 text-primary" />}
          data={sourceData}
        />
        <AnalyticsPieChart
          title="License Status"
          icon={<Award className="h-5 w-5 text-primary" />}
          data={licenseData}
        />
      </div>

      {/* AI Features */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <AIInsightsCard 
          stats={{
            totalLeads: stats.totalLeads,
            contacted: stats.contacted,
            qualified: 0,
            closed: stats.closed,
            closeRate: stats.closeRate,
            avgWaitTime: stats.avgWaitTime,
            staleLeads: stats.staleLeads,
            teamAvgCloseRate: 25,
          }}
        />
        <AICoachingPanel
          stats={{
            totalLeads: stats.totalLeads,
            contacted: stats.contacted,
            qualified: 0,
            closed: stats.closed,
            closeRate: stats.closeRate,
            avgWaitTime: stats.avgWaitTime,
            staleLeads: stats.staleLeads,
            teamAvgCloseRate: 25,
          }}
        />
      </div>

      {/* Admin Quick Actions */}
      {isAdmin && (
        <div className="mb-6">
          <InviteManagerCard />
        </div>
      )}

      {/* Manager Team View */}
      {(isManager || isAdmin) && (
        <div className="mb-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 mb-3"
          >
            <Users className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-bold">Your Team</h3>
          </motion.div>
          <ManagerTeamView />
        </div>
      )}
    </DashboardLayout>
  );
}
