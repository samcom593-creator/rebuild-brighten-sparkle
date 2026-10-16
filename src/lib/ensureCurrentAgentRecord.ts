import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { resolveAgentIdentity, type AgentIdentityClient } from "@/lib/agentIdentity";

/**
 * ensureCurrentAgentRecord: the agent id for a login, provisioning one only when
 * no record of any kind exists.
 *
 * Resolution is the shared rule in @/lib/agentIdentity: the live row, else the
 * merge pointer followed to its winner, never a pick between two live rows.
 * Before 2026-10-15 this file took the newest row over ALL rows for the login,
 * merged-away rows included, so a login whose only rows were merged away got the
 * losing row's id (11 such logins measured live that day). A failed read throws
 * so the caller's query goes isError; nothing is provisioned on a failed read,
 * and nothing is provisioned when two live rows share the login.
 */
export type EnsureAgentClient = AgentIdentityClient & {
  functions: Pick<SupabaseClient<Database>["functions"], "invoke">;
};

const inFlight = new Map<string, Promise<string | null>>();

export async function resolveAgentRecordWith(client: EnsureAgentClient, userId: string): Promise<string | null> {
  const identity = await resolveAgentIdentity(client, userId);
  if (identity.status === "error") throw new Error(identity.message);
  if (identity.status === "resolved") return identity.agentId;
  // Two live rows share this login. Picking one here would hide the duplicate and
  // enrolling would create a third; the caller shows the ambiguity instead.
  if (identity.status === "ambiguous") return null;

  // No row of any kind. The secured function only provisions a verified login whose
  // normalized email resolves to one licensed application. It is idempotent and
  // refuses ambiguous matches, so opening the dashboard can repair a missing link
  // without giving the browser permission to create arbitrary agent rows.
  const { data, error } = await client.functions.invoke("self-enroll-course", { body: {} });
  const agentId = (data as { agentId?: unknown } | null)?.agentId;
  if (error || typeof agentId !== "string" || !agentId) return null;
  return agentId;
}

export function ensureCurrentAgentRecord(userId: string, client: EnsureAgentClient = supabase): Promise<string | null> {
  const pending = inFlight.get(userId);
  if (pending) return pending;

  const request = resolveAgentRecordWith(client, userId).finally(() => inFlight.delete(userId));
  inFlight.set(userId, request);
  return request;
}
