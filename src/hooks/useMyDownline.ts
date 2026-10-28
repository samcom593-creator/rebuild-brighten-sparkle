import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Returns the current user's downline agent IDs (themselves + all descendants).
 * Empty array if no agent record.
 */
export function useMyDownline() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["my-downline", user?.id],
    queryFn: async (): Promise<string[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase.rpc("my_downline_agent_ids" as any);
      // Preserve React Query's error state; a failed lookup is not an empty team.
      if (error) throw error;
      return (data ?? []).map((r: any) => r.agent_id);
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000, // hierarchy doesn't change often
  });
}
