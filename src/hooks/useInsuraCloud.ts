import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { safeInvoke } from "@/shared/api/safeInvoke";

/**
 * Pulls the most recent InsuraCloud snapshot, policies, payouts, and downline
 * for a given agent (or agency-wide aggregate when agentId is null).
 */
export function useInsuraCloud(agentId: string | null | undefined) {
  const snapshot = useQuery({
    queryKey: ["insuracloud", "snapshot", agentId ?? "agency"],
    queryFn: async () => {
      let q = supabase
        .from("insuracloud_snapshots")
        .select("*")
        .order("snapshot_date", { ascending: false })
        .limit(1);
      q = agentId ? q.eq("agent_id", agentId) : q.is("agent_id", null);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  const policies = useQuery({
    queryKey: ["insuracloud", "policies", agentId ?? "agency"],
    queryFn: async () => {
      let q = supabase
        .from("insuracloud_policies")
        .select("*")
        .order("issued_date", { ascending: false })
        .limit(500);
      q = agentId ? q.eq("agent_id", agentId) : q.is("agent_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const payouts = useQuery({
    queryKey: ["insuracloud", "payouts", agentId ?? "agency"],
    queryFn: async () => {
      let q = supabase
        .from("insuracloud_payouts")
        .select("*")
        .gte("payout_date", new Date().toISOString().slice(0, 10))
        .order("payout_date", { ascending: true })
        .limit(60);
      q = agentId ? q.eq("agent_id", agentId) : q.is("agent_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const downline = useQuery({
    queryKey: ["insuracloud", "downline", agentId ?? "agency"],
    queryFn: async () => {
      let q = supabase
        .from("insuracloud_downline")
        .select("*")
        .order("total_commission", { ascending: false })
        .limit(20);
      q = agentId ? q.eq("agent_id", agentId) : q.is("agent_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const sync = async (opts: { agentId?: string; full?: boolean } = {}) => {
    return safeInvoke("insuracloud-sync", {
      agent_id: opts.agentId,
      full: opts.full ?? false,
    });
  };

  return { snapshot, policies, payouts, downline, sync };
}
