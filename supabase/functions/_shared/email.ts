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
import { nonRoutableDomain } from "./non-routable.ts";
import { lookupSuppressed } from "./suppression.ts";
import { RECRUIT_REPLY_TO, resolveReplyTo } from "./reply-to.ts";

export { RECRUIT_REPLY_TO };

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
  refused?: "non_routable" | "suppressed";
}

// WP4 (2026-11-10): one sender identity for recruit-facing mail. Resend showed
// 12 display names in 30 days ("Galaxy Financial", "Sam · Galaxy", "Galaxy
// System", ...) for the same audience, which splits Gmail's sender grouping and
// reads like different companies. Every sender imports these; a literal
// `from: "..."` outside this file is counted by scripts/check-hardcoded-sender.mjs
// and a NEW one fails the ratchet. The sending domain stays apex-financial.org
// (verified in Resend; changing it would reset reputation).
export const BRAND_FROM = "Sam at Galaxy Financial <sam@apex-financial.org>";
// Personal-brand mail (sell4daddy.com: the Glow-Up checklist and its sequence). Same verified sending
// domain, Sam's own name: these readers signed up to hear from him, not from the agency.
export const PERSONAL_FROM = "Samuel James <sam@apex-financial.org>";
// Reply-To is the inbox the pipeline owner actually works. EMAIL_REPLY_TO is
// unset in edge secrets today (checked 2026-11-10). MP-ONBOARD-ANCHOR-PKG1
// (2026-11-12): the value goes through resolveReplyTo(), so an empty secret or
// an address on apex-financial.org (every mailbox there returns 550) can never
// become the Reply-To; info@kingofsales.net is the only inbox that exists.
export const BRAND_REPLY_TO = resolveReplyTo(Deno.env.get("EMAIL_REPLY_TO"));
// CAN-SPAM needs a valid postal address in commercial email. The LLC's registered
// address (already public as its Stripe support address); one value, also stored in
// system_settings.company_postal_address for the DB-rendered templates.
export const COMPANY_POSTAL_ADDRESS =
  Deno.env.get("COMPANY_POSTAL_ADDRESS") ??
  "Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801";

const DEFAULT_FROM     = Deno.env.get("EMAIL_FROM")     ?? BRAND_FROM;
const DEFAULT_REPLY_TO = BRAND_REPLY_TO;
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
  <p>You received this because you're part of the Galaxy Financial network.</p>
  <p><a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a> · ${COMPANY_POSTAL_ADDRESS}</p>
</div>`;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { to, subject, html, text, from, reply_to, unsubscribe_token, tagName } = input;
  if (!to || !subject || (!html && !text)) {
    return { ok: false, id: null, error: "to, subject, and html|text required" };
  }

  const deadDomain = (Array.isArray(to) ? to : [to]).map(nonRoutableDomain).find(Boolean);
  if (deadDomain) {
    return { ok: false, id: null, error: `recipient domain ${deadDomain} cannot receive mail; not sent`, refused: "non_routable" };
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return { ok: false, id: null, error: "RESEND_API_KEY missing" };
  }

  // Resend accepts a send to an address on its suppression list, returns an
  // id, and never attempts it. Drop those here (see suppression.ts). A failed
  // lookup returns null and the send goes ahead unchanged.
  const wanted = (Array.isArray(to) ? to : [to]).map((a) => String(a).trim()).filter(Boolean);
  const blocked = await lookupSuppressed(wanted);
  const deliverable = blocked ? wanted.filter((a) => !blocked.has(a.toLowerCase())) : wanted;
  if (deliverable.length === 0) {
    return { ok: false, id: null, error: "recipient is on Resend's suppression list (hard bounce or complaint); not sent", refused: "suppressed" };
  }

  const resolvedHtml = html ?? `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${text}</pre>`;
  const resolvedText = text ?? htmlToText(resolvedHtml);

  const firstTo = deliverable[0];
  const unsubToken = unsubscribe_token ?? encodeURIComponent(String(firstTo));
  // One-click (RFC 8058) POSTs go straight to the unsubscribe edge function, so
  // they work even if the site is down. A human click (GET) is redirected to
  // apex-financial.org/unsubscribe, which asks for one press before writing.
  // The mailto fallback must be a mailbox that exists: unsubscribe@ on the
  // sending domain returns 550 (RCPT-probed 2026-11-11); info@kingofsales.net
  // is the one live inbox.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "https://xrzweoneiieddzxogewk.supabase.co";
  const unsubscribeUrl  = `${supabaseUrl}/functions/v1/unsubscribe?u=${unsubToken}`;
  const unsubscribeMail = `mailto:${BRAND_REPLY_TO}?subject=unsubscribe`;
  const finalHtml = ensureUnsubscribeFooter(resolvedHtml, unsubscribeUrl);

  try {
    const resend = new Resend(resendKey);
    const result = await resend.emails.send({
      from:     from     ?? DEFAULT_FROM,
      to:       deliverable,
      // A caller that passes none (or an empty or dead address) still gets the live inbox.
      reply_to: resolveReplyTo(reply_to ?? DEFAULT_REPLY_TO),
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
