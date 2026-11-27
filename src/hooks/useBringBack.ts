import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { partRows } from "@/lib/productionMetrics";
import { ensureCompleteRead } from "@/lib/teamRoster";
import { parseBringBack, type BringBackPerson } from "@/lib/bringBack";

export const BRING_BACK_RPC = "crm_bring_back_candidates";
export const BRING_BACK_KEY = ["crm-bring-back"] as const;

/**
 * Everyone off the roster worth a bring-back call (MP-TEAM-BRING-BACK, 2026-11-27): hidden, inactive and
 * excluded agents with a contract, production or a license, people Sam let go (returned flagged, shown only
 * on request), and Ethos contract holders with no account here. One read, authorised like the roster and the
 * call sheet. A failed or garbled read throws, so the tab says "did not load" rather than "nobody to bring back".
 */
export function useBringBack(enabled: boolean) {
  return useQuery({
    queryKey: BRING_BACK_KEY,
    enabled,
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<BringBackPerson[]> => {
      const result = await supabase.rpc(BRING_BACK_RPC as never);
      const rows = partRows<unknown>(BRING_BACK_RPC, result);
      ensureCompleteRead("The bring-back list", rows);
      return parseBringBack(rows);
    },
  });
}
