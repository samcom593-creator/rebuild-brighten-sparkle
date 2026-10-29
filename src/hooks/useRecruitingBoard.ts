import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { BUSINESS_TIMEZONE } from "@/lib/dateUtils";
import { resolveAgentNames } from "@/shared/api/agentDisplayNames";
import {
  APPLICATION_READ_CAP,
  boardWindowInstants,
  groupRecruiting,
  rollUpCanonical,
  type BoardWindow,
  type RecruitingApp,
  type RecruitingKind,
  type RecruitingTotal,
} from "@/lib/leaderboardBoard";

export interface RecruitingBoardRow extends RecruitingTotal {
  rank: number;
  name: string;
  avatarUrl: string | null;
}

export interface RecruitingBoard {
  rows: RecruitingBoardRow[];
  /** True when the read hit PostgREST's row cap, so some applications may be missing. */
  capped: boolean;
}

/**
 * The Recruiting and Referrals boards (leaders only), read the way the leaderboard read them
 * before OVERHAUL-leaderboards: applications created in the window, scoped by the reader's own
 * row-level access. A failed read throws, so the page says it could not load instead of showing
 * an empty board.
 */
export function useRecruitingBoard(kind: RecruitingKind, window: BoardWindow, enabled: boolean) {
  const todayKey = useBusinessToday(BUSINESS_TIMEZONE);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- todayKey is the trigger: the window is "now", read again on a new day
  const range = useMemo(() => boardWindowInstants(window), [window, todayKey]);
  return useQuery({
    queryKey: ["leaderboard", "recruiting", kind, range.startIso, range.endIso],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<RecruitingBoard> => {
      let request = supabase
        .from("applications")
        .select("referral_recruiter_id, referral_manager_id, recruiter_id, assigned_agent_id, status, license_status, contracted_at, first_deal_at")
        .gte("created_at", range.startIso)
        .lt("created_at", range.endIso)
        .is("terminated_at", null);
      if (kind === "referrals") request = request.not("referral_manager_id", "is", null);
      const { data: apps, error } = await request;
      if (error) throw error;
      const list = (apps ?? []) as RecruitingApp[];
      const capped = list.length >= APPLICATION_READ_CAP;
      const grouped = groupRecruiting(list, kind);
      if (grouped.length === 0) return { rows: [], capped };

      const { data: canon, error: canonError } = await supabase
        .from("v_agent_canonical_map")
        .select("agent_id, canonical_agent_id")
        .in("agent_id", grouped.map((g) => g.ownerId));
      if (canonError) throw canonError;
      const rolled = rollUpCanonical(grouped, (canon ?? []) as Array<{ agent_id: string | null; canonical_agent_id: string | null }>);

      const { data: agents, error: agentsError } = await supabase
        .from("agents")
        .select("id, user_id, display_name")
        .in("id", rolled.map((r) => r.ownerId));
      if (agentsError) throw agentsError;
      const names = await resolveAgentNames((agents ?? []) as Array<{ id: string; user_id: string | null; display_name: string | null }>);

      return {
        capped,
        rows: rolled.map((row, index) => {
          const resolved = names.get(row.ownerId);
          return { ...row, rank: index + 1, name: resolved?.name ?? "—", avatarUrl: resolved?.avatarUrl ?? null };
        }),
      };
    },
  });
}
