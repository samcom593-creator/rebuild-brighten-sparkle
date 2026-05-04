// Shared email sender with deliverability-first defaults.
//
// Every outbound email should go through this helper so we consistently:
//   - Attach List-Unsubscribe + List-Unsubscribe-Post headers (required by
//     Gmail/Yahoo for bulk senders; major spam-folder signal if missing)
//   - Include a plain-text alternative (derived from HTML if not provided)
//   - Append an unsubscribe footer to HTML that doesn't already have one
//   - Record a per-recipient unsubscribe token so one-click actually works
//   - Set a consistent Reply-To so bounces come to a monitored inbox
//
// Usage:
//   import { sendEmail } from "../_shared/email.ts";
//   await sendEmail({ to, subject, html });
//
// The optional `tagName` lets you tag the send in Resend ("source", "<tagName>")
// so you can segment deliverability stats in the Resend dashboard.
//
// Required env: RESEND_API_KEY
// Optional env: EMAIL_FROM, EMAIL_REPLY_TO, APEX_DOMAIN

import { Resend } from "https://esm.sh/resend@2.0.0";

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  reply_to?: string;
  unsubscribe_token?: string;  // pass a user-id or similar so unsubscribe knows who
  tagName?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id: string | null;
  error?: string;
}

const DEFAULT_FROM     = Deno.env.get("EMAIL_FROM")     ?? "Sam at APEX <sam@apex-financial.org>";
const DEFAULT_REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "sam@apex-financial.org";
const DOMAIN           = Deno.env.get("APEX_DOMAIN")    ?? "apex-financial.org";

export function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function ensureUnsubscribeFooter(html: string, unsubscribeUrl: string): string {
  if (/unsubscribe/i.test(html)) return html;
  return html + `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;font-family:Arial,sans-serif">
  <p>You received this because you're part of the APEX Financial network.</p>
  <p><a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a> · APEX Financial · Dallas, TX</p>
</div>`;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { to, subject, html, text, from, reply_to, unsubscribe_token, tagName } = input;
  if (!to || !subject || (!html && !text)) {
    return { ok: false, id: null, error: "to, subject, and html|text required" };
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return { ok: false, id: null, error: "RESEND_API_KEY missing" };
  }

  const resolvedHtml = html ?? `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${text}</pre>`;
  const resolvedText = text ?? htmlToText(resolvedHtml);

  const firstTo = Array.isArray(to) ? to[0] : to;
  const unsubToken = unsubscribe_token ?? encodeURIComponent(String(firstTo));
  // Route to the unsubscribe edge function directly so one-click works
  // regardless of whether the marketing site is up, and so the HTML
  // confirmation is always served.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "https://xrzweoneiieddzxogewk.supabase.co";
  const unsubscribeUrl  = `${supabaseUrl}/functions/v1/unsubscribe?u=${unsubToken}`;
  const unsubscribeMail = `mailto:unsubscribe@${DOMAIN}?subject=unsubscribe`;
  const finalHtml = ensureUnsubscribeFooter(resolvedHtml, unsubscribeUrl);

  try {
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
      tags: [{ name: "source", value: tagName ?? "apex" }],
    });

    const id  = (result as any)?.data?.id ?? null;
    const err = (result as any)?.error;
    if (err) return { ok: false, id, error: err.message ?? String(err) };
    return { ok: true, id };
  } catch (e: any) {
    return { ok: false, id: null, error: e?.message ?? String(e) };
  }
}

// Check system_settings or an unsubscribes table for opt-outs before sending.
// Callers should invoke this before any bulk send loop.
// Uses the Supabase service_role client passed in (we avoid importing supabase-js
// here to keep this module a leaf).
export async function isUnsubscribed(
  supabase: { from: (t: string) => any },
  email: string,
): Promise<boolean> {
  if (!email) return false;
  try {
    const { data, error } = await supabase
      .from("email_unsubscribes")
      .select("email")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}
