// Bulk email sender. Used by the BulkComposeDrawer in the admin UI.
// Input: { recipients: [{email, name}], subject, html, text }
// Deploy touch: 2026-04-23
//
// Uses the shared deliverability helper — every send gets List-Unsubscribe,
// plain-text alt, unsubscribe footer, and honors the email_unsubscribes
// opt-out list before we hit Resend.
//
// One Resend API call per recipient, serially throttled to ~4/sec so we
// don't hit Resend's rate limit or look like a burst to receiving MTAs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendEmail } from "../_shared/email.ts";
import { requireSendAuth } from "../_shared/require-send-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

interface Recipient {
  email: string;
  name?: string;
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // MP-446: recipients[] comes straight off the body and every one of them
  // gets a real Resend send from Sam's verified domain. Gate BEFORE the body.
  const auth = await requireSendAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const recipients: Recipient[] = Array.isArray(body.recipients) ? body.recipients : [];
    const subject: string = body.subject ?? "";
    const html: string = body.html ?? "";
    const text: string = body.text ?? "";
    const from: string | undefined = body.from;

    if (recipients.length === 0 || !subject || (!html && !text)) {
      return new Response(JSON.stringify({ error: "recipients[], subject, and html|text required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PL-WIB-BULK-UNSUB-FAIL-CLOSED (2026-10-11). This used isUnsubscribed(),
    // which returns false when the read errors, so an unreadable opt-out list
    // meant every recipient got mailed, opt-outs included. Same rule as the two
    // applicant blasts in PL-WIB-UNSUB-SUPPRESSION: read the list once, and if
    // it cannot be read nothing is sent.
    const { data: unsubRows, error: unsubError } = await supabase
      .from("email_unsubscribes")
      .select("email");
    if (unsubError) {
      return new Response(
        JSON.stringify({ error: `email_unsubscribes unreadable, nothing sent: ${unsubError.message}` }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const unsubscribed = new Set(
      (unsubRows ?? []).map((r: { email: string }) => String(r.email).trim().toLowerCase()),
    );

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const errors: Array<{ email: string; error: string }> = [];

    for (const r of recipients) {
      if (!r.email) { failed++; continue; }
      if (unsubscribed.has(String(r.email).trim().toLowerCase())) { skipped++; continue; }

      const result = await sendEmail({
        to:      r.email,
        subject,
        html:    html || undefined,
        text:    text || undefined,
        from,
        tagName: "bulk-compose",
      });

      if (result.ok) {
        sent++;
      } else {
        failed++;
        errors.push({ email: r.email, error: result.error ?? "unknown" });
      }

      // ~4/sec — polite to Resend + receiving MTAs.
      await sleep(250);
    }

    return new Response(JSON.stringify({ ok: true, sent, failed, skipped, errors: errors.slice(0, 20) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[send-bulk-email] fatal", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
