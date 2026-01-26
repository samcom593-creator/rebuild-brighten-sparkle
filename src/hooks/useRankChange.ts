import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subDays, format } from "date-fns";

interface RankChangeResult {
  agentId: string;
  previousRank: number | null;
  change: number | null; // positive = moved up, negative = moved down, null = new
}

type LeaderboardType = "alp" | "closing-rate" | "referrals";

export function useRankChange(leaderboardType: LeaderboardType) {
  const [previousRanks, setPreviousRanks] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchYesterdayRanks();
  }, [leaderboardType]);

  const fetchYesterdayRanks = async () => {
    try {
      const yesterday = subDays(new Date(), 1);
      const yesterdayStr = format(yesterday, "yyyy-MM-dd");

      // Fetch yesterday's production data
      const { data: production, error } = await supabase
        .from("daily_production")
        .select("agent_id, aop, deals_closed, presentations, referral_presentations, referrals_caught")
        .eq("production_date", yesterdayStr);

      if (error || !production || production.length === 0) {
        setPreviousRanks(new Map());
        setLoading(false);
        return;
      }

      // Calculate rankings based on leaderboard type
      let ranked: { agentId: string; value: number }[] = [];

      if (leaderboardType === "alp") {
        ranked = production.map((p) => ({
          agentId: p.agent_id,
          value: Number(p.aop) || 0,
        }));
        ranked.sort((a, b) => b.value - a.value);
      } else if (leaderboardType === "closing-rate") {
        // Only include agents with 3+ presentations
        ranked = production
          .filter((p) => Number(p.presentations) >= 3)
          .map((p) => {
            const pres = Number(p.presentations) || 1;
            const deals = Number(p.deals_closed) || 0;
            return {
              agentId: p.agent_id,
              value: (deals / pres) * 100,
            };
          });
        ranked.sort((a, b) => b.value - a.value);
      } else if (leaderboardType === "referrals") {
        ranked = production
          .filter((p) => Number(p.referrals_caught) > 0 || Number(p.referral_presentations) > 0)
          .map((p) => ({
            agentId: p.agent_id,
            value: Number(p.referral_presentations) || 0,
          }));
        ranked.sort((a, b) => b.value - a.value);
      }

      // Build rank map
      const rankMap = new Map<string, number>();
      ranked.forEach((item, index) => {
        rankMap.set(item.agentId, index + 1);
      });

      setPreviousRanks(rankMap);
    } catch (error) {
      console.error("Error fetching yesterday ranks:", error);
    } finally {
      setLoading(false);
    }
  };

  const getRankChange = useCallback(
    (agentId: string, currentRank: number): RankChangeResult => {
      const previousRank = previousRanks.get(agentId);
      
      if (previousRank === undefined) {
        return { agentId, previousRank: null, change: null };
      }

      return {
        agentId,
        previousRank,
        change: previousRank - currentRank, // positive = moved up
      };
    },
    [previousRanks]
  );

  return { getRankChange, loading, hasPreviousData: previousRanks.size > 0 };
}
