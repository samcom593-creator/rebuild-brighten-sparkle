import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Medal, Award, Target, Percent, Crown, Users, Flame, Circle, Building2 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { ConfettiCelebration } from "./ConfettiCelebration";
import { RankChangeIndicator } from "./RankChangeIndicator";
import { BuildingLeaderboard } from "./BuildingLeaderboard";
import { MyRankingChart } from "./MyRankingChart";
import { AgentQuickEditDialog } from "./AgentQuickEditDialog";
import { useTop3Celebration } from "@/hooks/useTop3Celebration";
import { useRankChange } from "@/hooks/useRankChange";
import { cn } from "@/lib/utils";
import { subDays } from "date-fns";

interface LeaderboardTabsProps {
  currentAgentId?: string;
}

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  name: string;
  avatarUrl?: string;
  alp: number;
  deals: number;
  presentations: number;
  passedPrice: number;
  closingRate: number;
  hoursCalled: number;
  referrals: number;
  isCurrentUser: boolean;
}

type Period = "day" | "week" | "month" | "all";
type SortCategory = "alp" | "presentations" | "closingRate" | "deals";

interface CategoryLeaders {
  alp: string | null;
  presentations: string | null;
  closingRate: string | null;
  deals: string | null;
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

export function LeaderboardTabs({ currentAgentId }: LeaderboardTabsProps) {
  const [period, setPeriod] = useState<Period>("day");
  const [sortBy, setSortBy] = useState<SortCategory>("alp");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);
  const [leaderboardMode, setLeaderboardMode] = useState<"production" | "building">("production");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<{ id: string; name: string; alp: number; deals: number } | null>(null);
  
  const { checkForCelebration, resetTracking } = useTop3Celebration({ currentAgentId });
  const { getRankChange } = useRankChange("alp");

