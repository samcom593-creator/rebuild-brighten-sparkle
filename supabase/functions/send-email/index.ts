// Email-send with deliverability-first defaults:
//   - List-Unsubscribe headers (big deal for Gmail/Outlook spam filters)
//   - reply_to set to a real monitored inbox
//   - text fallback auto-generated from HTML if not provided
//   - unsubscribe link appended to HTML if not present
//   - structured error surfacing so the caller can decide to retry
//
// Required env: RESEND_API_KEY
// Optional env: EMAIL_FROM (defaults to "Sam at APEX <sam@apex-financial.org>"),
//               EMAIL_REPLY_TO (defaults to "sam@apex-financial.org"),
//               APEX_DOMAIN (defaults to "apex-financial.org") — used for unsub links

import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, idempotency-key",
};

const DEFAULT_FROM     = Deno.env.get("EMAIL_FROM")     ?? "Sam at APEX <sam@apex-financial.org>";
const DEFAULT_REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "sam@apex-financial.org";
const DOMAIN           = Deno.env.get("APEX_DOMAIN")    ?? "apex-financial.org";

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function ensureUnsubscribeFooter(html: string, unsubscribeUrl: string): string {
  if (/unsubscribe/i.test(html)) return html;
  return html + `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;font-family:Arial,sans-serif">
  <p>You received this because you're part of the APEX Financial network.</p>
  <p><a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a> · APEX Financial · Dallas, TX</p>
</div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { to, subject, html, text, from, reply_to, unsubscribe_token } = body;
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

    const resolvedHtml = html ?? `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${text}</pre>`;
    const resolvedText = text ?? htmlToText(resolvedHtml);

    // Per-recipient unsubscribe link so Gmail honors the List-Unsubscribe one-click header
    const unsubToken = unsubscribe_token ?? encodeURIComponent(String(to));
    const unsubscribeUrl  = `https://${DOMAIN}/unsubscribe?u=${unsubToken}`;
    const unsubscribeMail = `mailto:unsubscribe@${DOMAIN}?subject=unsubscribe`;
    const finalHtml = ensureUnsubscribeFooter(resolvedHtml, unsubscribeUrl);

    const resend = new Resend(resendKey);
    const result = await resend.emails.send({
      from:     from     ?? DEFAULT_FROM,
      to:       Array.isArray(to) ? to : [to],
      reply_to: reply_to ?? DEFAULT_REPLY_TO,
      subject,
      html:     finalHtml,
      text:     resolvedText,
      headers: {
        "List-Unsubscribe":      `<${unsubscribeMail}>, <${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "X-Entity-Ref-ID":       crypto.randomUUID(),
      },
      tags: [{ name: "source", value: "apex" }],
    });

    const id  = (result as any)?.data?.id ?? null;
    const err = (result as any)?.error;
    if (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[send-email] fatal", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
