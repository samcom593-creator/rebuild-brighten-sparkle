import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useRolePreview } from "@/hooks/useRolePreview";
import { supabase } from "@/integrations/supabase/client";
import { isSamEmail } from "@/lib/samOnly";

/** The private workspace follows the server's owner + live-session check. */
export function useSamPrivateAccess() {
  const { user, session, isAdmin, isLoading } = useAuth();
  const { isPreviewing } = useRolePreview();
  const userId = user?.id ?? null;
  const eligible = Boolean(userId && isAdmin && !isLoading && !isPreviewing && isSamEmail(user?.email));
  const access = useQuery({
    queryKey: ["sam-private-access", userId, session?.expires_at ?? null],
    enabled: eligible,
    staleTime: 30_000,
    gcTime: 0,
    retry: false,
    refetchOnMount: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_sam");
      if (error) throw error;
      return { userId, allowed: data === true };
    },
  });
  const isChecking = isLoading || (eligible && (access.isPending || access.isFetching));
  return {
    userId,
    isChecking,
    isError: eligible && access.isError,
    allowed: eligible && !isChecking && !access.isError && access.data?.userId === userId && access.data?.allowed === true,
  };
}
