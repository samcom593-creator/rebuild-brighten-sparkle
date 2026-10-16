import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { AgentIdentity } from "@/lib/agentIdentity";
import { downlineSourceFor, parseDownlineIds, type DownlineSource } from "@/lib/resolvedDownline";

export interface ResolvedDownline {
  /** Agent ids in the team (the root and its active descendants). Undefined until a read succeeds. */
  ids: string[] | undefined;
  /** A read is expected and has not answered yet. False when there is nothing to read. */
  isWaiting: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  /** Which rule supplied the root; see downlineSourceFor. */
  source: DownlineSource["kind"];
}

/**
 * The signed-in manager's team for the identity useAgentIdentity resolved.
 * Pass `enabled` only for a viewer whose scope is a team (a manager who is not
 * an admin). A failed read stays an error with ids undefined; it is never
 * reported as an empty team.
 */
export function useResolvedDownline(identity: AgentIdentity | undefined, enabled: boolean): ResolvedDownline {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const source = downlineSourceFor(identity);
  const active = enabled && userId !== null && source.kind !== "none";

  const q = useQuery({
    queryKey: ["resolved-downline", userId, source.kind === "root" ? source.agentId : source.kind],
    enabled: active,
    staleTime: 5 * 60_000, // the hierarchy changes rarely
    queryFn: async () => {
      if (source.kind === "root") {
        const { data, error } = await supabase.rpc("get_downline_agent_ids", { p_root_agent_id: source.agentId });
        if (error) throw error;
        return parseDownlineIds(data);
      }
      const { data, error } = await supabase.rpc("my_downline_agent_ids");
      if (error) throw error;
      return parseDownlineIds(data);
    },
  });

  return {
    ids: active ? q.data : undefined,
    isWaiting: active && q.data === undefined && !q.isError,
    isError: active && q.isError,
    error: active ? q.error : null,
    refetch: () => {
      void q.refetch();
    },
    source: source.kind,
  };
}
