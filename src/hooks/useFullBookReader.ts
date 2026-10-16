import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Whether this login reads the full production book: Sam's admin logins and
 * the people in public.book_readers (Aisha). The database enforces this on
 * every book view and table (PL-SEC-VIEW-LOCKDOWN, 2026-10-15); pages ask the
 * same function so their scope and labels match what the server returns.
 * A failed check fails closed: the page shows the login's own scope.
 */
export function useFullBookReader(): { isFullReader: boolean; isLoading: boolean } {
  const { user, isAdmin } = useAuth();
  const q = useQuery({
    queryKey: ["api-is-full-reader", user?.id ?? null],
    enabled: Boolean(user?.id) && !isAdmin,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("api_is_full_reader" as never);
      if (error) throw error;
      return data === true;
    },
  });
  if (isAdmin) return { isFullReader: true, isLoading: false };
  return { isFullReader: q.data === true, isLoading: Boolean(user?.id) && q.isPending };
}
