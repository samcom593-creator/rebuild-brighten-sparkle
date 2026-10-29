import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { BUSINESS_TIMEZONE } from "@/lib/dateUtils";
import {
  boardWindowRange,
  parseCheerResult,
  parseTeamBoard,
  withCheer,
  type BoardWindow,
  type CheerResult,
  type TeamBoard,
} from "@/lib/leaderboardBoard";

/** The query key prefix. "leaderboard" is in OPERATIONAL_TRUTH_QUERY_KEYS, so a posted deal refreshes the board. */
export const TEAM_BOARD_KEY = ["leaderboard", "team-board"] as const;

/**
 * The team board for one window (OVERHAUL-leaderboards). One read, leaderboard_team_board(),
 * carries the rows, the viewer's own numbers and every cheer, so the numbers on the page and
 * the list under them are the same rows. Refetched every minute while the page is open, so
 * cheers from teammates show up without a reload.
 */
export function useTeamBoard(window: BoardWindow) {
  // Production windows are Chicago business days (src/lib/dateUtils.ts). Re-keyed when that day
  // changes, so a page left open overnight moves to the new day.
  const todayKey = useBusinessToday(BUSINESS_TIMEZONE);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- todayKey is the trigger: the range is "now", read again on a new day
  const range = useMemo(() => boardWindowRange(window), [window, todayKey]);
  const query = useQuery({
    queryKey: [...TEAM_BOARD_KEY, range.start, range.end],
    queryFn: async (): Promise<TeamBoard> => {
      const { data, error } = await supabase.rpc("leaderboard_team_board" as never, { p_start: range.start, p_end: range.end } as never);
      if (error) throw error;
      return parseTeamBoard(data);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return { ...query, range, todayKey };
}

export interface CheerInput {
  agentKey: string;
  monthStart: string;
  cheer: boolean;
}

/**
 * Cheer a teammate, or take the cheer back. The server sets or clears the cheer (it never
 * toggles, so a double tap cannot undo itself) and answers with the row's new count, which is
 * written into every cached board of the same month.
 */
export function useSetCheer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ agentKey, monthStart, cheer }: CheerInput): Promise<CheerResult> => {
      const { data, error } = await supabase.rpc("leaderboard_set_cheer" as never, { p_agent_key: agentKey, p_month: monthStart, p_cheer: cheer } as never);
      if (error) throw error;
      return parseCheerResult(data);
    },
    onSuccess: (result) => {
      queryClient.setQueriesData<TeamBoard>({ queryKey: TEAM_BOARD_KEY }, (old) => (old ? withCheer(old, result) : old));
    },
  });
}
