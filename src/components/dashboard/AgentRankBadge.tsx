import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Sparkles, Crown, Medal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { subDays, format } from "date-fns";

interface AgentRankBadgeProps {
  agentId: string;
  showChange?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function AgentRankBadge({ 
  agentId, 
  showChange = true, 
  size = "md",
  className 
}: AgentRankBadgeProps) {
  const [currentRank, setCurrentRank] = useState<number | null>(null);
  const [previousRank, setPreviousRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRanks = useCallback(async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");

      // Fetch today's rankings by ALP
      const { data: todayData } = await supabase
        .from("daily_production")
        .select("agent_id, aop")
        .eq("production_date", today)
        .order("aop", { ascending: false });

      if (todayData && todayData.length > 0) {
        const myIndex = todayData.findIndex(p => p.agent_id === agentId);
        if (myIndex !== -1) {
          setCurrentRank(myIndex + 1);
        } else {
          setCurrentRank(null);
        }
      } else {
        setCurrentRank(null);
      }

      // Fetch yesterday's rankings for comparison
      if (showChange) {
        const { data: yesterdayData } = await supabase
          .from("daily_production")
          .select("agent_id, aop")
          .eq("production_date", yesterday)
          .order("aop", { ascending: false });

        if (yesterdayData && yesterdayData.length > 0) {
          const myYesterdayIndex = yesterdayData.findIndex(p => p.agent_id === agentId);
          if (myYesterdayIndex !== -1) {
            setPreviousRank(myYesterdayIndex + 1);
          } else {
            setPreviousRank(null);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching rank:", error);
    } finally {
      setLoading(false);
    }
  }, [agentId, showChange]);

  useEffect(() => {
    fetchRanks();

    // Subscribe to real-time updates
    const channel = supabase
      .channel("agent-rank-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "daily_production"
        },
        () => {
          fetchRanks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRanks]);

  if (loading || currentRank === null) {
    return null;
  }

  const rankChange = previousRank !== null ? previousRank - currentRank : null;
  const isTop3 = currentRank <= 3;
  const isNew = previousRank === null && showChange;

  const sizeClasses = {
    sm: "h-5 px-1.5 text-[10px] gap-0.5",
    md: "h-6 px-2 text-xs gap-1",
    lg: "h-8 px-3 text-sm gap-1.5"
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-3.5 w-3.5",
    lg: "h-4 w-4"
  };

  const getRankIcon = () => {
    if (currentRank === 1) return <Crown className={cn(iconSizes[size], "text-yellow-300")} />;
    if (currentRank === 2) return <Medal className={cn(iconSizes[size], "text-gray-300")} />;
    if (currentRank === 3) return <Medal className={cn(iconSizes[size], "text-orange-600")} />;
    return null;
  };

  const getRankGradient = () => {
    if (currentRank === 1) return "from-yellow-400 via-amber-400 to-orange-500";
    if (currentRank === 2) return "from-gray-300 via-gray-400 to-gray-500";
    if (currentRank === 3) return "from-orange-600 via-orange-700 to-orange-800";
    return "from-muted to-muted";
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className={cn(
              "inline-flex items-center justify-center rounded-full font-bold shadow-sm",
              sizeClasses[size],
              isTop3 
                ? `bg-gradient-to-r ${getRankGradient()} text-white shadow-md`
                : "bg-muted/80 text-muted-foreground border border-border/50",
              className
            )}
          >
            {getRankIcon()}
            <span>#{currentRank}</span>
            
            {/* Rank change indicator */}
            {showChange && rankChange !== null && rankChange !== 0 && (
              <motion.span
                initial={{ x: -5, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className={cn(
                  "flex items-center",
                  rankChange > 0 ? "text-emerald-400" : "text-rose-400"
                )}
              >
                {rankChange > 0 ? (
                  <TrendingUp className={iconSizes[size]} />
                ) : (
                  <TrendingDown className={iconSizes[size]} />
                )}
              </motion.span>
            )}
            
            {/* New indicator */}
            {isNew && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.3, type: "spring" }}
              >
                <Sparkles className={cn(iconSizes[size], "text-amber-400")} />
              </motion.span>
            )}
          </motion.div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {currentRank === 1 && "🏆 You're #1 on the leaderboard!"}
          {currentRank === 2 && "🥈 2nd place - almost there!"}
          {currentRank === 3 && "🥉 3rd place - keep pushing!"}
          {currentRank > 3 && (
            <>
              You're #{currentRank} today
              {rankChange !== null && rankChange !== 0 && (
                <span className={rankChange > 0 ? " text-emerald-400" : " text-rose-400"}>
                  {rankChange > 0 ? ` (+${rankChange} from yesterday)` : ` (${rankChange} from yesterday)`}
                </span>
              )}
            </>
          )}
          {isNew && " (New on leaderboard!)"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
