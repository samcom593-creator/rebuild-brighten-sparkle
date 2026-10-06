import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * The approved scripts packet unlocks for a hired, licensed agent once every REQUIRED training
 * module is passed — the same rule fn_enqueue_scripts_packet uses to send the packet email,
 * read from v_training_required_completion. Staff (admin, manager, VA) always have access.
 * "unknown" is reported as such; it never unlocks and never claims the agent is incomplete.
 */
export function useScriptsUnlocked(): { state: "loading" | "staff" | "unlocked" | "locked" | "unknown"; passed?: number; total?: number } {
  const { user, isAdmin, isManager, isVa, isVaManager } = useAuth();
  const staff = Boolean(isAdmin || isManager || isVa || isVaManager);
  const q = useQuery({
    enabled: Boolean(user?.id) && !staff,
    queryKey: ["scripts-unlocked", user?.id],
    staleTime: 60_000,
    queryFn: async () => {
      const agents = await supabase.from("agents").select("id").eq("user_id", user!.id).is("canonical_agent_id", null).limit(1);
      if (agents.error) throw agents.error;
      const agentId = agents.data?.[0]?.id;
      if (!agentId) return null;
      const c = await supabase.from("v_training_required_completion" as never).select("required_total, required_passed, required_complete").eq("agent_id", agentId).limit(1);
      if (c.error) throw c.error;
      return ((c.data ?? []) as unknown as Array<{ required_total: number; required_passed: number; required_complete: boolean }>)[0] ?? null;
    },
  });
  if (staff) return { state: "staff" };
  if (q.isLoading) return { state: "loading" };
  if (q.isError || !q.data) return { state: q.isError ? "unknown" : "locked" };
  return { state: q.data.required_complete ? "unlocked" : "locked", passed: q.data.required_passed, total: q.data.required_total };
}
