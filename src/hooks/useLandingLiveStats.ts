import { useQuery } from "@tanstack/react-query";
import { parseLandingLiveStats } from "@/lib/landingLiveStats";

export function useLandingLiveStats(enabled: boolean) {
  return useQuery({
    queryKey: ["landing_live_stats"],
    queryFn: async () => {
      // Keep the public landing's first paint independent of the database client.
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.rpc("landing_live_stats");
      if (error) throw error;
      return parseLandingLiveStats(data);
    },
    enabled,
    staleTime: 60_000,
    refetchInterval: 300_000,
    retry: 1,
  });
}
