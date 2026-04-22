// Thin alias for send-admin-email. The frontend's BulkComposeDrawer expects
// a function named "send-email" for per-recipient fallback. Rather than
// renaming across the UI, this forwards the same payload. Any future email
// needs should go through send-admin-email directly.

import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
    console.error("[send-email] fatal", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
