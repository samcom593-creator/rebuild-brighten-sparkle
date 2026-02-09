import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Trophy, Medal, Award, TrendingUp, Users, Target, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { getTodayPST } from "@/lib/dateUtils";
import { AgentQuickEditDialog } from "./AgentQuickEditDialog";
import { getClosingRateColor } from "@/lib/closingRateColors";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  name: string;
  avatarUrl?: string;
  production: number;
  presentations: number;
  closingRate: number;
  dealsToday: number;
  isCurrentUser: boolean;
}

interface LiveLeaderboardProps {
  currentAgentId?: string;
  showAISummary?: boolean;
}

const AVATAR_COLORS = [
  "from-primary to-cyan-500",
  "from-violet-500 to-purple-500",
  "from-rose-500 to-pink-500",
  "from-amber-500 to-orange-500",
  "from-emerald-500 to-teal-500",
];

const getAvatarColor = (name: string) => {
  const hash = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

const rankIcons: Record<number, JSX.Element> = {
  1: <Trophy className="h-6 w-6 text-amber-400" />,
  2: <Medal className="h-6 w-6 text-slate-400" />,
  3: <Award className="h-6 w-6 text-amber-600" />,
};

export function LiveLeaderboard({ currentAgentId, showAISummary = true }: LiveLeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamStats, setTeamStats] = useState({
    totalProduction: 0,
    totalDeals: 0,
    avgClosingRate: 0,
    activeAgents: 0,
  });
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<{ id: string; name: string; production: number; deals: number } | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const today = getTodayPST();
      
      // Get today's production data
      const { data: productionData, error: prodError } = await supabase
        .from("daily_production")
        .select("agent_id, aop, presentations, deals_closed, closing_rate")
        .eq("production_date", today);

      if (prodError) throw prodError;

      if (!productionData?.length) {
        setEntries([]);
        setLoading(false);
        return;
      }

      // Get agent names with profile_id fallback for imported agents (exclude inactive/deactivated)
      const agentIds = productionData.map(p => p.agent_id);
      const { data: agents } = await supabase
        .from("agents")
        .select(`
          id, 
          user_id, 
          profile_id,
          display_name,
          profile:profiles!agents_profile_id_fkey(full_name, avatar_url)
        `)
        .in("id", agentIds)
        .eq("is_deactivated", false)
        .eq("is_inactive", false);

       // IMPORTANT: managers/agents may not have SELECT access to all agents returned by production.
       // Filter out any production rows whose agent record isn't visible (or was deleted).
       const allowedAgentIds = new Set((agents || []).map(a => a.id));

      const userIds = new Set(agents?.map(a => a.user_id).filter(Boolean) || []);
      const { data: allLeaderboardProfiles } = await supabase.rpc("get_leaderboard_profiles");
      const profilesByUserId = (allLeaderboardProfiles || []).filter((p: any) => userIds.has(p.user_id));

      const profileByUserIdMap = new Map(profilesByUserId?.map(p => [p.user_id, p]) || []);

      // Build leaderboard
       const leaderboard: LeaderboardEntry[] = productionData
         .filter((p) => allowedAgentIds.has(p.agent_id))
        .map(prod => {
          const agent = agents?.find(a => a.id === prod.agent_id);
          // First check profile via profile_id (for imported agents), then via user_id
          const profileViaId = agent?.profile as { full_name?: string; avatar_url?: string } | null;
          const profileViaUserId = agent?.user_id ? profileByUserIdMap.get(agent.user_id) : null;
          const displayName = profileViaId?.full_name || profileViaUserId?.full_name || agent?.display_name || "Unknown Agent";
          const avatarUrl = profileViaId?.avatar_url || profileViaUserId?.avatar_url;
          return {
            rank: 0,
            agentId: prod.agent_id,
            name: displayName,
            avatarUrl,
            production: Number(prod.aop) || 0,
            presentations: prod.presentations || 0,
            closingRate: Number(prod.closing_rate) || 0,
            dealsToday: prod.deals_closed || 0,
            isCurrentUser: prod.agent_id === currentAgentId,
          };
        })
        .sort((a, b) => b.production - a.production)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));

      setEntries(leaderboard);

      // Calculate team stats
      const totalProduction = leaderboard.reduce((sum, e) => sum + e.production, 0);
      const totalDeals = leaderboard.reduce((sum, e) => sum + e.dealsToday, 0);
      const avgClosingRate = leaderboard.length > 0
        ? leaderboard.reduce((sum, e) => sum + e.closingRate, 0) / leaderboard.length
        : 0;

      setTeamStats({
        totalProduction,
        totalDeals,
        avgClosingRate,
        activeAgents: leaderboard.length,
      });
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
    } finally {
      setLoading(false);
    }
  }, [currentAgentId]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Use shared realtime hook for instant updates
  useProductionRealtime(fetchLeaderboard, 300);

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/3" />
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-muted rounded" />
            ))}
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      {selectedAgent && (
        <AgentQuickEditDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          agentId={selectedAgent.id}
          currentName={selectedAgent.name}
          production={selectedAgent.production}
          deals={selectedAgent.deals}
          onUpdate={fetchLeaderboard}
        />
      )}
      {/* Team Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <GlassCard className="p-3 text-center">
          <p className="text-2xl font-bold gradient-text">
            ${teamStats.totalProduction.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">Production</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <p className="text-2xl font-bold">{teamStats.totalDeals}</p>
          <p className="text-xs text-muted-foreground">Families Protected</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <p className="text-2xl font-bold">{teamStats.activeAgents}</p>
          <p className="text-xs text-muted-foreground">Active Agents</p>
        </GlassCard>
        <GlassCard className="p-3 text-center">
          <p className="text-2xl font-bold">{teamStats.avgClosingRate.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">Avg Close Rate</p>
        </GlassCard>
      </div>

      {/* Top 3 Podium */}
      {entries.length >= 3 && (
        <div className="grid grid-cols-3 gap-3">
          {[1, 0, 2].map((index) => {
            const entry = entries[index];
            if (!entry) return null;
            const isFirst = entry.rank === 1;
            return (
              <motion.div
                key={entry.agentId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <GlassCard className={cn(
                  "p-4 text-center relative",
                  isFirst && "ring-2 ring-amber-400/50 bg-amber-500/5"
                )}>
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    {rankIcons[entry.rank]}
                  </div>
                  <div className={cn(
                    "h-12 w-12 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-lg font-bold mx-auto mt-4 mb-2",
                    getAvatarColor(entry.name)
                  )}>
                    {entry.name.charAt(0).toUpperCase()}
                  </div>
                  <h3 className={cn(
                    "font-semibold text-sm truncate",
                    isFirst && "text-amber-400"
                  )}>
                    {entry.name}
                  </h3>
                  <p className="text-lg font-bold gradient-text">
                    ${entry.production.toLocaleString()}
                  </p>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Full Leaderboard */}
      <GlassCard className="p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          Today's Leaderboard
        </h3>

        {entries.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No production logged today yet. Be the first!
          </p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry, index) => (
              <motion.div
                key={entry.agentId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.03 }}
                className={cn(
                  "flex items-center gap-3 p-2 rounded-lg transition-colors cursor-pointer hover:bg-muted/50",
                  entry.isCurrentUser && "bg-primary/10 ring-1 ring-primary/30"
                )}
                onClick={() => {
                  setSelectedAgent({ id: entry.agentId, name: entry.name, production: entry.production, deals: entry.dealsToday });
                  setEditDialogOpen(true);
                }}
              >
                <div className="w-6 text-center font-bold text-muted-foreground">
                  {entry.rank <= 3 ? rankIcons[entry.rank] : `#${entry.rank}`}
                </div>
                <div className={cn(
                  "h-8 w-8 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-sm font-bold shrink-0",
                  getAvatarColor(entry.name)
                )}>
                  {entry.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {entry.name}
                    {entry.isCurrentUser && (
                      <Badge variant="outline" className="ml-2 text-[10px] h-4">You</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.dealsToday} deals • <span className={cn(getClosingRateColor(entry.closingRate).textClass)}>{entry.closingRate.toFixed(0)}%</span> close rate
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-primary">
                    ${entry.production.toLocaleString()}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* AI Summary */}
      {showAISummary && entries.length > 0 && (
        <GlassCard className="p-4 border-primary/20">
          <div className="flex items-start gap-2">
            <Sparkles className="h-4 w-4 text-primary mt-0.5" />
            <div>
              <p className="text-sm font-medium mb-1">AI Summary</p>
              <p className="text-xs text-muted-foreground">
                Team closed {teamStats.totalDeals} deals today totaling ${teamStats.totalProduction.toLocaleString()} in production.
                {entries[0] && (
                  <> Top performer: <span className="text-foreground font-medium">{entries[0].name}</span> with ${entries[0].production.toLocaleString()}.</>
                )}
                {teamStats.avgClosingRate > 25 && " Great closing rate across the board!"}
                {teamStats.avgClosingRate < 15 && " Focus on objection handling to improve close rates."}
              </p>
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
