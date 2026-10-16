import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { agentIdentityQueryKey, resolveAgentIdentity, type AgentIdentity } from "@/lib/agentIdentity";
import { errorMessage } from "@/lib/queryState";

export interface UseAgentIdentityResult {
  /** Undefined only while loading. Otherwise one of resolved | none | ambiguous | error. */
  identity: AgentIdentity | undefined;
  /** The resolved agents.id, or null for every other state. */
  agentId: string | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  userId: string | null;
}

/**
 * The agents row for the signed-in login (F17). Wraps resolveAgentIdentity in
 * a query keyed by user id with a 60s staleTime, so every page that asks gets
 * the same answer from the same cache entry. A failed read is reported as
 * identity.status === "error" and agentId null; it is never reported as "none".
 */
export function useAgentIdentity(): UseAgentIdentityResult {
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  const q = useQuery({
    queryKey: agentIdentityQueryKey(userId),
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async () => {
      const result = await resolveAgentIdentity(supabase, userId);
      // Let TanStack own retry and isError for a failed read; the status is rebuilt below.
      if (result.status === "error") throw new Error(result.message);
      return result;
    },
  });

  let identity: AgentIdentity | undefined;
  let isLoading = false;
  if (!userId) {
    if (authLoading) isLoading = true;
    else identity = { status: "error", message: "Not signed in." };
  } else if (q.isError) {
    identity = { status: "error", message: errorMessage(q.error) };
  } else if (q.data) {
    identity = q.data;
  } else {
    isLoading = true;
  }

  return {
    identity,
    agentId: identity?.status === "resolved" ? identity.agentId : null,
    isLoading,
    isError: identity?.status === "error",
    refetch: () => {
      void q.refetch();
    },
    userId,
  };
}
