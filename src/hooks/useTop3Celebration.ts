import { useRef, useCallback } from "react";
import { useSoundEffects } from "./useSoundEffects";

interface UseTop3CelebrationOptions {
  currentAgentId?: string;
}

/**
 * Hook to track when an agent enters top 3 on leaderboards
 * and trigger celebration effects
 */
export function useTop3Celebration({ currentAgentId }: UseTop3CelebrationOptions) {
  const previousRankRef = useRef<number | null>(null);
  const { playSound } = useSoundEffects();

  const checkForCelebration = useCallback(
    (currentRank: number | null): boolean => {
      // No current agent or not in leaderboard
      if (!currentAgentId || currentRank === null) {
        previousRankRef.current = currentRank;
        return false;
      }

      const previousRank = previousRankRef.current;
      const shouldCelebrate =
        currentRank <= 3 && // Now in top 3
        previousRank !== null && // Had a previous rank
        previousRank > 3; // Previously was NOT in top 3

      // Update the ref for next comparison
      previousRankRef.current = currentRank;

      if (shouldCelebrate) {
        // Play celebration sound
        playSound("celebrate");
        return true;
      }

      return false;
    },
    [currentAgentId, playSound]
  );

  const resetTracking = useCallback(() => {
    previousRankRef.current = null;
  }, []);

  return {
    checkForCelebration,
    resetTracking,
  };
}
