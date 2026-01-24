import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Medal, Award, Users, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";

interface ManagerRanking {
  rank: number;
  agentId: string;
  name: string;
  totalRecruits: number;
  licensedRecruits: number;
  unlicensedRecruits: number;
  closedRecruits: number;
  isCurrentUser: boolean;
}

const rankIcons = {
  1: <Trophy className="h-5 w-5 text-yellow-400" />,
  2: <Medal className="h-5 w-5 text-gray-300" />,
  3: <Award className="h-5 w-5 text-amber-600" />,
};

export function ManagerLeaderboard() {
  const { user } = useAuth();
  const [rankings, setRankings] = useState<ManagerRanking[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeaderboard = async () => {
    try {
      // Get all active agents
      const { data: agents, error: agentsError } = await supabase
        .from("agents")
        .select("id, user_id, status")
        .eq("status", "active");

      if (agentsError) throw agentsError;
      if (!agents || agents.length === 0) {
        setRankings([]);
        setLoading(false);
        return;
      }

      // Get all manager user_ids from user_roles
      const { data: managerRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager");

      if (rolesError) throw rolesError;

      const managerUserIds = new Set(managerRoles?.map(r => r.user_id) || []);

      // Filter agents to only managers
      const managerAgents = agents.filter(a => a.user_id && managerUserIds.has(a.user_id));

      if (managerAgents.length === 0) {
        setRankings([]);
        setLoading(false);
        return;
      }

      // Get profiles for all managers
      const managerUserIdList = managerAgents.map(a => a.user_id).filter(Boolean) as string[];
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", managerUserIdList);

      if (profilesError) throw profilesError;

      const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);

      // Get all applications for managers with full details
      const managerAgentIds = managerAgents.map(a => a.id);
      const { data: applications, error: appsError } = await supabase
        .from("applications")
        .select("assigned_agent_id, license_status, closed_at")
        .in("assigned_agent_id", managerAgentIds);

      if (appsError) throw appsError;

      // Count applications per agent with breakdowns
      const statsMap = new Map<string, { total: number; licensed: number; unlicensed: number; closed: number }>();
      
      managerAgentIds.forEach(id => {
        statsMap.set(id, { total: 0, licensed: 0, unlicensed: 0, closed: 0 });
      });

      applications?.forEach(app => {
        if (app.assigned_agent_id) {
          const stats = statsMap.get(app.assigned_agent_id);
          if (stats) {
            stats.total++;
            if (app.license_status === "licensed") {
              stats.licensed++;
            } else {
              stats.unlicensed++;
            }
            if (app.closed_at) {
              stats.closed++;
            }
          }
        }
      });

      // Build rankings
      const managerRankings: ManagerRanking[] = managerAgents
        .map(agent => {
          const stats = statsMap.get(agent.id) || { total: 0, licensed: 0, unlicensed: 0, closed: 0 };
          return {
            agentId: agent.id,
            name: profileMap.get(agent.user_id!) || "Unknown",
            totalRecruits: stats.total,
            licensedRecruits: stats.licensed,
            unlicensedRecruits: stats.unlicensed,
            closedRecruits: stats.closed,
            isCurrentUser: agent.user_id === user?.id,
            rank: 0,
          };
        })
        .sort((a, b) => b.totalRecruits - a.totalRecruits)
        .map((manager, index) => ({
          ...manager,
          rank: index + 1,
        }));

      setRankings(managerRankings);
    } catch (error) {
      console.error("Error fetching manager leaderboard:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();

    // Subscribe to real-time updates
    const channel = supabase
      .channel("manager-leaderboard-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications" },
        () => fetchLeaderboard()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Prepare chart data
  const chartData = rankings.map(m => ({
    name: m.name.split(" ")[0], // First name only for chart
    Licensed: m.licensedRecruits,
    Unlicensed: m.unlicensedRecruits,
    Closed: m.closedRecruits,
    total: m.totalRecruits,
  }));

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Manager Leaderboard</h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-muted/50 rounded-lg animate-pulse" />
          ))}
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-6">
      {/* Bar Chart Visualization */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Recruit Comparison</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Visual breakdown of recruits by manager
        </p>
        {rankings.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No data to display yet</p>
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="name" 
                  tick={{ fontSize: 12 }}
                  className="fill-muted-foreground"
                />
                <YAxis 
                  tick={{ fontSize: 12 }}
                  className="fill-muted-foreground"
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Legend />
                <Bar 
                  dataKey="Licensed" 
                  stackId="a"
                  fill="hsl(168, 84%, 42%)" 
                  radius={[0, 0, 0, 0]}
                />
                <Bar 
                  dataKey="Unlicensed" 
                  stackId="a"
                  fill="hsl(222, 47%, 50%)" 
                  radius={[0, 0, 0, 0]}
                />
                <Bar 
                  dataKey="Closed" 
                  fill="hsl(45, 93%, 50%)" 
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </GlassCard>

      {/* Rankings Table */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Manager Leaderboard</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Total applicants recruited by each manager
        </p>
        <div className="space-y-3">
          {rankings.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No managers with recruits yet</p>
            </div>
          ) : (
            rankings.map((manager, index) => (
              <motion.div
                key={manager.agentId}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg transition-colors",
                  manager.isCurrentUser
                    ? "bg-primary/20 border border-primary/30"
                    : "bg-muted/50"
                )}
              >
                <div className="w-8 flex justify-center flex-shrink-0">
                  {manager.rank <= 3 ? (
                    rankIcons[manager.rank as 1 | 2 | 3]
                  ) : (
                    <span className="text-muted-foreground font-medium">
                      {manager.rank}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "font-medium text-sm truncate",
                      manager.isCurrentUser && "text-primary"
                    )}
                  >
                    {manager.name}
                    {manager.isCurrentUser && (
                      <span className="ml-2 text-xs">(You)</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-right flex-shrink-0">
                  <div>
                    <p className="font-bold text-foreground">{manager.totalRecruits}</p>
                    <p className="text-xs text-muted-foreground">total</p>
                  </div>
                  <div className="hidden sm:block">
                    <p className="font-semibold text-emerald-500">{manager.licensedRecruits}</p>
                    <p className="text-xs text-muted-foreground">licensed</p>
                  </div>
                  <div className="hidden sm:block">
                    <p className="font-semibold text-blue-500">{manager.unlicensedRecruits}</p>
                    <p className="text-xs text-muted-foreground">unlicensed</p>
                  </div>
                  <div>
                    <p className="font-semibold text-yellow-500">{manager.closedRecruits}</p>
                    <p className="text-xs text-muted-foreground">closed</p>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </GlassCard>
    </div>
  );
}
