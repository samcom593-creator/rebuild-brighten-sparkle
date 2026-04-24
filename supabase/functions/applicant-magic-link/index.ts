/**
 * applicant-magic-link — creates an auth user for a warm applicant (if
 * missing) and returns a Supabase NATIVE magic-link URL. Native = no custom
 * verify-magic-link round-trip; the URL logs them in directly via Supabase
 * Auth and lands at /dashboard.
 *
 * Input:  { applicationId: string }  — OR  { email: string, firstName?: string }
 * Output: { success, email, action_link, created_user: boolean }
 *
 * Use it as the "send them the link" path mentioned by Sam 2026-04-23.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REDIRECT = "https://apex-financial.org/dashboard";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SB_URL, SB_SRV, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({} as any));
  let email: string | null = body.email ?? null;
  let firstName: string | null = body.firstName ?? null;

  if (body.applicationId) {
    const { data } = await sb.from("applications")
      .select("email, first_name")
      .eq("id", body.applicationId)
      .maybeSingle();
    email = (data as any)?.email ?? email;
    firstName = (data as any)?.first_name ?? firstName;
  }

  if (!email) {
    return new Response(JSON.stringify({ error: "email or applicationId required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  email = email.toLowerCase().trim();

  let createdUser = false;

  // 1) Create auth user if missing. createUser returns 422 if email taken — treat as idempotent.
  const { data: createRes, error: createErr } = await sb.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { source: "applicant_magic_link", first_name: firstName },
  });
  if (createErr) {
    const msg = (createErr as any)?.message ?? "";
    const status = (createErr as any)?.status ?? 0;
    // Idempotent on any "user exists" signal from Supabase Auth
    const isDuplicate = status === 422 || /already/i.test(msg);
    if (!isDuplicate) {
      return new Response(JSON.stringify({ error: "create_user_failed", detail: msg }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else if (createRes?.user) {
    createdUser = true;
  }

  // 2) Generate native magic link
  const { data: linkRes, error: linkErr } = await sb.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: REDIRECT },
  });
  if (linkErr) {
    return new Response(JSON.stringify({ error: "generate_link_failed", detail: (linkErr as any)?.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const action_link = (linkRes as any)?.properties?.action_link ?? (linkRes as any)?.action_link;
  if (!action_link) {
    return new Response(JSON.stringify({ error: "no_action_link", detail: JSON.stringify(linkRes).slice(0, 300) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    success: true, email, firstName, action_link, created_user: createdUser,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
