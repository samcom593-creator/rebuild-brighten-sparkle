// Generic admin email sender — accepts { to, subject, html, text, from } and
// sends via Resend from Sam's verified domain.
//
// PL-WIB-SEND-ADMIN-EMAIL-AUTH (2026-10-08). This header used to say the
// function was "restricted to the admin principal so it can't be abused as a
// spam relay". Nothing enforced that: verify_jwt = false and the handler read
// no credential, so a bare POST with no Authorization header reached the Resend
// call (probed 2026-10-08 04:5xZ: 400 from body validation, not 401). The
// caller chose the recipient, the HTML AND the From line, so any stranger could
// send mail as sam@apex-financial.org to any address.
//
// Callers, inventoried before gating: no src/ invoke, no other edge function,
// no business-ops script, 0 edge hits in 24h. Four pg functions post here:
// notify_sam_on_licensing_milestone (trigger trg_notify_sam_licensing on
// applications, live) and three digests no cron job schedules
// (stuck_applicants_daily_digest, manager_daily_accountability,
// dm_overnight_digest). All four sent the anon key; they were switched to
// system_settings.service_role_key for this call first (migration
// 20261008050000), so the gate never refused a real caller.
//
// Gate = requireSendAuth, the send-email gate: service key or an
// admin/manager JWT. The anon key is refused explicitly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { requireSendAuth } from "../_shared/require-send-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireSendAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: auth.error }), {
      status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { to, subject, html, text, from } = await req.json();
    if (!to || !subject || (!html && !text)) {
      return new Response(JSON.stringify({ error: "to, subject, and html|text required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const resend = new Resend(resendKey);
    const result = await resend.emails.send({
      from: from || "Sam at APEX <sam@apex-financial.org>",
      to,
      subject,
      html: html || `<pre>${text}</pre>`,
    });

    return new Response(JSON.stringify({ ok: true, id: (result as any)?.data?.id ?? null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[send-admin-email] fatal", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
