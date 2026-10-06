/**
 * Reads contracting carrier cases. Kept apart from the workspace component so
 * the agent profile card does not pull the whole workspace into its bundle.
 */
import { supabase } from "@/integrations/supabase/client";
import type { CarrierCaseRow } from "@/lib/contractingCases";

const PAGE = 1000;

export const CARRIER_CASES_QUERY_KEY = ["contracting-carrier-cases"] as const;

/**
 * contracting_carrier_cases() is set-returning, and PostgREST caps a response
 * at 1000 rows: page until a short page so totals are never silently truncated.
 * With an agentId it returns that one agent's carriers (self, upline or staff).
 */
export async function fetchCarrierCases(agentId?: string): Promise<CarrierCaseRow[]> {
  const out: CarrierCaseRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const args = agentId ? { p_agent_id: agentId } : {};
    const { data, error } = await supabase
      .rpc("contracting_carrier_cases" as never, args as never)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as CarrierCaseRow[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}
