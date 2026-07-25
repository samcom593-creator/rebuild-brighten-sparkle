// readymode-webhook — receives dialer disposition events from ReadyMode and
// updates aged_leads so the dashboard reflects what the dialer did.
//
// Required secrets:
//   READYMODE_WEBHOOK_SECRET   (random string; share with ReadyMode admin)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Expected POST body:
// {
//   "secret": "...",
//   "phone": "5551234567",
//   "email": "lead@example.com",   // optional fallback match
//   "disposition": "answer|no_answer|voicemail|do_not_call|booked|interested|callback",
//   "agent_id": "uuid",            // optional dialer agent
//   "called_at": "2026-05-14T12:34:56Z"
// }
//
// config.toml: this function must have `verify_jwt = false`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let payload: any;
  try { payload = await req.json(); } catch { return errorResponse("Bad JSON", 400); }

  // Fail closed. When READYMODE_WEBHOOK_SECRET is unset, Deno.env.get returns
  // undefined and a body with no `secret` field used to pass the comparison
  // (undefined === undefined) — letting any caller write aged_leads
  // dispositions and DNC flags. Refuse the request instead.
  const expectedSecret = Deno.env.get("READYMODE_WEBHOOK_SECRET") ?? "";
  if (!expectedSecret) {
    return errorResponse("Webhook secret not configured", 503);
  }
  if (payload.secret !== expectedSecret) {
    return errorResponse("Unauthorized", 401);
  }

  const phoneDigits = String(payload.phone || "").replace(/[^0-9]/g, "");
  const email = String(payload.email || "").trim().toLowerCase();
  if (!phoneDigits && !email) return errorResponse("Need phone or email", 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Match by trailing 10 digits of phone (most reliable across formats), then email.
  let match: { id: string; dial_count: number | null } | null = null;
  if (phoneDigits.length >= 10) {
    const last10 = phoneDigits.slice(-10);
    const { data } = await supabase
      .from("aged_leads")
      .select("id, dial_count")
      .ilike("phone", `%${last10}%`)
      .limit(1)
      .maybeSingle();
    match = data ?? null;
  }
  if (!match && email) {
    const { data } = await supabase
      .from("aged_leads")
      .select("id, dial_count")
      .eq("email", email)
      .limit(1)
      .maybeSingle();
    match = data ?? null;
  }

  if (!match) {
    // Not a known aged lead. Log so we can see what's coming in, but 200 so
    // ReadyMode doesn't retry storms.
    await supabase.from("error_logs").insert({
      url: "edge:readymode-webhook",
      error_message: `Unknown lead phone=${phoneDigits} email=${email}`,
    });
    return jsonResponse({ ok: true, unknown_lead: true });
  }

  const updates: Record<string, unknown> = {
    last_dialed_at: payload.called_at || new Date().toISOString(),
    last_disposition: String(payload.disposition || "unknown"),
    dial_count: (match.dial_count ?? 0) + 1,
  };
  if (payload.disposition === "do_not_call") updates.dnc = true;
  if (payload.agent_id) updates.assigned_agent_id = payload.agent_id;
  if (payload.disposition === "answer" || payload.disposition === "interested" || payload.disposition === "booked") {
    updates.contacted_at = updates.last_dialed_at;
    updates.last_contacted_at = updates.last_dialed_at;
  }

  const { error } = await supabase.from("aged_leads").update(updates).eq("id", match.id);
  if (error) {
    await supabase.from("error_logs").insert({
      url: "edge:readymode-webhook",
      error_message: error.message,
    });
    return errorResponse(error.message, 500);
  }

  return jsonResponse({ ok: true, lead_id: match.id, disposition: payload.disposition });
});
