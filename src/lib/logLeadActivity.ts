import { supabase } from "@/integrations/supabase/client";

interface LogActivityParams {
  leadId: string;
  type: string;
  title: string;
  details?: Record<string, unknown>;
}

/**
 * Fire-and-forget activity logger for lead interactions.
 * Never blocks UI — logs warning on failure in dev.
 */
export async function logLeadActivity({ leadId, type, title, details }: LogActivityParams) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn("[logLeadActivity] No authenticated user, skipping log");
      return;
    }

    // Get actor name and role
    let actorName: string | null = null;
    let actorRole: string | null = null;

    const [profileRes, roleRes] = await Promise.all([
      supabase.from("profiles").select("full_name").eq("user_id", user.id).single(),
      supabase.from("user_roles").select("role").eq("user_id", user.id).limit(1).single(),
    ]);

    actorName = profileRes.data?.full_name || user.email || null;
    actorRole = roleRes.data?.role || null;

    await supabase.from("lead_activity").insert({
      lead_id: leadId,
      actor_user_id: user.id,
      actor_name: actorName,
      actor_role: actorRole,
      activity_type: type,
      title,
      details: details || null,
    } as any);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[logLeadActivity] Failed to log activity:", err);
    }
  }
}
