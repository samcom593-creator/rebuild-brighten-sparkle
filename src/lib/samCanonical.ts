// samCanonical — single place to ask "who is the canonical Sam right now?"
//
// Backs the `get_canonical_sam_agent()` Postgres function so frontend code
// doesn't have to know which Sam record is currently active. Used by
// fallback routing ("unknown applicant → Sam"), leaderboard exclusion, and
// admin views that need to scope to "Sam's stuff".
//
// Result is cached in-memory for the page session (it can only change when
// Sam logs in elsewhere; one fetch per render tree is plenty).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SAM_AGENT_IDS } from "@/lib/dataLayer";

export interface CanonicalSamAgent {
  agent_id: string;
  user_id: string;
  profile_id: string | null;
  display_name: string | null;
  agent_code: string | null;
  auth_email: string | null;
  last_sign_in_at: string | null;
  legacy_agent_id: string | null;
}

export async function fetchCanonicalSamAgent(): Promise<CanonicalSamAgent | null> {
  const { data, error } = await (supabase.rpc as any)("get_canonical_sam_agent");
  if (error) {
    console.warn("[samCanonical] get_canonical_sam_agent failed; falling back to legacy SAM_AGENT_IDS", error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as CanonicalSamAgent | undefined) ?? null;
}

/**
 * React hook — returns the canonical Sam agent_id and the legacy one.
 * Both should be excluded from leaderboards/live-agent counts.
 */
export function useCanonicalSamAgent() {
  return useQuery({
    queryKey: ["canonical-sam-agent"],
    staleTime: 30 * 60 * 1000, // 30 minutes — Sam's identity doesn't churn
    queryFn: fetchCanonicalSamAgent,
  });
}

/**
 * Returns the array of agent_ids that should be EXCLUDED from public
 * leaderboards / live-agent rosters / new-applicant fallback targets that
 * shouldn't auto-route to Sam.
 *
 * Falls back to the snapshot constants when the resolver is offline, so
 * filters keep working even if the RPC briefly fails.
 */
export function getSamExclusionIds(canonical?: CanonicalSamAgent | null): readonly string[] {
  if (canonical) {
    return [canonical.agent_id, canonical.legacy_agent_id].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
  }
  return SAM_AGENT_IDS;
}
