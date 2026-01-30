import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
import { MobileLeaderboardCard } from "./MobileLeaderboardCard";
import { useTop3Celebration } from "@/hooks/useTop3Celebration";
import { useRankChange } from "@/hooks/useRankChange";
import { useIsMobile } from "@/hooks/use-mobile";
import { format } from "date-fns";
import { DateRangePicker, DateRange } from "@/components/ui/date-range-picker";
import { getTodayPST, getWeekStartPST, getMonthStartPST, getDateDaysAgoPST } from "@/lib/dateUtils";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";

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

type Period = "day" | "week" | "month" | "custom";
import { cn } from "@/lib/utils";
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
  const [customDateRange, setCustomDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [sortBy, setSortBy] = useState<SortCategory>("alp");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);
  const [leaderboardMode, setLeaderboardMode] = useState<"production" | "building">("production");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<{ 
    id: string; 
    name: string; 
    alp: number; 
    deals: number;
    period: Period;
    startDate?: string;
    endDate?: string;
  } | null>(null);
  
  const isMobile = useIsMobile();
  const { checkForCelebration, resetTracking } = useTop3Celebration({ currentAgentId });
  const { getRankChange } = useRankChange("alp");

  const isInitialMount = useRef(true);

  const fetchLeaderboard = useCallback(async (isInitialLoad = true) => {
    try {
      if (isInitialLoad) setLoading(true);
      
      let startDate: string;
      
      // Use PST timezone for all date calculations
      switch (period) {
        case "week":
          startDate = getWeekStartPST();
          break;
        case "month":
          startDate = getMonthStartPST();
          break;
        case "custom":
          if (customDateRange.from) {
            startDate = format(customDateRange.from, "yyyy-MM-dd");
          } else {
            startDate = getDateDaysAgoPST(30);
          }
          break;
        default:
          startDate = getTodayPST();
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
      // Query agents with profile_id join for imported agents (exclude inactive/deactivated)
      const { data: agents } = await supabase
        .from("agents")
        .select(`
          id, 
          user_id, 
          profile_id,
          display_name,
          is_deactivated,
          is_inactive,
          profile:profiles!agents_profile_id_fkey(full_name, avatar_url)
        `)
        .in("id", agentIds)
        .eq("is_deactivated", false)
        .eq("is_inactive", false);

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

      // IMPORTANT: not every viewer can see every agent (RLS) and deleted agents will not resolve.
      // Only include entries for agents we can actually load from the agents table.
      const allowedAgentIds = new Set(agents.map((a) => a.id));
      const visibleAgentIds = agentIds.filter((id) => allowedAgentIds.has(id));

      const leaderboardEntries: LeaderboardEntry[] = visibleAgentIds.map((agentId) => {
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
  }, [period, customDateRange, currentAgentId, checkForCelebration]);

  useEffect(() => {
    // Only reset tracking on initial mount
    if (isInitialMount.current) {
      resetTracking();
      isInitialMount.current = false;
    }
    fetchLeaderboard(true);
  }, [fetchLeaderboard]);

  // Use shared realtime hook for instant updates
  useProductionRealtime(() => fetchLeaderboard(false), 300);

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
    custom: "Custom Range",
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
          period={selectedAgent.period}
          dateRange={{ from: selectedAgent.startDate, to: selectedAgent.endDate }}
        />
      )}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <GlassCard className="p-3 sm:p-5 overflow-hidden">
          {/* Header - Mobile Optimized */}
          <div className="flex flex-col gap-3 mb-4">
            {/* Title Row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Trophy className="h-5 w-5 text-amber-400 shrink-0" />
                <h3 className="text-sm sm:text-base font-bold truncate">Leaderboard</h3>
                
                {/* Production/Building Toggle Button */}
                <motion.button
                  onClick={() => setLeaderboardMode(mode => mode === "production" ? "building" : "production")}
                  className={cn(
                    "relative px-2 sm:px-3 py-1 rounded-full text-[10px] font-bold transition-all shrink-0",
                    "bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600",
                    "text-black shadow-md shadow-amber-500/20",
                    "hover:shadow-amber-500/40 active:scale-95",
                    "border border-amber-300/50"
                  )}
                  whileTap={{ scale: 0.95 }}
                >
                <AnimatePresence mode="sync">
                    <motion.span
                      key={leaderboardMode}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="flex items-center gap-1"
                    >
                      {leaderboardMode === "production" ? (
                        <>
                          <Trophy className="h-3 w-3" />
                          <span className="hidden xs:inline">Prod</span>
                        </>
                      ) : (
                        <>
                          <Building2 className="h-3 w-3" />
                          <span className="hidden xs:inline">Build</span>
                        </>
                      )}
                    </motion.span>
                  </AnimatePresence>
                </motion.button>
              </div>
              
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1">
                  <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500 animate-live-pulse" />
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">Live</span>
                </div>
                
                {/* My Rank Button - hidden on very small screens */}
                <div className="hidden sm:block">
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
              </div>
            </div>
            
            {/* Controls Row - Stack on mobile */}
            <div className="flex flex-col xs:flex-row gap-2 w-full">
              {leaderboardMode === "production" && (
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortCategory)}>
                  <SelectTrigger className="w-full xs:w-auto xs:min-w-[90px] h-8 text-xs bg-background">
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
              <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)} className="flex-1">
                <TabsList className="h-8 p-0.5 w-full grid grid-cols-4">
                  <TabsTrigger value="day" className="text-[10px] px-1 sm:px-2 h-7">Day</TabsTrigger>
                  <TabsTrigger value="week" className="text-[10px] px-1 sm:px-2 h-7">Week</TabsTrigger>
                  <TabsTrigger value="month" className="text-[10px] px-1 sm:px-2 h-7">Month</TabsTrigger>
                  <TabsTrigger value="custom" className="text-[10px] px-1 sm:px-2 h-7">Custom</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          
          {/* Custom Date Range Picker */}
          {period === "custom" && (
            <div className="mt-2">
              <DateRangePicker
                value={customDateRange}
                onChange={setCustomDateRange}
                simpleMode
                className="w-full"
              />
            </div>
          )}
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
                {/* Mobile Card Layout */}
                {isMobile ? (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-custom">
                    {loading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="animate-pulse p-4 rounded-xl bg-muted/30">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-muted" />
                            <div className="h-10 w-10 rounded-full bg-muted" />
                            <div className="flex-1 space-y-2">
                              <div className="h-4 bg-muted rounded w-2/3" />
                              <div className="h-3 bg-muted rounded w-1/2" />
                            </div>
                            <div className="h-6 w-16 bg-muted rounded" />
                          </div>
                        </div>
                      ))
                    ) : sortedEntries.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No production logged {periodLabels[period].toLowerCase()}</p>
                      </div>
                    ) : (
                      sortedEntries.map((entry, index) => (
                        <MobileLeaderboardCard
                          key={entry.agentId}
                          entry={{
                            rank: index + 1,
                            agentId: entry.agentId,
                            name: entry.name,
                            avatarUrl: entry.avatarUrl,
                            alp: entry.alp,
                            deals: entry.deals,
                            presentations: entry.presentations,
                            closingRate: entry.closingRate,
                            isCurrentUser: entry.isCurrentUser,
                          }}
                          index={index}
                          onClick={() => {
                            // Calculate date range for the current period
                            let startDate: string;
                            let endDate: string = getTodayPST();
                            
                            switch (period) {
                              case "week":
                                startDate = getWeekStartPST();
                                break;
                              case "month":
                                startDate = getMonthStartPST();
                                break;
                              case "custom":
                                startDate = customDateRange.from ? format(customDateRange.from, "yyyy-MM-dd") : getDateDaysAgoPST(30);
                                endDate = customDateRange.to ? format(customDateRange.to, "yyyy-MM-dd") : getTodayPST();
                                break;
                              default:
                                startDate = getTodayPST();
                            }
                            
                            setSelectedAgent({ 
                              id: entry.agentId, 
                              name: entry.name, 
                              alp: entry.alp, 
                              deals: entry.deals,
                              period,
                              startDate,
                              endDate,
                            });
                            setEditDialogOpen(true);
                          }}
                          leaders={leaders}
                        />
                      ))
                    )}
                  </div>
                ) : (
                  <>
                    {/* Desktop Table Header */}
                    <div className="grid grid-cols-12 gap-1 px-2 py-2 text-[10px] font-semibold text-muted-foreground border-b border-border/50 mb-1.5">
                      <div className="col-span-1">#</div>
                      <div className="col-span-3">Agent</div>
                      <div className="col-span-1 text-center">Hours</div>
                      <div className={cn("col-span-1 text-center", sortBy === "presentations" && "text-primary")}>Pres</div>
                      <div className={cn("col-span-1 text-center", sortBy === "deals" && "text-primary")}>Closes</div>
                      <div className="col-span-1 text-center">Refs</div>
                      <div className={cn("col-span-1 text-center whitespace-nowrap", sortBy === "closingRate" && "text-primary")}>Close %</div>
                      <div className={cn("col-span-2 text-right", sortBy === "alp" && "text-primary")}>ALP</div>
                    </div>

                    {/* Desktop Leaderboard Rows */}
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
                                // Calculate date range for the current period
                                let startDate: string;
                                let endDate: string = getTodayPST();
                                
                                switch (period) {
                                  case "week":
                                    startDate = getWeekStartPST();
                                    break;
                                  case "month":
                                    startDate = getMonthStartPST();
                                    break;
                                  case "custom":
                                    startDate = customDateRange.from ? format(customDateRange.from, "yyyy-MM-dd") : getDateDaysAgoPST(30);
                                    endDate = customDateRange.to ? format(customDateRange.to, "yyyy-MM-dd") : getTodayPST();
                                    break;
                                  default:
                                    startDate = getTodayPST();
                                }
                                
                                setSelectedAgent({ 
                                  id: entry.agentId, 
                                  name: entry.name, 
                                  alp: entry.alp, 
                                  deals: entry.deals,
                                  period,
                                  startDate,
                                  endDate,
                                });
                                setEditDialogOpen(true);
                              }}
                            >
                              {/* Rank */}
                              <div className="col-span-1 flex items-center justify-center">
                                {renderRankBadge(index + 1, entry.isCurrentUser)}
                              </div>

                              {/* Agent */}
                              <div className="col-span-3 flex items-center gap-1.5 min-w-0">
                                <div className={cn(
                                  "h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-primary-foreground shrink-0 bg-gradient-to-br",
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

                              {/* Hours Dialed */}
                              <div className="col-span-1 text-center">
                                <span className="text-[10px] text-muted-foreground">{entry.hoursCalled.toFixed(1)}</span>
                              </div>

                              {/* Presentations */}
                              <div className={cn("col-span-1 text-center", sortBy === "presentations" && "text-primary")}>
                                <span className="text-[10px]">{entry.presentations}</span>
                              </div>

                              {/* Closes */}
                              <div className={cn("col-span-1 text-center", sortBy === "deals" && "text-primary")}>
                                <span className="text-[10px] font-semibold">{entry.deals}</span>
                              </div>

                              {/* Referrals */}
                              <div className="col-span-1 text-center">
                                <span className="text-[10px] text-muted-foreground">{entry.referrals}</span>
                              </div>

                              {/* Close % */}
                              <div className={cn("col-span-1 text-center", sortBy === "closingRate" && "text-primary")}>
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
                  </>
                )}

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
