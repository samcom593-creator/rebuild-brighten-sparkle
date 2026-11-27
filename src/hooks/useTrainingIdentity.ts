import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { resolveTrainingIdentity, type TrainingIdentity } from "@/lib/trainingIdentity";

export function useTrainingIdentity() {
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const query = useQuery({
    queryKey: ["training-identity", userId], enabled: !!userId, staleTime: 60_000,
    queryFn: async () => {
      const result = await resolveTrainingIdentity(supabase, userId);
      if (result.status === "error") throw new Error(result.message);
      return result;
    },
  });
  const identity: TrainingIdentity | undefined = !userId ? authLoading ? undefined : { status: "error", message: "Sign in to load training." }
    : query.isError ? { status: "error", message: query.error instanceof Error ? query.error.message : "Training access could not be verified." } : query.data;
  return {
    identity, agentId: identity?.status === "resolved" ? identity.agentId : null,
    isLoading: !identity, isError: identity?.status === "error" || identity?.status === "history_review",
    userId, refetch: () => { void query.refetch(); },
  };
}
