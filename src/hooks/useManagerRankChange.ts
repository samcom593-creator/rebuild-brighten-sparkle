import { useState, useEffect, useCallback } from "react";

interface ManagerRankData {
  agentId: string;
  previousRank: number | null;
  change: number | null; // positive = moved up, negative = moved down, null = new
}

const STORAGE_KEY = "manager-leaderboard-previous-ranks";

export function useManagerRankChange() {
  const [previousRanks, setPreviousRanks] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    // Load previous ranks from localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setPreviousRanks(new Map(Object.entries(parsed)));
      }
    } catch (error) {
      console.error("Error loading previous ranks:", error);
    }
  }, []);

  const saveCurrentRanks = useCallback((rankings: { agentId: string; rank: number }[]) => {
    try {
      const rankMap: Record<string, number> = {};
      rankings.forEach(({ agentId, rank }) => {
        rankMap[agentId] = rank;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rankMap));
      setPreviousRanks(new Map(Object.entries(rankMap)));
    } catch (error) {
      console.error("Error saving ranks:", error);
    }
  }, []);

  const getRankChange = useCallback(
    (agentId: string, currentRank: number): ManagerRankData => {
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

  return { getRankChange, saveCurrentRanks, hasPreviousData: previousRanks.size > 0 };
}
