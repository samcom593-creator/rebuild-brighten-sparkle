import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NextStepRow = {
  person_type: "applicant" | "agent";
  application_id: string | null;
  agent_id: string | null;
  first_name: string | null;
  last_name: string | null;
  stage_key: string;
  stage_display_name: string;
  next_action_label: string;
  next_action_url: string | null;
  stage_entered_at: string;
  sla_due_at: string | null;
  is_stalled: boolean;
  days_in_stage: number;
  icon_name: string;
  color_hex: string;
  dashboard_section: string;
  order_index: number;
  total_stages: number;
  percent_complete: number;
  upcoming_stages: { key: string; name: string; order: number }[] | null;
  completed_stages: { key: string; name: string; order: number }[] | null;
  candidate_message_template: string | null;
};

interface UseNextStepArgs {
  application_id?: string | null;
  agent_id?: string | null;
}

export function useNextStep({ application_id, agent_id }: UseNextStepArgs) {
  return useQuery({
    queryKey: ["next-step", application_id ?? agent_id],
    enabled: !!(application_id || agent_id),
    queryFn: async (): Promise<NextStepRow | null> => {
      let q = supabase.from("v_next_step_candidate").select("*");
      if (application_id) q = q.eq("application_id", application_id);
      if (agent_id) q = q.eq("agent_id", agent_id);
      const { data, error } = await q.limit(1).maybeSingle();
      if (error) throw error;
      return (data as NextStepRow) ?? null;
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
}