  useEffect(() => {
    resetTracking();
    fetchLeaderboard();
    
    const channel = supabase
      .channel("leaderboard-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_production" },
        () => fetchLeaderboard()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [period, currentAgentId, resetTracking]);

  const fetchLeaderboard = async () => {
    try {
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

      let query = supabase
        .from("daily_production")
        .select(`
          agent_id,
          aop,
          deals_closed,
          presentations,
          passed_price,
          closing_rate,
          hours_called,
          referrals_caught,
          production_date
        `)
        .gte("production_date", startDate);

      if (period === "day") {
        query = query.eq("production_date", startDate);
      }

      const { data: production } = await query;

      if (!production) {
        setEntries([]);
        setLoading(false);
        return;
      }

      const agentTotals: Record<string, {
        alp: number;
        deals: number;
        presentations: number;
        passedPrice: number;
        hoursCalled: number;
        referrals: number;
        closingRates: number[];
      }> = {};

      production.forEach((p) => {
        if (!agentTotals[p.agent_id]) {
          agentTotals[p.agent_id] = {
            alp: 0,
            deals: 0,
            presentations: 0,
            passedPrice: 0,
            hoursCalled: 0,
            referrals: 0,
            closingRates: [],
          };
        }
        agentTotals[p.agent_id].alp += Number(p.aop || 0);
        agentTotals[p.agent_id].deals += Number(p.deals_closed || 0);
        agentTotals[p.agent_id].presentations += Number(p.presentations || 0);
        agentTotals[p.agent_id].passedPrice += Number(p.passed_price || 0);
        agentTotals[p.agent_id].hoursCalled += Number(p.hours_called || 0);
        agentTotals[p.agent_id].referrals += Number(p.referrals_caught || 0);
        if (Number(p.closing_rate) > 0) {
          agentTotals[p.agent_id].closingRates.push(Number(p.closing_rate));
        }
      });

      const agentIds = Object.keys(agentTotals);
      // Query agents with profile_id join for imported agents
      const { data: agents } = await supabase
        .from("agents")
        .select(`
          id, 
          user_id, 
          profile_id,
          display_name,
          profile:profiles!agents_profile_id_fkey(full_name, avatar_url)
        `)
        .in("id", agentIds);

      if (!agents) {
        setEntries([]);
        setLoading(false);
        return;
      }

      // Also get profiles via user_id for agents who have accounts
      const userIds = agents.map((a) => a.user_id).filter(Boolean);
      const { data: profilesByUserId } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", userIds);

      const leaderboardEntries: LeaderboardEntry[] = agentIds.map((agentId) => {
        const agent = agents.find((a) => a.id === agentId);
        // First check profile via profile_id (for imported agents), then via user_id
        const profileViaId = agent?.profile as { full_name?: string; avatar_url?: string } | null;
        const profileViaUserId = profilesByUserId?.find((p) => p.user_id === agent?.user_id);
        const totals = agentTotals[agentId];
        
        const avgClosingRate = totals.closingRates.length > 0
          ? totals.closingRates.reduce((a, b) => a + b, 0) / totals.closingRates.length
          : totals.presentations > 0
            ? (totals.deals / totals.presentations) * 100
            : 0;

        // Name fallback: profile_id profile -> user_id profile -> display_name -> Unknown
        const displayName = profileViaId?.full_name || profileViaUserId?.full_name || agent?.display_name || "Unknown Agent";
        const avatarUrl = profileViaId?.avatar_url || profileViaUserId?.avatar_url;

        return {
          rank: 0,
          agentId,
          name: displayName,
          avatarUrl,
          alp: totals.alp,
          deals: totals.deals,
          presentations: totals.presentations,
          passedPrice: totals.passedPrice,
          closingRate: avgClosingRate,
          hoursCalled: totals.hoursCalled,
          referrals: totals.referrals,
          isCurrentUser: agentId === currentAgentId,
        };
      });

      leaderboardEntries.sort((a, b) => b.alp - a.alp);
      leaderboardEntries.forEach((entry, index) => {
        entry.rank = index + 1;
      });

      const currentUserEntry = leaderboardEntries.find((e) => e.isCurrentUser);
      if (currentUserEntry && checkForCelebration(currentUserEntry.rank)) {
        setShowConfetti(true);
      }

      setEntries(leaderboardEntries);
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
    } finally {
      setLoading(false);
    }
  };

  const leaders = useMemo<CategoryLeaders>(() => {
    if (entries.length === 0) {
      return { alp: null, presentations: null, closingRate: null, deals: null };
    }

    const alpLeader = entries.reduce((max, e) => e.alp > (max?.alp ?? 0) ? e : max, entries[0]);
    const presentationsLeader = entries.reduce((max, e) => e.presentations > (max?.presentations ?? 0) ? e : max, entries[0]);
    const eligibleForCloseRate = entries.filter(e => e.presentations >= 3);
    const closingRateLeader = eligibleForCloseRate.length > 0 
      ? eligibleForCloseRate.reduce((max, e) => e.closingRate > (max?.closingRate ?? 0) ? e : max, eligibleForCloseRate[0])
      : null;
    const dealsLeader = entries.reduce((max, e) => e.deals > (max?.deals ?? 0) ? e : max, entries[0]);

    return {
      alp: alpLeader?.agentId || null,
      presentations: presentationsLeader?.agentId || null,
      closingRate: closingRateLeader?.agentId || null,
      deals: dealsLeader?.agentId || null,
    };
  }, [entries]);

  const sortedEntries = useMemo(() => {
    let sorted = [...entries];
    
    switch (sortBy) {
      case "presentations":
        sorted.sort((a, b) => b.presentations - a.presentations);
        break;
      case "closingRate":
        sorted = sorted.filter(e => e.presentations >= 3);
        sorted.sort((a, b) => b.closingRate - a.closingRate);
        break;
      case "deals":
        sorted.sort((a, b) => b.deals - a.deals);
        break;
      default:
        sorted.sort((a, b) => b.alp - a.alp);
    }
    
    return sorted;
  }, [entries, sortBy]);

  const maxALP = sortedEntries[0]?.alp || 1;

  const periodLabels: Record<Period, string> = {
    day: "Today",
    week: "This Week",
    month: "This Month",
    all: "All Time",
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

  const getLeaderBadge = (agentId: string) => {
    if (leaders.alp === agentId) return <Crown className="h-3 w-3 text-amber-400" />;
    if (leaders.presentations === agentId) return <Target className="h-3 w-3 text-blue-400" />;
    if (leaders.closingRate === agentId) return <Percent className="h-3 w-3 text-emerald-400" />;
    if (leaders.deals === agentId) return <Trophy className="h-3 w-3 text-purple-400" />;
    return null;
  };

  return (
    <>
      <ConfettiCelebration 
        trigger={showConfetti} 
        onComplete={() => setShowConfetti(false)} 
      />
      {selectedAgent && (
        <AgentQuickEditDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          agentId={selectedAgent.id}
          currentName={selectedAgent.name}
          production={selectedAgent.alp}
          deals={selectedAgent.deals}
          onUpdate={fetchLeaderboard}
        />
      )}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <GlassCard className="p-5">
          {/* Header - Slightly Larger */}
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2.5">
              <Trophy className="h-5 w-5 text-amber-400" />
              <h3 className="text-base font-bold">Leaderboard</h3>
              
              {/* Production/Building Toggle Button */}
              <motion.button
                onClick={() => setLeaderboardMode(mode => mode === "production" ? "building" : "production")}
                className={cn(
                  "relative px-3 py-1 rounded-full text-[10px] font-bold transition-all ml-1",
                  "bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600",
                  "text-black shadow-md shadow-amber-500/20",
                  "hover:shadow-amber-500/40",
                  "border border-amber-300/50"
                )}
                whileHover={{ 
                  y: [0, -2, 0],
                  transition: { repeat: Infinity, duration: 0.5 }
                }}
                whileTap={{ scale: 0.95 }}
              >
                <AnimatePresence mode="wait">
                  <motion.span
                    key={leaderboardMode}
                    initial={{ rotateY: 90, opacity: 0 }}
                    animate={{ rotateY: 0, opacity: 1 }}
                    exit={{ rotateY: -90, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-center gap-1"
                  >
                    {leaderboardMode === "production" ? (
                      <>
                        <Trophy className="h-3 w-3" />
                        Production
                      </>
                    ) : (
                      <>
                        <Building2 className="h-3 w-3" />
                        Building
                      </>
                    )}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
              
              <div className="flex items-center gap-1">
                <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500 animate-live-pulse" />
                <span className="text-xs text-muted-foreground">Live</span>
              </div>
              
              {/* My Rank Button */}
              <MyRankingChart 
                currentAgentId={currentAgentId} 
                entries={entries.map(e => ({
                  rank: e.rank,
                  agentId: e.agentId,
                  name: e.name,
                  alp: e.alp,
                  isCurrentUser: e.isCurrentUser,
                }))} 
              />
            </div>
            <div className="flex items-center gap-2">
              {leaderboardMode === "production" && (
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortCategory)}>
                  <SelectTrigger className="w-[110px] h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="alp" className="text-xs">By ALP</SelectItem>
                    <SelectItem value="presentations" className="text-xs">By Pres</SelectItem>
                    <SelectItem value="closingRate" className="text-xs">By Close %</SelectItem>
                    <SelectItem value="deals" className="text-xs">By Deals</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)} className="w-auto">
                <TabsList className="h-8 p-0.5">
                  <TabsTrigger value="day" className="text-xs px-2 h-7">Day</TabsTrigger>
                  <TabsTrigger value="week" className="text-xs px-2 h-7">Week</TabsTrigger>
                  <TabsTrigger value="month" className="text-xs px-2 h-7">Month</TabsTrigger>
                  <TabsTrigger value="all" className="text-xs px-2 h-7">All</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* Leaderboard Content with Flip Animation */}
          <AnimatePresence mode="wait">
            {leaderboardMode === "production" ? (
              <motion.div
                key="production-leaderboard"
                initial={{ rotateY: 90, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                exit={{ rotateY: -90, opacity: 0 }}
                transition={{ duration: 0.3 }}
                style={{ transformStyle: "preserve-3d" }}
              >
                {/* Table Header - Full labels for clarity */}
                <div className="grid grid-cols-12 gap-1 px-2 py-2 text-[9px] sm:text-[10px] font-semibold text-muted-foreground border-b border-border/50 mb-1.5">
                  <div className="col-span-1">#</div>
                  <div className="col-span-2 sm:col-span-3">Agent</div>
                  <div className="col-span-1 text-center hidden sm:block">Hours</div>
                  <div className={cn("col-span-2 sm:col-span-1 text-center", sortBy === "presentations" && "text-primary")}>Pres</div>
                  <div className={cn("col-span-2 sm:col-span-1 text-center", sortBy === "deals" && "text-primary")}>Closes</div>
                  <div className="col-span-1 text-center hidden sm:block">Refs</div>
                  <div className={cn("col-span-2 sm:col-span-1 text-center whitespace-nowrap", sortBy === "closingRate" && "text-primary")}>Close %</div>
                  <div className={cn("col-span-2 sm:col-span-2 text-right", sortBy === "alp" && "text-primary")}>ALP</div>
                </div>

          {/* Leaderboard Rows - Slightly Larger */}
          <div className="space-y-1 max-h-[380px] overflow-y-auto scrollbar-custom">
            <AnimatePresence mode="popLayout">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="animate-pulse flex items-center gap-2 p-2">
                    <div className="h-6 w-6 rounded-full bg-muted" />
                    <div className="flex-1 h-4 bg-muted rounded" />
                  </div>
                ))
              ) : sortedEntries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No production logged {periodLabels[period].toLowerCase()}</p>
                </div>
              ) : (
                sortedEntries.map((entry, index) => (
                  <motion.div
                    key={entry.agentId}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ delay: index * 0.02 }}
                    className={cn(
                      "grid grid-cols-12 gap-1 items-center px-2 py-2 rounded-lg transition-all cursor-pointer",
                      entry.isCurrentUser
                        ? "bg-primary/10 border border-primary/30"
                        : index < 3
                          ? "bg-amber-500/5"
                          : "hover:bg-muted/30"
                    )}
                    style={{ minHeight: "40px" }}
                    onClick={() => {
                      setSelectedAgent({ id: entry.agentId, name: entry.name, alp: entry.alp, deals: entry.deals });
                      setEditDialogOpen(true);
                    }}
                  >
                    {/* Rank */}
                    <div className="col-span-1 flex items-center justify-center">
                      {renderRankBadge(index + 1, entry.isCurrentUser)}
                    </div>

                    {/* Agent */}
                    <div className="col-span-2 sm:col-span-3 flex items-center gap-1.5 min-w-0">
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
                      <div className="min-w-0 flex items-center gap-0.5">
                        <span className={cn(
                          "text-xs font-medium truncate",
                          entry.isCurrentUser && "text-primary"
                        )}>
                          {entry.name.split(" ")[0]}
                        </span>
                        {getLeaderBadge(entry.agentId)}
                      </div>
                    </div>

                    {/* Hours Dialed - Hidden on mobile */}
                    <div className="col-span-1 text-center hidden sm:block">
                      <span className="text-[10px] text-muted-foreground">{entry.hoursCalled.toFixed(1)}</span>
                    </div>

                    {/* Presentations */}
                    <div className={cn("col-span-2 sm:col-span-1 text-center", sortBy === "presentations" && "text-primary")}>
                      <span className="text-[10px]">{entry.presentations}</span>
                    </div>

                    {/* Closes */}
                    <div className={cn("col-span-2 sm:col-span-1 text-center", sortBy === "deals" && "text-primary")}>
                      <span className="text-[10px] font-semibold">{entry.deals}</span>
                    </div>

                    {/* Referrals - Hidden on mobile */}
                    <div className="col-span-1 text-center hidden sm:block">
                      <span className="text-[10px] text-muted-foreground">{entry.referrals}</span>
                    </div>

                    {/* Close % */}
                    <div className={cn("col-span-2 sm:col-span-1 text-center", sortBy === "closingRate" && "text-primary")}>
                      <span className={cn(
                        "text-[10px] font-medium",
                        entry.closingRate >= 30 && "text-emerald-500",
                        entry.closingRate >= 50 && "text-amber-400"
                      )}>
                        {entry.closingRate.toFixed(0)}%
                      </span>
                    </div>

                    {/* ALP with Progress */}
                    <div className={cn("col-span-2 text-right", sortBy === "alp" && "text-primary")}>
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-xs font-bold">
                          ${entry.alp >= 1000 ? `${(entry.alp / 1000).toFixed(1)}k` : entry.alp.toLocaleString()}
                        </span>
                        {index > 0 && (
                          <Progress 
                            value={(entry.alp / maxALP) * 100} 
                            className="h-1 w-full max-w-[48px]"
                          />
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>

          {/* Footer with Totals */}
          {sortedEntries.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground">
                <span>
                  <span className="font-semibold text-foreground">{sortedEntries.length}</span> ranked
                </span>
                <div className="flex items-center gap-3">
                  <span>
                    Pres: <span className="font-bold text-foreground">
                      {entries.reduce((sum, e) => sum + e.presentations, 0)}
                    </span>
                  </span>
                  <span>
                    Refs: <span className="font-bold text-foreground">
                      {entries.reduce((sum, e) => sum + e.referrals, 0)}
                    </span>
                  </span>
                  <span>
                    Total: <span className="font-bold text-primary">
                      ${entries.reduce((sum, e) => sum + e.alp, 0).toLocaleString()}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )}
              </motion.div>
            ) : (
              <motion.div
                key="building-leaderboard"
                initial={{ rotateY: -90, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                exit={{ rotateY: 90, opacity: 0 }}
                transition={{ duration: 0.3 }}
                style={{ transformStyle: "preserve-3d" }}
              >
                <BuildingLeaderboard currentAgentId={currentAgentId} period={period} />
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>
      </motion.div>
    </>
  );
}
