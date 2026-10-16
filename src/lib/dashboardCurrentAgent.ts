/**
 * The agents row the role-aware Home at /dashboard scopes to.
 *
 * Before 2026-10-15, Dashboard.tsx called ensureCurrentAgentRecord(userId),
 * discarded the id it returned, and re-read agents by user_id ordered by
 * created_at DESC LIMIT 1. agents.user_id has no unique index and a
 * merged-away row keeps its user_id, so that read could return the row a
 * merge retired (11 logins held only merged-away rows on 2026-10-14), and a
 * failed read was swallowed as "no agent". Now the id comes from
 * ensureCurrentAgentRecord, which resolves through the shared rule in
 * @/lib/agentIdentity, and the row is read by that primary key. A failed or
 * empty read throws, so the query reports an error instead of a missing agent.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface DashboardCurrentAgent {
  id: string;
  display_name: string | null;
}

export interface DashboardCurrentAgentDeps {
  /** ensureCurrentAgentRecord: the resolved agent id, or null when the login is ambiguous or has no record. */
  ensure: (userId: string) => Promise<string | null>;
  client: Pick<SupabaseClient<Database>, "from">;
}

export async function loadDashboardCurrentAgent(
  userId: string | null | undefined,
  deps: DashboardCurrentAgentDeps,
): Promise<DashboardCurrentAgent | null> {
  if (!userId) return null;
  const agentId = await deps.ensure(userId);
  // Two live rows for one login, or no record that could be provisioned: the
  // role homes show that state themselves, so there is no row to scope to.
  if (!agentId) return null;
  const { data, error } = await deps.client.from("agents").select("id, display_name").eq("id", agentId).limit(1);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("The agent record read returned no result set.");
  const row = data[0];
  if (!row) throw new Error("This login's agent record could not be read.");
  return { id: row.id, display_name: row.display_name ?? null };
}
