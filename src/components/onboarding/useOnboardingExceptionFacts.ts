import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { WP5_RELATION } from "@/lib/wp5Relations";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import { mergeDialerState, type OnboardingFacts } from "@/lib/onboardingExceptions";

export const ONBOARDING_FACTS_KEY = ["onboarding-exception-facts"] as const;

/**
 * public.onboarding_exception_facts() — one row per live hire in the caller's
 * scope (admin / va_manager / va see all; managers see their downline). The RPC
 * raises 42501 for anyone else, which surfaces as an error, never as zero rows.
 * One query feeds the NHLB panel, the full exception queue and Recruit Stages.
 */
export function useOnboardingExceptionFacts(options: { enabled?: boolean; realtime?: boolean } = {}) {
  const { enabled = true, realtime = true } = options;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ONBOARDING_FACTS_KEY,
    enabled,
    staleTime: 30_000,
    // Realtime covers the hot tables; the slow poll catches the rest (login
    // receipts, outreach) without a one-minute loop on a page left open all day.
    refetchInterval: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("onboarding_exception_facts" as never);
      if (error) throw error;
      const rows = (data ?? []) as unknown as OnboardingFacts[];
      // WP5: the derived dialer flag (open seat or a dial in 14 days). Gated to admin + manager server-side; for anyone
      // else, or on a failed read, the rows keep agents.has_dialer_login as before.
      const ids = rows.map((r) => r.agent_id).filter(Boolean);
      // ANCHOR (2026-11-12): dialing_any_source counts My Leads dials; dialer_status drives the dialer-off wording.
      const states: Array<{
        agent_id: string;
        dialer_active_derived: boolean | null;
        dialing_any_source: boolean | null;
        dialer_status: string | null;
      }> = [];
      // The dialer enrichment is optional: a thrown or returned error keeps the base facts
      // (agents.has_dialer_login) rather than blanking every surface that reads this hook.
      try {
        for (let i = 0; i < ids.length; i += 100) {
          const part = await supabase
            .from(WP5_RELATION.dialerState as never)
            .select("agent_id, dialer_active_derived, dialing_any_source, dialer_status")
            .in("agent_id", ids.slice(i, i + 100));
          if (part.error) return rows;
          states.push(...((part.data ?? []) as unknown as typeof states));
        }
      } catch (e) {
        console.warn("[onboarding-facts] dialer state unavailable; using agents.has_dialer_login", e);
        return rows;
      }
      return mergeDialerState(rows, states);
    },
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ONBOARDING_FACTS_KEY });
  }, [queryClient]);

  useRealtimeTable({ table: "agents", channelSuffix: "onboarding-exceptions", enabled: enabled && realtime, coalesceMs: 2_000 }, refresh);
  useRealtimeTable({ table: "onboarding_progress", channelSuffix: "onboarding-exceptions", enabled: enabled && realtime, coalesceMs: 2_000 }, refresh);
  useRealtimeTable({ table: "contracting_intakes", channelSuffix: "onboarding-exceptions", enabled: enabled && realtime, coalesceMs: 2_000 }, refresh);

  return { ...query, refresh };
}
