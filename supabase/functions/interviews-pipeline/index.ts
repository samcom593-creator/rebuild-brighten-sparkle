// Native APEX Interviews pipeline.
//
// 2026-08-19 (Sam, full-flow brief): /dashboard/interviews used to render
// HeadhunterGateway, which POSTed the caller's access token to
// headhunter-sand.vercel.app and dropped the user into a separately-branded
// app on another origin. hh_applicants lives in THIS Supabase project but has
// RLS on with no user-facing policies, so an APEX session reading it via
// PostgREST gets []. This function is the APEX-owned data contract for the
// interview pipeline: it verifies the caller's APEX JWT, checks their APEX
// role, and only then reads the pipeline with the service role. No new RLS is
// granted on hh_applicants, and no user ever leaves the APEX origin.
//
// supabase-js pinned to 2.90.1 on purpose — 2.50.0/2.45.0 pins resolve their
// transitive deps at request time and boot-crash the function (the
// apex_edge_fn_dead_pin lesson). Read path only; stage transitions/outcomes
// are a following slice through their own audited writer.

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

// The roles the Interviews workspace is for. Mirrors the ProtectedRoute on
// /dashboard/interviews (requireAdmin, allowManagers, allowRoles va_manager/va).
const ALLOWED = ["admin", "manager", "va_manager", "va"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const token = authHeader.slice(7);

    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user?.id) return json({ error: "invalid token" }, 401);
    const userId = u.user.id;

    const { data: roleRows, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) throw roleErr;
    const roles = new Set((roleRows ?? []).map((r) => r.role as string));
    if (!ALLOWED.some((r) => roles.has(r))) return json({ error: "forbidden" }, 403);

    const { data: applicants, error } = await admin
      .from("hh_applicants")
      .select(
        "id,name,phone,email,instagram,company,appointment_at,stage,interview_result,unqualified_reason,notes,va_id,recruiter_id,reschedule_count,created_at,updated_at",
      )
      .eq("archived", false)
      .order("appointment_at", { ascending: true, nullsFirst: false })
      .limit(2000);
    if (error) throw error;

    const rows = applicants ?? [];
    const counts: Record<string, number> = {};
    for (const a of rows) counts[a.stage as string] = (counts[a.stage as string] ?? 0) + 1;

    // Resolve VA / recruiter display names from hh_users in one round-trip so
    // the "owner" column reads a name, not a uuid.
    const ownerIds = Array.from(
      new Set(rows.flatMap((r) => [r.va_id, r.recruiter_id]).filter(Boolean) as string[]),
    );
    const owners: Record<string, string> = {};
    if (ownerIds.length) {
      const { data: users } = await admin.from("hh_users").select("id,name,email").in("id", ownerIds);
      for (const usr of users ?? []) owners[usr.id as string] = (usr.name || usr.email || "") as string;
    }

    const applicantsOut = rows.map((r) => ({
      ...r,
      va_name: r.va_id ? owners[r.va_id as string] ?? null : null,
      recruiter_name: r.recruiter_id ? owners[r.recruiter_id as string] ?? null : null,
    }));

    return json({
      applicants: applicantsOut,
      counts,
      total: rows.length,
      role: [...roles].find((r) => ALLOWED.includes(r)) ?? null,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "error" }, 500);
  }
});
