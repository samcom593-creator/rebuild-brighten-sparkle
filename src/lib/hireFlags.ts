/**
 * Hire red flags (2026-10-09). The rules and the ranking live in the database (hire_flag_eval and
 * fn_hire_priority_rows) so the page, the phone alert and any future surface agree. This file only fetches
 * and presents.
 *
 * Sam's rules: a licensed hire still without Aflac or Ethos after 3 days is red on that step; after 5 days a
 * missing first contract or AgentLink is red too. The top ten by score are Priority 1.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type HireFlagKey = "aflac" | "ethos" | "first_contract" | "agentlink";

export type HirePriorityRow = {
  agent_id: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  manager_id: string | null;
  manager_name: string | null;
  hired_at: string;
  days: number;
  aflac: boolean;
  ethos: boolean;
  first_contract: boolean;
  agentlink: boolean;
  red_count: number;
  reasons: string[];
  last_call_at: string | null;
  called_recently: boolean;
  score: number;
  priority_rank: number;
  /** 1 = talk now (top ten), 2 = behind, 3 = fine (never returned: only red rows are listed). */
  priority: 1 | 2 | 3;
};

export const FLAG_META: { key: HireFlagKey; label: string; after: number }[] = [
  { key: "aflac", label: "Aflac", after: 3 },
  { key: "ethos", label: "Ethos", after: 3 },
  { key: "first_contract", label: "First contract", after: 5 },
  { key: "agentlink", label: "AgentLink", after: 5 },
];

export const HIRE_PRIORITY_QUERY_KEY = ["hire_priority_list"] as const;

/**
 * Reads the ranked list. The call is allowed for admins, VA managers and managers. For anyone else the
 * server refuses, and `isError` is how callers learn to render nothing instead of a scary banner.
 */
export function useHirePriority(enabled = true) {
  return useQuery({
    queryKey: HIRE_PRIORITY_QUERY_KEY,
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<HirePriorityRow[]> => {
      const { data, error } = await supabase.rpc("hire_priority_list");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as HirePriorityRow[];
    },
  });
}

/** Split into the people to call first, everyone else who is behind, and a quick lookup by agent. */
export function groupHirePriority(rows: HirePriorityRow[]) {
  const first = rows.filter((r) => r.priority === 1).sort((a, b) => a.priority_rank - b.priority_rank);
  const rest = rows.filter((r) => r.priority !== 1).sort((a, b) => a.priority_rank - b.priority_rank);
  const byAgent = new Map(rows.map((r) => [r.agent_id, r] as const));
  return { first, rest, byAgent };
}

export function dayLabel(days: number): string {
  return days <= 0 ? "Hired today" : `Day ${days}`;
}
