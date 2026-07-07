// APEX send-couldnt-reach-email — Sam directive 2026-07-06:
// "make applications better obviously by clicking bad numbers and send them
//  an email. Let them know we couldn't call them."
//
// Called from DashboardApplicants on "Mark bad + email" quick action.
// Body: { application_id: uuid, reason?: string }
//
// Steps:
//   1. Read application (name/email/phone) via service role.
//   2. If email missing -> return 400 (nothing to send).
//   3. Build templated Resend email (short, direct, APEX voice).
//   4. Send via Resend; reject fake-success (200 with non-JSON / no data.id)
//      per Operating Contract.
//   5. UPDATE applications SET couldnt_reach_email_sent_at = now() ONLY on real success.
//   6. Return { ok, resend_id, email }.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface ApplicationRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
}

function buildEmail(first: string, from: string) {
  const safeFirst = first || "there";
  const subject = "Tried to reach you — got a bad number";
  const text = `Hey ${safeFirst},

We tried calling the number you gave us on your APEX Financial application, but couldn't get through — either it disconnected, wrong number, or no answer.

Reply to this email with the best number to reach you and the best time (morning / afternoon / evening in your time zone) and we'll get you back on track. Everything's still open on our side — no strike against your application.

— APEX Financial recruiting`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;background:#0a0a0a;color:#fff;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="font-size:22px;font-weight:800;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
  </div>
  <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:14px;padding:28px;border:1px solid rgba(20,184,166,0.25);">
    <h2 style="font-size:19px;margin:0 0 14px 0;color:#fff;">Hey ${safeFirst},</h2>
    <p style="font-size:15px;line-height:1.6;color:#d1d5db;margin:0 0 14px 0;">
      We tried calling the number you gave us on your APEX Financial application, but couldn't get through — either it disconnected, wrong number, or no answer.
    </p>
    <p style="font-size:15px;line-height:1.6;color:#d1d5db;margin:0 0 18px 0;">
      Reply with the best number to reach you and a good time window (morning / afternoon / evening) and we'll get you back on track. Everything's still open — no strike against your application.
    </p>
    <p style="font-size:14px;color:#9ca3af;margin:0;">— APEX Financial recruiting</p>
  </div>
  <div style="text-align:center;margin-top:20px;font-size:12px;color:#6b7280;">
    apex-financial.org
  </div>
</div>
</body></html>`;

  return { subject, text, html, from };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST")
    return new Response(JSON.stringify({ ok: false, error: "method" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let body: { application_id?: string; reason?: string } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad_json" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const appId = body.application_id;
  if (!appId) {
    return new Response(JSON.stringify({ ok: false, error: "missing_application_id" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Resolve applicant.
  const { data: app, error: appErr } = await sb
    .from("applications")
    .select("id, first_name, last_name, email, phone, state")
    .eq("id", appId)
    .maybeSingle();

  if (appErr || !app) {
    return new Response(JSON.stringify({ ok: false, error: "applicant_not_found" }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const applicant = app as ApplicationRow;

  if (!applicant.email) {
    return new Response(
      JSON.stringify({ ok: false, error: "no_email_on_file", applicant_id: applicant.id }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // Load Resend key + from address.
  const { data: settingsRows } = await sb
    .from("system_settings")
    .select("key,value")
    .in("key", ["resend_api_key", "onboarding_email_from_address"]);
  const sMap = new Map<string, string | null>();
  for (const r of (settingsRows ?? []) as Array<{ key: string; value: string | null }>) {
    sMap.set(r.key, r.value);
  }
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? sMap.get("resend_api_key") ?? "";
  const fromRaw = sMap.get("onboarding_email_from_address") ?? "APEX Financial <recruiting@apex-financial.org>";
  const from = fromRaw.replace(/^"|"$/g, "");

  if (!resendKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "no_resend_key_configured" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const { subject, text, html } = buildEmail(applicant.first_name ?? "", from);

  // Send.
  let resendJson: { id?: string } | null = null;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [applicant.email],
        subject,
        text,
        html,
      }),
    });
    const ctype = resp.headers.get("content-type") ?? "";
    if (!ctype.includes("application/json")) {
      // Fake-success guard: Operating Contract says non-JSON = failure.
      const bodyText = await resp.text();
      return new Response(
        JSON.stringify({ ok: false, error: "resend_non_json_response", body: bodyText.slice(0, 200) }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    resendJson = (await resp.json()) as { id?: string };
    if (!resp.ok || !resendJson?.id) {
      return new Response(
        JSON.stringify({ ok: false, error: "resend_error", status: resp.status, body: resendJson }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: "resend_fetch_failed", detail: String(err) }),
      { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // Only on real success: update timestamp.
  const nowIso = new Date().toISOString();
  const { error: updErr } = await sb
    .from("applications")
    .update({ couldnt_reach_email_sent_at: nowIso })
    .eq("id", applicant.id);
  if (updErr) {
    // Email sent but DB write failed — surface warning instead of losing receipt.
    return new Response(
      JSON.stringify({
        ok: true,
        resend_id: resendJson.id,
        email: applicant.email,
        warning: "email_sent_but_db_write_failed",
        db_error: updErr.message,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, resend_id: resendJson.id, email: applicant.email, sent_at: nowIso }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
