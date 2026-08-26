// Admin-verified Slack identity linking.
//
// An APEX operator obtains the Slack user ID + email from the signed-in Slack
// admin surface, then submits them here. The database function enforces exact
// email equality with an active hired agent, provider exclusions, and all
// uniqueness/conflict rules before it marks the link verified.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  const botToken = Deno.env.get("APEX_BOT_TOKEN")?.trim() ?? "";
  if (!supabaseUrl || !serviceRoleKey || !botToken) {
    return json({ ok: false, error: "server_not_configured" }, 503);
  }

  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer || (bearer !== serviceRoleKey && bearer !== botToken)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const agentId = typeof body.agent_id === "string" ? body.agent_id.trim() : "";
  const slackUserId = typeof body.slack_user_id === "string" ? body.slack_user_id.trim() : "";
  const slackEmail = typeof body.slack_email === "string" ? body.slack_email.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(agentId) || !/^[UW][A-Z0-9]{8,}$/.test(slackUserId) || !slackEmail) {
    return json({ ok: false, error: "invalid_identity_claim" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("admin_verify_slack_identity", {
    p_agent_id: agentId,
    p_slack_user_id: slackUserId,
    p_slack_email: slackEmail,
  });
  if (error) {
    const conflict = error.code === "23505";
    const forbidden = error.code === "42501";
    return json({
      ok: false,
      error: conflict ? "identity_conflict" : forbidden ? "agent_not_eligible" : "verification_failed",
    }, conflict ? 409 : forbidden ? 403 : 400);
  }

  return json(data);
});
