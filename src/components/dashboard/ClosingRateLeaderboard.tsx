import { useState, useEffect, useRef, useCallback } from "react";
import { Percent, Trophy, Medal, Award, Radio } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/integrations/supabase/client";
import { ConfettiCelebration } from "./ConfettiCelebration";
import { RankChangeIndicator } from "./RankChangeIndicator";
import { useTop3Celebration } from "@/hooks/useTop3Celebration";
import { useRankChange } from "@/hooks/useRankChange";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { getClosingRateColor } from "@/lib/closingRateColors";
import { cn } from "@/lib/utils";
import { getTodayPST, getWeekStartPST, getMonthStartPST } from "@/lib/dateUtils";

interface ClosingRateLeaderboardProps {
  currentAgentId?: string;
  period?: "day" | "week" | "month";
}

interface RateEntry {
  rank: number;
  agentId: string;
  name: string;
  closingRate: number;
  presentations: number;
  deals: number;
  isCurrentUser: boolean;
}

const rankIcons: Record<number, JSX.Element> = {
  1: <Trophy className="h-4 w-4 text-amber-400" />,
  2: <Medal className="h-4 w-4 text-slate-300" />,
  3: <Award className="h-4 w-4 text-amber-600" />,
};

export function ClosingRateLeaderboard({ currentAgentId, period = "week" }: ClosingRateLeaderboardProps) {
  const [entries, setEntries] = useState<RateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  
  const { checkForCelebration, resetTracking } = useTop3Celebration({ currentAgentId });
  const { getRankChange } = useRankChange("closing-rate");

  const isInitialMount = useRef(true);

  const fetchLeaderboard = async (isInitialLoad = true) => {
    try {
      if (isInitialLoad) setLoading(true);
      
      let startDate: string;
      
      // Use PST timezone for all date calculations
      switch (period) {
        case "month":
          startDate = getMonthStartPST();
          break;
        case "day":
          startDate = getTodayPST();
          break;
        default:
          startDate = getWeekStartPST();
      }

      const { data: production } = await supabase
        .from("daily_production")
        .select("agent_id, presentations, deals_closed, closing_rate")
        .gte("production_date", startDate);

      if (!production) {
        setEntries([]);
        setLoading(false);
        return;
      }

      // Aggregate by agent
      const agentTotals: Record<string, { presentations: number; deals: number }> = {};

      production.forEach((p) => {
        if (!agentTotals[p.agent_id]) {
          agentTotals[p.agent_id] = { presentations: 0, deals: 0 };
        }
        agentTotals[p.agent_id].presentations += Number(p.presentations || 0);
        agentTotals[p.agent_id].deals += Number(p.deals_closed || 0);
      });

      // Filter agents with minimum 3 presentations
      const qualifiedAgents = Object.entries(agentTotals)
        .filter(([_, totals]) => totals.presentations >= 3);

      if (qualifiedAgents.length === 0) {
        setEntries([]);
        setLoading(false);
        return;
      }

      // Get profiles
      const agentIds = qualifiedAgents.map(([id]) => id);
      const { data: agents } = await supabase
        .from("agents")
        .select("id, user_id")
        .in("id", agentIds);

      const userIds = agents?.map((a) => a.user_id).filter(Boolean) || [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      // Build entries
      const rateEntries: RateEntry[] = qualifiedAgents.map(([agentId, totals]) => {
        const agent = agents?.find((a) => a.id === agentId);
        const profile = profiles?.find((p) => p.user_id === agent?.user_id);
        const closingRate = totals.presentations > 0 
          ? (totals.deals / totals.presentations) * 100 
          : 0;

        return {
          rank: 0,
          agentId,
          name: profile?.full_name || "Unknown Agent",
          closingRate,
          presentations: totals.presentations,
          deals: totals.deals,
          isCurrentUser: agentId === currentAgentId,
        };
      });

      // Sort by closing rate
      rateEntries.sort((a, b) => b.closingRate - a.closingRate);
      rateEntries.forEach((entry, index) => {
        entry.rank = index + 1;
      });

      // Check if current user moved into top 3
      const currentUserEntry = rateEntries.find((e) => e.isCurrentUser);
      if (currentUserEntry && checkForCelebration(currentUserEntry.rank)) {
        setShowConfetti(true);
      }

      setEntries(rateEntries.slice(0, 10));
    } catch (error) {
      console.error("Error fetching closing rate leaderboard:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRealtimeUpdate = useCallback(() => {
    setLastUpdated(new Date());
    fetchLeaderboard(false);
  }, []);

  useEffect(() => {
    // Only reset tracking on initial mount
    if (isInitialMount.current) {
      resetTracking();
      isInitialMount.current = false;
    }
    fetchLeaderboard(true);
  }, [period, currentAgentId]);

  // Use shared realtime hook instead of individual channel
  useProductionRealtime(handleRealtimeUpdate, 1500);

  return (
    <>
      <ConfettiCelebration 
        trigger={showConfetti} 
        onComplete={() => setShowConfetti(false)} 
      />
      <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Percent className="h-4 w-4 text-emerald-500" />
          <h4 className="font-semibold text-sm">Highest Closing Rates</h4>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-emerald-500">
          <Radio className="h-2.5 w-2.5 animate-pulse" />
          <span>LIVE</span>
        </div>
      </div>

      <div className="space-y-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse h-10 bg-muted/30 rounded" />
          ))
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            Min. 3 presentations required
          </p>
        ) : (
          entries.map((entry, index) => {
            const rateColors = getClosingRateColor(entry.closingRate);
            return (
              <div
                key={entry.agentId}
                className={cn(
                  "flex items-center justify-between p-2 rounded-lg text-sm transition-colors duration-100",
                  entry.isCurrentUser
                    ? "bg-primary/10 border border-primary/30"
                    : "hover:bg-muted/30"
                )}
              >
                <div className="flex items-center gap-2">
                  {rankIcons[entry.rank] || (
                    <span className="w-4 text-center text-xs text-muted-foreground">{entry.rank}</span>
                  )}
                  {(() => {
                    const { change, previousRank } = getRankChange(entry.agentId, entry.rank);
                    return <RankChangeIndicator change={change} previousRank={previousRank} compact />;
                  })()}
                  <span className={cn(
                    "font-medium truncate max-w-[80px]",
                    entry.isCurrentUser && "text-primary"
                  )}>
                    {entry.name.split(" ")[0]}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {entry.deals}/{entry.presentations}
                  </span>
                  <span className={cn("font-bold", rateColors.textClass)}>
                    {entry.closingRate.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
      </GlassCard>
    </>
  );
}
