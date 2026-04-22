// Bulk email sender. Used by the BulkComposeDrawer in the admin UI.
// Input: { recipients: [{email, name}], subject, html, text }
// Sends each via Resend; returns { sent, failed }.
//
// One Resend API call per recipient. Simpler than Resend's batch endpoint
// and lets per-recipient failures surface in logs without breaking the
// whole send. Fits our scale (dozens-hundreds at a time) — revisit if we
// start sending to thousands.

import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

interface Recipient {
  email: string;
  name?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const recipients: Recipient[] = Array.isArray(body.recipients) ? body.recipients : [];
    const subject: string = body.subject ?? "";
    const html: string = body.html ?? "";
    const text: string = body.text ?? "";
    const from: string = body.from ?? "Sam at APEX <sam@apex-financial.org>";

    if (recipients.length === 0 || !subject || (!html && !text)) {
      return new Response(JSON.stringify({ error: "recipients[], subject, and html|text required" }), {
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

    let sent = 0;
    let failed = 0;
    const errors: Array<{ email: string; error: string }> = [];

    for (const r of recipients) {
      if (!r.email) { failed++; continue; }
      try {
        const result = await resend.emails.send({
          from,
          to: r.email,
          subject,
          html: html || `<pre>${text}</pre>`,
        });
        if ((result as any)?.error) {
          failed++;
          errors.push({ email: r.email, error: String((result as any).error?.message ?? (result as any).error) });
        } else {
          sent++;
        }
      } catch (e: any) {
        failed++;
        errors.push({ email: r.email, error: e?.message ?? String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, failed, errors: errors.slice(0, 20) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[send-bulk-email] fatal", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
