import { supabase } from "@/integrations/supabase/client";

const inFlight = new Map<string, Promise<string | null>>();

async function resolveAgentRecord(userId: string): Promise<string | null> {
  const { data: existing, error: existingError } = await supabase
    .from("agents")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing?.id) return existing.id;

  // The secured function only provisions a verified login whose normalized
  // email resolves to one licensed application. It is idempotent and refuses
  // ambiguous matches, so opening the dashboard can repair a missing link
  // without giving the browser permission to create arbitrary agent rows.
  const { data, error } = await supabase.functions.invoke("self-enroll-course", { body: {} });
  if (error || !data?.agentId) return null;
  return data.agentId as string;
}

export function ensureCurrentAgentRecord(userId: string): Promise<string | null> {
  const pending = inFlight.get(userId);
  if (pending) return pending;

  const request = resolveAgentRecord(userId).finally(() => inFlight.delete(userId));
  inFlight.set(userId, request);
  return request;
}
