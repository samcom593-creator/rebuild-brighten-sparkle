import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Medal, Award, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

interface ManagerRanking {
  rank: number;
  agentId: string;
  name: string;
  totalRecruits: number;
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

      // Get application counts for each manager
      const managerAgentIds = managerAgents.map(a => a.id);
      const { data: applications, error: appsError } = await supabase
        .from("applications")
        .select("assigned_agent_id")
        .in("assigned_agent_id", managerAgentIds);

      if (appsError) throw appsError;

      // Count applications per agent
      const countMap = new Map<string, number>();
      applications?.forEach(app => {
        if (app.assigned_agent_id) {
          countMap.set(app.assigned_agent_id, (countMap.get(app.assigned_agent_id) || 0) + 1);
        }
      });

      // Build rankings
      const managerRankings: ManagerRanking[] = managerAgents
        .map(agent => ({
          agentId: agent.id,
          name: profileMap.get(agent.user_id!) || "Unknown",
          totalRecruits: countMap.get(agent.id) || 0,
          isCurrentUser: agent.user_id === user?.id,
          rank: 0,
        }))
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
              <div className="w-8 flex justify-center">
                {manager.rank <= 3 ? (
                  rankIcons[manager.rank as 1 | 2 | 3]
                ) : (
                  <span className="text-muted-foreground font-medium">
                    {manager.rank}
                  </span>
                )}
              </div>
              <div className="flex-1">
                <p
                  className={cn(
                    "font-medium text-sm",
                    manager.isCurrentUser && "text-primary"
                  )}
                >
                  {manager.name}
                  {manager.isCurrentUser && (
                    <span className="ml-2 text-xs">(You)</span>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold text-foreground">{manager.totalRecruits}</p>
                <p className="text-xs text-muted-foreground">
                  {manager.totalRecruits === 1 ? "recruit" : "recruits"}
                </p>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </GlassCard>
  );
}
