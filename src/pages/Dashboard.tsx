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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { LeaderboardCard } from "@/components/dashboard/LeaderboardCard";
import { AIInsightsCard } from "@/components/dashboard/AIInsightsCard";
import { GrowthChart } from "@/components/dashboard/GrowthChart";
import { AnalyticsPieChart } from "@/components/dashboard/AnalyticsPieChart";
import { EarningsPotentialCard } from "@/components/dashboard/EarningsPotentialCard";
import { ManagerTeamView } from "@/components/dashboard/ManagerTeamView";
import { InviteManagerCard } from "@/components/dashboard/InviteManagerCard";
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

  // Demo data for charts
  const dailyData = [
    { label: "Mon", leads: 3, closed: 1 },
    { label: "Tue", leads: 5, closed: 2 },
    { label: "Wed", leads: 4, closed: 1 },
    { label: "Thu", leads: 7, closed: 3 },
    { label: "Fri", leads: 6, closed: 2 },
    { label: "Sat", leads: 2, closed: 1 },
    { label: "Sun", leads: 1, closed: 0 },
  ];

  const weeklyData = [
    { label: "Week 1", leads: 12, closed: 4 },
    { label: "Week 2", leads: 18, closed: 6 },
    { label: "Week 3", leads: 22, closed: 8 },
    { label: "Week 4", leads: 28, closed: 10 },
  ];

  const monthlyData = [
    { label: "Jan", leads: 45, closed: 12 },
    { label: "Feb", leads: 52, closed: 18 },
    { label: "Mar", leads: 68, closed: 24 },
    { label: "Apr", leads: 75, closed: 28 },
    { label: "May", leads: 82, closed: 32 },
    { label: "Jun", leads: 95, closed: 38 },
  ];

  const sourceData = [
    { name: "Social Media", value: 35, color: "hsl(168, 84%, 42%)" },
    { name: "Referrals", value: 28, color: "hsl(160, 84%, 39%)" },
    { name: "Job Boards", value: 20, color: "hsl(45, 93%, 58%)" },
    { name: "Google", value: 12, color: "hsl(222, 47%, 40%)" },
    { name: "Other", value: 5, color: "hsl(220, 15%, 50%)" },
  ];

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

          if (applications) {
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
                const contacted = new Date(a.contacted_at!);
                totalWaitTime += (contacted.getTime() - created.getTime()) / (1000 * 60 * 60);
                countWithContact++;
              });

            setStats({
              totalLeads,
              contacted,
              closed,
              licensed,
              unlicensed,
              closeRate: totalLeads > 0 ? (closed / totalLeads) * 100 : 0,
              avgWaitTime: countWithContact > 0 ? totalWaitTime / countWithContact : 0,
              growthPercent: 15, // Demo data
              staleLeads,
            });

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
            setLeaderboardApplicants([]);
            setLeaderboardClosed([]);
          }
        } else {
          // No leads yet - show empty state
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
          setLeaderboardApplicants([]);
          setLeaderboardClosed([]);
        }
      }
    };
    
    fetchData();
  }, [user, profile, userName]);

  return (
    <DashboardLayout>
      {/* Welcome Message */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h2 className="text-2xl font-bold">Welcome back, {userName}! 👋</h2>
        <p className="text-muted-foreground">Here's your recruiting performance overview</p>
      </motion.div>

      {/* Primary Stats Row - Removed Qualified */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
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
      </div>

      {/* Secondary Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Close Rate"
          value={`${stats.closeRate.toFixed(1)}%`}
          icon={Percent}
          variant="success"
        />
        <StatCard
          title="Avg Wait Time (Licensed)"
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
        <EarningsPotentialCard leadCount={stats.totalLeads} />
      </div>

      {/* AI Suggestions */}
      <div className="mb-8">
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
      </div>

      {/* Growth Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <GrowthChart
          dailyData={dailyData}
          weeklyData={weeklyData}
          monthlyData={monthlyData}
          currentPeriodTotal={stats.totalLeads}
          previousPeriodTotal={Math.round(stats.totalLeads * 0.87)}
          className="lg:col-span-2"
        />
        <AnalyticsPieChart
          title="Lead Sources"
          icon={<MapPin className="h-5 w-5 text-primary" />}
          data={sourceData}
        />
      </div>

      {/* Quick Analytics & License Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <AnalyticsPieChart
          title="License Status"
          icon={<Award className="h-5 w-5 text-primary" />}
          data={licenseData}
        />
        <LeaderboardCard
          title="Total Applicants"
          entries={leaderboardApplicants}
          valueLabel="leads"
        />
        <LeaderboardCard
          title="Total Closed"
          entries={leaderboardClosed}
          valueLabel="closed"
        />
      </div>

      {/* Admin Quick Actions - Invite Manager Card */}
      {isAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <InviteManagerCard />
        </div>
      )}

      {/* Manager Team View */}
      {(isManager || isAdmin) && (
        <div className="mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <h3 className="text-xl font-bold">Your Team</h3>
            <p className="text-muted-foreground text-sm">
              Manage and track your team's onboarding progress
            </p>
          </motion.div>
          <ManagerTeamView />
        </div>
      )}
    </DashboardLayout>
  );
}
