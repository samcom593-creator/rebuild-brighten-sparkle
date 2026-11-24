import { useQuery } from "@tanstack/react-query";
import { useBusinessToday } from "@/hooks/useBusinessToday";
import { useAuth } from "@/hooks/useAuth";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import { looseSupabase } from "@/lib/looseSupabase";
import { producerWorkspaceSchema } from "@/lib/producerWorkspace";

export function useProducerWorkspace(agentId?: string | null, enabled = true) {
  const today = useBusinessToday();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["producer-workspace", agentId, user?.id, today], enabled: Boolean(agentId && user?.id) && enabled,
    staleTime: 120_000, retry: 1,
    queryFn: async () => {
      const { data, error } = await looseSupabase.rpc("producer_month_workspace", { p_agent_id: agentId });
      if (error) throw error;
      const workspace = producerWorkspaceSchema.parse(data);
      if (workspace.agent_id !== agentId) throw new Error("Personal production could not be verified for this producer.");
      return workspace;
    },
  });
  useProductionRealtime(() => { if (agentId && user?.id && enabled) void query.refetch({ cancelRefetch: false }); }, 800);
  return query;
}
