// Record an interview outcome on hh_applicants — the write side of the native
// Interviews queue. hh_applicants has RLS on with no user policies, so this
// APEX-auth-gated service-role writer is the only safe path (mirrors the
// interviews-pipeline read fn). supabase-js 2.90.1 (transitive-dep boot-death).
//
// Body: { id: string, stage: string, unqualified_reason?: string }
// Valid stages (hh_stage enum): appointment_set, confirmed, rescheduled,
//   interview_complete, hired, not_hired, unqualified, no_show, canceled.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...corsHeaders } });

const ALLOWED_ROLES = ["admin", "manager", "va_manager", "va"];
// stage -> the interview_result it implies (hh_result enum), null = leave as-is.
const STAGE_RESULT: Record<string, string | null> = {
  appointment_set: "pending", confirmed: "pending", rescheduled: "pending",
  no_show: "follow_up", interview_complete: "qualified",
  hired: "hired", not_hired: "not_hired", unqualified: "unqualified", canceled: null,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const token = authHeader.slice(7);
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user?.id) return json({ error: "invalid token" }, 401);

    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
    const roles = new Set((roleRows ?? []).map((r) => r.role as string));
    if (!ALLOWED_ROLES.some((r) => roles.has(r))) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? "").trim();
    const stage = String(body?.stage ?? "").trim();
    const reason = body?.unqualified_reason ? String(body.unqualified_reason).slice(0, 500) : null;
    if (!id) return json({ error: "id required" }, 400);
    if (!(stage in STAGE_RESULT)) return json({ error: `invalid stage: ${stage}` }, 400);

    const patch: Record<string, unknown> = { stage };
    const result = STAGE_RESULT[stage];
    if (result) patch.interview_result = result;
    if (stage === "unqualified") patch.unqualified_reason = reason;
    if (stage === "rescheduled") patch.reschedule_count = undefined; // trigger/db owns the counter; leave it

    const { data, error } = await admin
      .from("hh_applicants")
      .update(patch)
      .eq("id", id)
      .select("id, name, stage, interview_result")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "applicant not found" }, 404);

    return json({ ok: true, applicant: data });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "error" }, 500);
  }
});
