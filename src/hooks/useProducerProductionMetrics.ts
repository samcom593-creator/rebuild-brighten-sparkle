import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { looseSupabase } from "@/lib/looseSupabase";

const count = z.number().int().nonnegative();
const amount = z.number().finite().nonnegative();
const schema = z.object({
  viewer_user_id: z.string(), requested_agent_id: z.string(),
  production_summary: z.object({
    as_of: z.string(), mtd_ap: amount, mtd_policies: count,
    lifetime_ap: amount, lifetime_policies: count,
    completed_ap: amount, completed_active_days: count,
    completed_calendar_days: count, days_in_month: z.number().int().min(28).max(31),
    source_updated_at: z.string().nullable(), basis: z.string(),
  }),
});

/** Server aggregates avoid capped row reads and include the canonical producer aliases. */
export function useProducerProductionMetrics(agentId: string) {
  const { user } = useAuth();
  const today = useBusinessToday();
  const query = useQuery({
    queryKey: ["producer-production-metrics", user?.id, agentId, today],
    enabled: Boolean(user?.id && agentId), staleTime: 120_000, retry: 1,
    queryFn: async () => {
      const { data, error } = await looseSupabase.rpc("producer_profile_detail", { p_agent_id: agentId });
      if (error) throw error;
      const parsed = schema.parse(data);
      if (parsed.viewer_user_id !== user!.id || parsed.requested_agent_id !== agentId || parsed.production_summary.as_of !== today) {
        throw new Error("Production metrics did not match this account, producer and business day.");
      }
      return parsed.production_summary;
    },
  });
  useProductionRealtime(() => { if (user?.id && agentId) void query.refetch({ cancelRefetch: false }); }, 800);
  return query;
}
