import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";
import type { OnboardingFacts } from "@/lib/onboardingExceptions";

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
      return (data ?? []) as unknown as OnboardingFacts[];
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
