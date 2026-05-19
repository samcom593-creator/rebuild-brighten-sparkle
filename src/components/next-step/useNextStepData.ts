import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface NextStepFunnelRow {
  stage_key: string;
  order_index: number;
  display_name: string;
  in_stage: number;
  stalled: number;
  median_days: number | null;
  avg_days: number | null;
  next_stage_count: number;
  conversion_to_next_pct: number | null;
}

export interface NextStepStuckRow {
  application_id: string;
  agent_id: string | null;
  person_type: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  derived_stage_key: string;
  stage_display_name: string;
  next_action_label: string | null;
  next_action_url: string | null;
  next_action_due_at: string | null;
  stage_entered_at: string;
  days_in_stage: number;
  severity: "critical" | "high" | "medium" | "low" | null;
  is_stalled: boolean;
  sla_hours: number | null;
  color_hex: string | null;
}

export interface NextStepManagerRow {
  manager_user_id: string | null;
  stage_key: string;
  stage_display_name: string;
  order_index: number;
  color_hex: string | null;
  person_count: number;
  stalled_count: number;
  over_week_count: number;
  avg_days_in_stage: number | null;
  max_days_in_stage: number | null;
}

export interface NextStepCandidateRow {
  application_id: string;
  agent_id: string | null;
  derived_stage_key: string;
  stage_display_name: string;
  next_action_label: string | null;
  next_action_url: string | null;
  sla_hours: number | null;
  sla_due_at: string | null;
  is_stalled: boolean;
  days_in_stage: number;
  color_hex: string | null;
  candidate_message_template: string | null;
  failure_label: string | null;
}

/**
 * Top-N stuck candidates from v_next_step_stuck_pool.
 * Pass `ownerUserId` to restrict to a single manager's downline; omit for
 * the global admin pool.
 */
export function useNextStepStuck(limit = 8, ownerUserId?: string | null) {
  return useQuery({
    queryKey: ["next_step_stuck_pool", limit, ownerUserId ?? "all"],
    queryFn: async (): Promise<NextStepStuckRow[]> => {
      let q = supabase
        .from("v_next_step_stuck_pool")
        .select(
          "application_id,agent_id,person_type,first_name,last_name,email,phone,derived_stage_key,stage_display_name,next_action_label,next_action_url,next_action_due_at,stage_entered_at,days_in_stage,severity,is_stalled,sla_hours,color_hex,owner_user_id",
        );
      if (ownerUserId) q = q.eq("owner_user_id", ownerUserId);
      const { data, error } = await q.order("days_in_stage", { ascending: false }).limit(limit);
      if (error) throw error;
      return (data ?? []) as NextStepStuckRow[];
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });
}

/** Funnel chart data — all 18 stages with in_stage + stalled counts + conversion %. */
export function useNextStepFunnel() {
  return useQuery({
    queryKey: ["next_step_funnel_health"],
    queryFn: async (): Promise<NextStepFunnelRow[]> => {
      const { data, error } = await supabase
        .from("v_next_step_funnel_health")
        .select("*")
        .order("order_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as NextStepFunnelRow[];
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** Per-stage aggregate for a specific manager (admin gets every manager merged). */
export function useNextStepManagerBoard(managerUserId?: string | null) {
  return useQuery({
    queryKey: ["next_step_manager_board", managerUserId ?? "all"],
    queryFn: async (): Promise<NextStepManagerRow[]> => {
      let q = supabase.from("v_next_step_manager_board").select("*");
      if (managerUserId) q = q.eq("manager_user_id", managerUserId);
      const { data, error } = await q.order("order_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as NextStepManagerRow[];
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });
}

/**
 * Current candidate row — for the signed-in agent's own "Next Step" card.
 *
 * Routing rules:
 *  - When called with applicationId on a PUBLIC surface (e.g.
 *    /status/<id>), use the SECURITY DEFINER RPC landing_next_step_for(id)
 *    so anon callers can read.
 *  - When called from an authenticated admin surface, prefer direct view
 *    access (v_next_step_candidate is RLS-gated to admin).
 */
export function useMyNextStep(applicationId?: string | null, agentId?: string | null) {
  return useQuery({
    queryKey: ["my_next_step", applicationId ?? agentId ?? "none"],
    enabled: Boolean(applicationId || agentId),
    queryFn: async (): Promise<NextStepCandidateRow | null> => {
      // Try public RPC first when we have an applicationId — works for both
      // anon (public /status page) and authed users (admin sees their own).
      if (applicationId) {
        const { data: rpcData, error: rpcErr } = await supabase
          .rpc("landing_next_step_for", { p_application_id: applicationId });
        if (!rpcErr && rpcData) {
          return rpcData as unknown as NextStepCandidateRow;
        }
      }
      // Fall back to direct view access (admin only).
      let q = supabase
        .from("v_next_step_candidate")
        .select(
          "application_id,agent_id,derived_stage_key,stage_display_name,next_action_label,next_action_url,sla_hours,sla_due_at,is_stalled,days_in_stage,color_hex,candidate_message_template,failure_label",
        );
      if (applicationId) q = q.eq("application_id", applicationId);
      else if (agentId) q = q.eq("agent_id", agentId);
      const { data, error } = await q.maybeSingle();
      if (error) return null;
      return (data as NextStepCandidateRow) ?? null;
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });
}
