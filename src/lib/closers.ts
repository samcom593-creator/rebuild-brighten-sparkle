// Closers to hand leads to (MP-310, 2026-10-29): active logins from closer_candidates() (Sam and Aisha only), best
// sticky close rate first. Shared by the one-tap handoff on Call Training and the Give access picker on Lead Bundles.
import { supabase } from "@/integrations/supabase/client";

export interface CloserOption { user_id: string; agent_name: string; close_pct_all: number | null; sticky_close_score: number | null }

export async function fetchClosers(): Promise<CloserOption[]> {
  const { data, error } = await supabase.rpc("closer_candidates" as never);
  if (error) throw new Error(error.message);
  const list = (Array.isArray(data) ? data : []) as CloserOption[];
  return [...list].sort((a, b) => Number(b.sticky_close_score ?? -1) - Number(a.sticky_close_score ?? -1) || a.agent_name.localeCompare(b.agent_name));
}

export const closerOptionLabel = (c: CloserOption) => `${c.agent_name}${c.close_pct_all != null ? ` · closes ${c.close_pct_all}%` : ""}`;
