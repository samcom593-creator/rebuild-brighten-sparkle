/**
 * Aflac onboarding gate: types and the single read hook.
 *
 * Every number on the Aflac page and the Home banner comes from ONE server call, aflac_gate_state(), so
 * the two can never disagree. A failed read is returned as an error, never as "zero pending": an empty
 * queue and an unreadable queue must not look the same.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AflacQueueRow = {
  intake_id: string;
  agent_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  npn: string | null;
  phone_e164: string | null;
  license_status: string | null;
  intake_status: string | null;
  review_reason: string | null;
  created_at: string;
  tracked: boolean;
  missing: string[];
};

export type AflacRecentRow = {
  id: string;
  intake_id: string;
  first_name: string;
  last_name: string;
  email: string;
  npn: string;
  phone_e164: string;
  comp_level: string;
  submitted_at: string;
  hire_notified_at: string | null;
  hire_notify_error: string | null;
};

export type AflacGateState = {
  today: string;
  go_live_at: string;
  ready_unsent: number;
  blocked_unsent: number;
  earlier_unsent: number;
  checked_off_today: boolean;
  checkoff: { check_date: string; completed_at: string; submitted_that_day: number; blocked_carried: number } | null;
  queue: AflacQueueRow[];
  recent: AflacRecentRow[];
};

export const AFLAC_GATE_QUERY_KEY = ["aflac_gate_state"] as const;

/** Plain-English label for each reason a hire cannot be sent yet. */
export const AFLAC_MISSING_LABELS: Record<string, string> = {
  first_name: "first name",
  last_name: "last name",
  email: "valid email",
  npn: "NPN (6-10 digits)",
  phone: "phone number",
  not_licensed: "license not confirmed",
  intake_not_accepted: "intake still needs review",
};

export function useAflacGate(enabled = true) {
  return useQuery({
    queryKey: AFLAC_GATE_QUERY_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<AflacGateState> => {
      const { data, error } = await supabase.rpc("aflac_gate_state");
      if (error) throw new Error(error.message);
      return data as unknown as AflacGateState;
    },
  });
}
