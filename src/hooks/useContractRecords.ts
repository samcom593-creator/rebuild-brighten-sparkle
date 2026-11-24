/**
 * Writing-number and contract-number records (apex_carrier_contracts), read through the same RPCs the retired
 * contracts board used. Only the Writing numbers tab reads them now; nothing here writes.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type ContractScope = "mine" | "agency" | "imo";
export interface ContractRow {
  id: string;
  carrier_name: string | null;
  agent_name: string | null;
  agent_id: string | null;
  status: string | null;
  commission_level: string | null;
  writing_number: string | null;
  contract_number: string | null;
  requested_at: string | null;
  activated_date: string | null;
}
export interface ContractSummary {
  total: number;
  active: number;
  requested: number;
  issues: number;
  by_status: Record<string, number>;
}
const EMPTY_SUMMARY: ContractSummary = { total: 0, active: 0, requested: 0, issues: 0, by_status: {} };
export const CONTRACT_RECORD_PAGE_SIZE = 200;

export function useContractSummary(scope: ContractScope, search: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["apex-contracts-summary", user?.id, scope, search],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<ContractSummary> => {
      const { data, error } = await supabase.rpc("apex_contracts_summary" as never, {
        p_scope: scope,
        p_search: search || null,
      } as never);
      if (error) throw error;
      return { ...EMPTY_SUMMARY, ...((data ?? {}) as Partial<ContractSummary>) };
    },
  });
}
export function useContractRows(scope: ContractScope, status: string, search: string, page: number) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["apex-contracts-list", user?.id, scope, status, search, page],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<ContractRow[]> => {
      const { data, error } = await supabase.rpc("apex_contracts_list" as never, {
        p_scope: scope,
        p_status: status,
        p_search: search || null,
        p_limit: CONTRACT_RECORD_PAGE_SIZE,
        p_offset: page * CONTRACT_RECORD_PAGE_SIZE,
      } as never);
      if (error) throw error;
      return (data ?? []) as ContractRow[];
    },
  });
}
