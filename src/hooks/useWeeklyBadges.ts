import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Weekly badges for the signed-in agent.
 *
 * This hook used to fetch EVERY agent's daily_production for the week into the
 * browser, aggregate it client-side, and then use all of it to answer one
 * question: did *this* agent win a badge. Every badge it emitted was about the
 * caller (`topALP.agentId === agentId`), so ~99% of what it downloaded was
 * discarded — after being handed to anyone who opened devtools.
 *
 * That read was only possible because daily_production carried a policy named
 * "Authenticated agents can view all production for leaderboard" whose USING
 * clause was `auth.uid() IS NOT NULL` — i.e. every logged-in user could read
 * every agent's production rows. That policy is now dropped, and the ranking
 * happens in public.my_weekly_badges(), which is SECURITY DEFINER so it can
 * still measure the caller against the whole agency while returning only the
 * caller's own badges.
 *
 * Same badges, same rules, same shape out. Nobody else's numbers cross the wire.
 */
export interface WeeklyBadge {
  id: string;
  name: string;
  description: string;
  icon: "trophy" | "target" | "zap" | "flame" | "crown" | "star";
  color: "amber" | "emerald" | "violet" | "rose" | "primary" | "cyan";
  weekStart: string;
  value: number;
}

interface BadgeRow {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  week_start: string;
  value: number | string | null;
}

export function useWeeklyBadges(agentId: string | null) {
  const [badges, setBadges] = useState<WeeklyBadge[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWeeklyBadges = useCallback(async () => {
    if (!agentId) {
      setBadges([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // The RPC resolves the caller from auth.uid() itself — it deliberately
      // takes no agent id, so one agent cannot ask for another's badges.
      const { data, error } = await supabase.rpc("my_weekly_badges");
      if (error) throw error;

      setBadges(
        ((data ?? []) as BadgeRow[]).map((b) => ({
          id: b.id,
          name: b.name,
          description: b.description,
          icon: b.icon as WeeklyBadge["icon"],
          color: b.color as WeeklyBadge["color"],
          weekStart: b.week_start,
          value: Number(b.value ?? 0),
        })),
      );
    } catch (error) {
      console.error("Error fetching weekly badges:", error);
      setBadges([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchWeeklyBadges();
  }, [fetchWeeklyBadges]);

  return { badges, loading, refetch: fetchWeeklyBadges };
}
