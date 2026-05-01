import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Returns true if the current user can access a given admin-only board.
 * Admins always pass. Managers pass only if an admin has granted them
 * access via manager_board_grants for this board_key.
 *
 * Server-side check via has_board_access(user_id, board_key) RPC, so
 * a manager can't bypass by editing client state.
 */
export function useBoardAccess(boardKey: string) {
  const { user, isAdmin } = useAuth();
  return useQuery({
    queryKey: ["board-access", user?.id, boardKey],
    queryFn: async (): Promise<boolean> => {
      if (!user?.id) return false;
      if (isAdmin) return true;
      const { data, error } = await supabase.rpc("has_board_access" as any, {
        _user_id: user.id,
        _board_key: boardKey,
      });
      if (error) {
        console.error("[board-access]", error);
        return false;
      }
      return !!data;
    },
    enabled: !!user?.id && !!boardKey,
    staleTime: 60_000,
  });
}
