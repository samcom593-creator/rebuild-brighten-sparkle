import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, UserPlus, GraduationCap, Award, Flame, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { subDays } from "date-fns";

interface BuildingLeaderboardProps {
  currentAgentId?: string;
  period: "day" | "week" | "month" | "all";
}

interface BuildingEntry {
  rank: number;
  agentId: string;
  name: string;
  avatarUrl?: string;
  totalApplicants: number;
  referrals: number;
  inCourse: number;
  licensed: number;
  isCurrentUser: boolean;
}

const getAvatarColor = (name: string) => {
  const colors = [
    "from-primary to-primary/60",
    "from-emerald-500 to-emerald-600",
    "from-amber-500 to-orange-500",
    "from-purple-500 to-pink-500",
    "from-cyan-500 to-blue-500",
  ];
  const index = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[index % colors.length];
};

const getInitials = (name: string) => {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
};

export function BuildingLeaderboard({ currentAgentId, period }: BuildingLeaderboardProps) {
  const [entries, setEntries] = useState<BuildingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBuildingLeaderboard();
  }, [period, currentAgentId]);

  const fetchBuildingLeaderboard = async () => {
    try {
      setLoading(true);
      
      // Get date range based on period
      let startDate: string;
      const today = new Date();
      
      switch (period) {
        case "week":
          startDate = subDays(today, 7).toISOString().split("T")[0];
          break;
        case "month":
          startDate = subDays(today, 30).toISOString().split("T")[0];
          break;
        case "all":
          startDate = subDays(today, 365).toISOString().split("T")[0];
          break;
        default:
          startDate = today.toISOString().split("T")[0];
      }

      // Get all agents who have invited people OR have applicants
      const { data: allAgents } = await supabase
        .from("agents")
        .select("id, user_id, invited_by_manager_id")
        .eq("is_deactivated", false);

      if (!allAgents) {
        setEntries([]);
        setLoading(false);
        return;
      }

      // Get applications with date filter
      let applicationsQuery = supabase
        .from("applications")
        .select("assigned_agent_id, created_at, license_status");
      
      if (period !== "all") {
        applicationsQuery = applicationsQuery.gte("created_at", startDate);
      }
      
      const { data: applications } = await applicationsQuery;

      // Count referrals from daily_production with date filter
      let productionQuery = supabase
        .from("daily_production")
        .select("agent_id, referrals_caught");
      
      if (period === "day") {
        productionQuery = productionQuery.eq("production_date", startDate);
      } else if (period !== "all") {
        productionQuery = productionQuery.gte("production_date", startDate);
      }
      
      const { data: production } = await productionQuery;

      // Count agents invited by each manager and their onboarding status
      const managerStats: Record<string, {
        totalApplicants: number;
        referrals: number;
        inCourse: number;
        licensed: number;
      }> = {};

      // Initialize all agents with stats
      allAgents.forEach(agent => {
        managerStats[agent.id] = {
          totalApplicants: 0,
          referrals: 0,
          inCourse: 0,
          licensed: 0,
        };
      });

      // Count applications per assigned agent
      applications?.forEach(app => {
        if (app.assigned_agent_id && managerStats[app.assigned_agent_id]) {
          managerStats[app.assigned_agent_id].totalApplicants++;
          if (app.license_status === "licensed") {
            managerStats[app.assigned_agent_id].licensed++;
          }
        }
      });

      // Count agents in course per manager
      allAgents.forEach(agent => {
        if (agent.invited_by_manager_id && managerStats[agent.invited_by_manager_id]) {
          managerStats[agent.invited_by_manager_id].inCourse++;
        }
      });

      // Sum referrals from production
      production?.forEach(p => {
        if (p.agent_id && managerStats[p.agent_id]) {
          managerStats[p.agent_id].referrals += Number(p.referrals_caught || 0);
        }
      });

      // Get user IDs for profile lookup
      const agentIdsWithActivity = Object.entries(managerStats)
        .filter(([_, stats]) => 
          stats.totalApplicants > 0 || stats.referrals > 0 || stats.inCourse > 0
        )
        .map(([id]) => id);

      const relevantAgents = allAgents.filter(a => agentIdsWithActivity.includes(a.id));
      const userIds = relevantAgents.map(a => a.user_id).filter(Boolean);

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", userIds);

      // Build leaderboard entries
      const leaderboardEntries: BuildingEntry[] = relevantAgents.map(agent => {
        const profile = profiles?.find(p => p.user_id === agent.user_id);
        const stats = managerStats[agent.id];

        return {
          rank: 0,
          agentId: agent.id,
          name: profile?.full_name || "Unknown",
          avatarUrl: profile?.avatar_url || undefined,
          totalApplicants: stats.totalApplicants,
          referrals: stats.referrals,
          inCourse: stats.inCourse,
          licensed: stats.licensed,
          isCurrentUser: agent.id === currentAgentId,
        };
      });

      // Sort by total applicants, then by referrals
      leaderboardEntries.sort((a, b) => {
        if (b.totalApplicants !== a.totalApplicants) return b.totalApplicants - a.totalApplicants;
        return b.referrals - a.referrals;
      });

      leaderboardEntries.forEach((entry, index) => {
        entry.rank = index + 1;
      });

      setEntries(leaderboardEntries);
    } catch (error) {
      console.error("Error fetching building leaderboard:", error);
    } finally {
      setLoading(false);
    }
  };

  const renderRankBadge = (rank: number, isCurrentUser: boolean) => {
    if (rank === 1) {
      return (
        <div className="flex items-center justify-center h-5 w-5 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 animate-rank-glow">
          <span className="text-[10px] font-bold text-white">1</span>
        </div>
      );
    }
    if (rank === 2) {
      return (
        <div className="flex items-center justify-center h-5 w-5 rounded-full bg-gradient-to-br from-slate-300 to-slate-400">
          <span className="text-[10px] font-bold text-slate-700">2</span>
        </div>
      );
    }
    if (rank === 3) {
      return (
        <div className="flex items-center justify-center h-5 w-5 rounded-full bg-gradient-to-br from-amber-600 to-amber-800">
          <span className="text-[10px] font-bold text-white">3</span>
        </div>
      );
    }
    return (
      <span className={cn(
        "text-[11px] font-medium w-5 text-center",
        isCurrentUser ? "text-primary" : "text-muted-foreground"
      )}>
        {rank}
      </span>
    );
  };

  return (
    <div className="space-y-1 max-h-[380px] overflow-y-auto scrollbar-custom">
      {/* Table Header */}
      <div className="grid grid-cols-12 gap-1 px-2 py-2 text-[9px] sm:text-[10px] font-semibold text-muted-foreground border-b border-border/50 mb-1.5">
        <div className="col-span-1">#</div>
        <div className="col-span-3 sm:col-span-4">Agent</div>
        <div className="col-span-2 text-center">Applicants</div>
        <div className="col-span-2 text-center">Referrals</div>
        <div className="col-span-2 text-center hidden sm:block">In Course</div>
        <div className="col-span-2 text-center">Licensed</div>
      </div>

      <AnimatePresence mode="popLayout">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse flex items-center gap-2 p-2">
              <div className="h-6 w-6 rounded-full bg-muted" />
              <div className="flex-1 h-4 bg-muted rounded" />
            </div>
          ))
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No recruiting activity yet</p>
          </div>
        ) : (
          entries.map((entry, index) => (
            <motion.div
              key={entry.agentId}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ delay: index * 0.02 }}
              className={cn(
                "grid grid-cols-12 gap-1 items-center px-2 py-2 rounded-lg transition-all",
                entry.isCurrentUser
                  ? "bg-primary/10 border border-primary/30"
                  : index < 3
                    ? "bg-amber-500/5"
                    : "hover:bg-muted/30"
              )}
              style={{ minHeight: "40px" }}
            >
              {/* Rank */}
              <div className="col-span-1 flex items-center justify-center">
                {renderRankBadge(index + 1, entry.isCurrentUser)}
              </div>

              {/* Agent */}
              <div className="col-span-3 sm:col-span-4 flex items-center gap-1.5 min-w-0">
                <div className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 bg-gradient-to-br",
                  entry.avatarUrl ? "" : getAvatarColor(entry.name)
                )}>
                  {entry.avatarUrl ? (
                    <img 
                      src={entry.avatarUrl} 
                      alt={entry.name} 
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    getInitials(entry.name)
                  )}
                </div>
                <span className={cn(
                  "text-xs font-medium truncate",
                  entry.isCurrentUser && "text-primary"
                )}>
                  {entry.name.split(" ")[0]}
                </span>
              </div>

              {/* Applicants */}
              <div className="col-span-2 text-center">
                <div className="flex items-center justify-center gap-1">
                  <UserPlus className="h-3 w-3 text-blue-400" />
                  <span className="text-[10px] font-semibold">{entry.totalApplicants}</span>
                </div>
              </div>

              {/* Referrals */}
              <div className="col-span-2 text-center">
                <div className="flex items-center justify-center gap-1">
                  <Flame className="h-3 w-3 text-orange-400" />
                  <span className="text-[10px]">{entry.referrals}</span>
                </div>
              </div>

              {/* In Course - Hidden on mobile */}
              <div className="col-span-2 text-center hidden sm:flex items-center justify-center gap-1">
                <GraduationCap className="h-3 w-3 text-purple-400" />
                <span className="text-[10px]">{entry.inCourse}</span>
              </div>

              {/* Licensed */}
              <div className="col-span-2 text-center">
                <div className="flex items-center justify-center gap-1">
                  <CheckCircle className="h-3 w-3 text-emerald-400" />
                  <span className="text-[10px] font-medium text-emerald-500">{entry.licensed}</span>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </AnimatePresence>

      {/* Footer with Totals */}
      {entries.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">{entries.length}</span> builders
            </span>
            <div className="flex items-center gap-3">
              <span>
                Total Applicants: <span className="font-bold text-blue-400">
                  {entries.reduce((sum, e) => sum + e.totalApplicants, 0)}
                </span>
              </span>
              <span>
                Licensed: <span className="font-bold text-emerald-400">
                  {entries.reduce((sum, e) => sum + e.licensed, 0)}
                </span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
