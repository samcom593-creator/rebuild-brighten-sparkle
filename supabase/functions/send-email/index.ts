// Thin HTTP wrapper around _shared/email.ts#sendEmail. All deliverability (deploy: 1776956070)
// defaults (List-Unsubscribe headers, plain-text alternative, unsubscribe
// footer) live in the shared helper so every other sender gets them free.

import { sendEmail } from "../_shared/email.ts";
import { requireSendAuth } from "../_shared/require-send-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // MP-446: this forwards body.to into Resend on Sam's verified domain, so it
  // was an open relay to any address on earth. Gate BEFORE reading the body.
  const auth = await requireSendAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ ok: false, error: auth.error }), {
      status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const result = await sendEmail({
      to:                body.to,
      subject:           body.subject,
      html:              body.html,
      text:              body.text,
      from:              body.from,
      reply_to:          body.reply_to,
      unsubscribe_token: body.unsubscribe_token,
      tagName:           body.tagName ?? "send-email",
    });

    const status = result.ok ? 200 : (result.error?.includes("required") ? 400 : 502);
    return new Response(JSON.stringify(result), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
