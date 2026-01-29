import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, UserPlus, Briefcase, DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { AgentQuickEditDialog } from "./AgentQuickEditDialog";
import { getTodayPST, getDateDaysAgoPST, getWeekStartPST, getMonthStartPST } from "@/lib/dateUtils";

interface BuildingLeaderboardProps {
  currentAgentId?: string;
  period: "day" | "week" | "month" | "custom";
}

interface BuildingEntry {
  rank: number;
  agentId: string;
  name: string;
  avatarUrl?: string;
  applications: number;
  contracted: number;
  projectedIncome: number;
  growthPercent: number;
  conversionRate: number;
  isCurrentUser: boolean;
}

const INCOME_PER_HIRE = 6000;

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
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<{ id: string; name: string; production: number; deals: number } | null>(null);

  const isInitialMount = useRef(true);

  useEffect(() => {
    fetchBuildingLeaderboard(true);
    
    // Realtime subscription
    const channel = supabase
      .channel("building-leaderboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, () => fetchBuildingLeaderboard(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => fetchBuildingLeaderboard(false))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [period, currentAgentId]);

  const fetchBuildingLeaderboard = async (isInitialLoad = true) => {
    try {
      if (isInitialLoad) setLoading(true);
      
      let currentStartDate: string;
      let previousStartDate: string;
      let previousEndDate: string;
      
      // Use PST timezone for all date calculations
      switch (period) {
        case "week":
          currentStartDate = getWeekStartPST();
          previousStartDate = getDateDaysAgoPST(14);
          previousEndDate = getDateDaysAgoPST(7);
          break;
        case "month":
          currentStartDate = getMonthStartPST();
          previousStartDate = getDateDaysAgoPST(60);
          previousEndDate = getDateDaysAgoPST(30);
          break;
        case "custom":
          currentStartDate = getDateDaysAgoPST(30);
          previousStartDate = getDateDaysAgoPST(60);
          previousEndDate = getDateDaysAgoPST(30);
          break;
        default: // day
          currentStartDate = getTodayPST();
          previousStartDate = getDateDaysAgoPST(1);
          previousEndDate = getTodayPST();
      }

      // Get all active agents with profile_id join for imported agents (exclude inactive/deactivated)
      const { data: allAgents } = await supabase
        .from("agents")
        .select(`
          id, 
          user_id, 
          profile_id,
          display_name,
          profile:profiles!agents_profile_id_fkey(full_name, avatar_url)
        `)
        .eq("is_deactivated", false)
        .eq("is_inactive", false);

      if (!allAgents) {
        setEntries([]);
        setLoading(false);
        return;
      }

      // Get current period applications
      let currentQuery = supabase
        .from("applications")
        .select("assigned_agent_id, status, contracted_at, created_at");
      
      if (period !== "custom") {
        currentQuery = currentQuery.gte("created_at", currentStartDate);
      }
      
      const { data: currentApplications } = await currentQuery;

      // Get previous period applications for growth calculation
      let previousQuery = supabase
        .from("applications")
        .select("assigned_agent_id, status, contracted_at, created_at")
        .gte("created_at", previousStartDate)
        .lt("created_at", previousEndDate);
      
      const { data: previousApplications } = await previousQuery;

      // Calculate stats per agent
      const agentStats: Record<string, {
        applications: number;
        contracted: number;
        previousContracted: number;
      }> = {};

      // Initialize all agents
      allAgents.forEach(agent => {
        agentStats[agent.id] = {
          applications: 0,
          contracted: 0,
          previousContracted: 0,
        };
      });

      // Count current period
      currentApplications?.forEach(app => {
        if (app.assigned_agent_id && agentStats[app.assigned_agent_id]) {
          agentStats[app.assigned_agent_id].applications++;
          // Status "approved" or has contracted_at means contracted
          if (app.status === "approved" || app.contracted_at) {
            agentStats[app.assigned_agent_id].contracted++;
          }
        }
      });

      // Count previous period for growth
      previousApplications?.forEach(app => {
        if (app.assigned_agent_id && agentStats[app.assigned_agent_id]) {
          if (app.status === "approved" || app.contracted_at) {
            agentStats[app.assigned_agent_id].previousContracted++;
          }
        }
      });

      // Get only agents with activity
      const activeAgentIds = Object.entries(agentStats)
        .filter(([_, stats]) => stats.applications > 0 || stats.contracted > 0)
        .map(([id]) => id);

      const relevantAgents = allAgents.filter(a => activeAgentIds.includes(a.id));
      const userIds = relevantAgents.map(a => a.user_id).filter(Boolean);

      const { data: profilesByUserId } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", userIds);

      const profileByUserIdMap = new Map(profilesByUserId?.map(p => [p.user_id, p]) || []);

      // Build entries
      const leaderboardEntries: BuildingEntry[] = relevantAgents.map(agent => {
        // First check profile via profile_id (for imported agents), then via user_id
        const profileViaId = agent.profile as { full_name?: string; avatar_url?: string } | null;
        const profileViaUserId = agent.user_id ? profileByUserIdMap.get(agent.user_id) : null;
        const stats = agentStats[agent.id];
        
        // Calculate growth percentage
        let growthPercent = 0;
        if (stats.previousContracted > 0) {
          growthPercent = ((stats.contracted - stats.previousContracted) / stats.previousContracted) * 100;
        } else if (stats.contracted > 0) {
          growthPercent = 100; // 100% growth if they had 0 before
        }

        // Calculate conversion rate
        const conversionRate = stats.applications > 0 
          ? (stats.contracted / stats.applications) * 100 
          : 0;

        // Name fallback: profile_id profile -> user_id profile -> display_name -> Unknown
        const displayName = profileViaId?.full_name || profileViaUserId?.full_name || agent.display_name || "Unknown";
        const avatarUrl = profileViaId?.avatar_url || profileViaUserId?.avatar_url;

        return {
          rank: 0,
          agentId: agent.id,
          name: displayName,
          avatarUrl: avatarUrl || undefined,
          applications: stats.applications,
          contracted: stats.contracted,
          projectedIncome: stats.applications * INCOME_PER_HIRE,
          growthPercent: Math.round(growthPercent),
          conversionRate: Math.round(conversionRate),
          isCurrentUser: agent.id === currentAgentId,
        };
      });

      // Sort by contracted (hired), then applications
      leaderboardEntries.sort((a, b) => {
        if (b.contracted !== a.contracted) return b.contracted - a.contracted;
        return b.applications - a.applications;
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
        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg shadow-amber-500/30">
          <span className="text-xs font-bold text-white">1</span>
        </div>
      );
    }
    if (rank === 2) {
      return (
        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-slate-300 to-slate-400">
          <span className="text-xs font-bold text-slate-700">2</span>
        </div>
      );
    }
    if (rank === 3) {
      return (
        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-amber-600 to-amber-800">
          <span className="text-xs font-bold text-white">3</span>
        </div>
      );
    }
    return (
      <div className={cn(
        "flex items-center justify-center h-6 w-6 rounded-full",
        isCurrentUser ? "bg-primary/20" : "bg-muted"
      )}>
        <span className={cn(
          "text-xs font-medium",
          isCurrentUser ? "text-primary" : "text-muted-foreground"
        )}>
          {rank}
        </span>
      </div>
    );
  };

  const formatCurrency = (amount: number) => {
    if (amount >= 1000) {
      return `$${(amount / 1000).toFixed(0)}k`;
    }
    return `$${amount}`;
  };

  return (
    <div className="space-y-2">
      {selectedAgent && (
        <AgentQuickEditDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          agentId={selectedAgent.id}
          currentName={selectedAgent.name}
          production={selectedAgent.production}
          deals={selectedAgent.deals}
          onUpdate={fetchBuildingLeaderboard}
        />
      )}
      {/* Table Header */}
      <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50">
        <div className="col-span-3">Builder</div>
        <div className="col-span-2 text-center">Apps</div>
        <div className="col-span-2 text-center">Hired</div>
        <div className="col-span-2 text-center">Conv %</div>
        <div className="col-span-2 text-center">Income</div>
        <div className="col-span-1 text-center">+/-</div>
      </div>

      {/* Entries */}
      <div className="space-y-1.5 max-h-[350px] overflow-y-auto scrollbar-custom">
        <AnimatePresence mode="popLayout">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse flex items-center gap-3 p-3">
                <div className="h-6 w-6 rounded-full bg-muted" />
                <div className="flex-1 h-4 bg-muted rounded" />
              </div>
            ))
          ) : entries.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">No recruiting activity yet</p>
              <p className="text-xs mt-1">Start building your team!</p>
            </div>
          ) : (
            entries.map((entry, index) => (
              <motion.div
                key={entry.agentId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ delay: index * 0.03 }}
                className={cn(
                  "grid grid-cols-12 gap-2 items-center px-3 py-2.5 rounded-xl transition-all cursor-pointer",
                  entry.isCurrentUser
                    ? "bg-primary/10 border border-primary/30 shadow-sm"
                    : index < 3
                      ? "bg-gradient-to-r from-amber-500/5 to-transparent border border-amber-500/10"
                      : "hover:bg-muted/40"
                )}
                onClick={() => {
                  setSelectedAgent({ id: entry.agentId, name: entry.name, production: entry.projectedIncome, deals: entry.contracted });
                  setEditDialogOpen(true);
                }}
              >
                {/* Rank + Name */}
                <div className="col-span-3 flex items-center gap-2 min-w-0">
                  {renderRankBadge(entry.rank, entry.isCurrentUser)}
                  <div className={cn(
                    "h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 bg-gradient-to-br",
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
                    "text-sm font-medium truncate",
                    entry.isCurrentUser && "text-primary font-semibold"
                  )}>
                    {entry.name.split(" ")[0]}
                  </span>
                </div>

                {/* Applications */}
                <div className="col-span-2 text-center">
                  <span className="text-xs font-semibold text-blue-400">{entry.applications}</span>
                </div>

                {/* Contracted (Hired) */}
                <div className="col-span-2 text-center">
                  <span className="text-xs font-bold text-emerald-400">{entry.contracted}</span>
                </div>

                {/* Conversion Rate */}
                <div className="col-span-2 text-center">
                  <span className={cn(
                    "text-xs font-semibold",
                    entry.conversionRate >= 50 ? "text-emerald-400" : 
                    entry.conversionRate >= 25 ? "text-amber-400" : "text-muted-foreground"
                  )}>
                    {entry.applications > 0 ? `${entry.conversionRate}%` : "-"}
                  </span>
                </div>

                {/* Projected Income */}
                <div className="col-span-2 text-center">
                  <span className={cn(
                    "text-xs font-bold",
                    entry.projectedIncome > 0 ? "text-amber-400" : "text-muted-foreground"
                  )}>
                    {entry.projectedIncome > 0 ? formatCurrency(entry.projectedIncome) : "-"}
                  </span>
                </div>

                {/* Growth % */}
                <div className="col-span-1 text-center">
                  {entry.growthPercent !== 0 ? (
                    <div className={cn(
                      "inline-flex items-center gap-0.5 text-[10px] font-semibold",
                      entry.growthPercent > 0 ? "text-emerald-400" : "text-red-400"
                    )}>
                      {entry.growthPercent > 0 ? (
                        <TrendingUp className="h-2.5 w-2.5" />
                      ) : (
                        <TrendingDown className="h-2.5 w-2.5" />
                      )}
                      <span>{entry.growthPercent > 0 ? "+" : ""}{entry.growthPercent}%</span>
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">-</span>
                  )}
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Summary Footer */}
      {entries.length > 0 && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 pt-3 border-t border-border/50"
        >
          <div className="flex flex-wrap justify-between items-center gap-3 text-xs">
            <span className="text-muted-foreground">
              <span className="font-bold text-foreground">{entries.length}</span> builders active
            </span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <UserPlus className="h-3.5 w-3.5 text-blue-400" />
                <span className="text-muted-foreground">Total Apps:</span>
                <span className="font-bold text-blue-400">
                  {entries.reduce((sum, e) => sum + e.applications, 0)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-muted-foreground">Hired:</span>
                <span className="font-bold text-emerald-400">
                  {entries.reduce((sum, e) => sum + e.contracted, 0)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-muted-foreground">Projected:</span>
                <span className="font-bold text-amber-400">
                  {formatCurrency(entries.reduce((sum, e) => sum + e.projectedIncome, 0))}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
