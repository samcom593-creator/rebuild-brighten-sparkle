// Where a recruit's reply lands (MP-ONBOARD-ANCHOR-PKG1, 2026-11-12).
//
// Measured 2026-11-11 with an SMTP RCPT probe that sends no message: sam@,
// notifications@, hello@, alerts@ and unsubscribe@apex-financial.org all return
// 550 5.1.1 "account does not exist" at Google's MX, while info@kingofsales.net
// returns 250. A reply to any apex-financial.org address bounces back to the
// recruit and leaves no trace on our side. info@kingofsales.net is the only
// mailbox that exists, so it is the Reply-To on every recruit and hire email.
//
// resolveReplyTo() is the one rule: a caller (or the EMAIL_REPLY_TO secret) may
// name another inbox, but never an empty value and never an address on the
// sending domain, which has no mailboxes. Pure, no remote imports, so
// reply-to.test.ts runs offline.

export const RECRUIT_REPLY_TO = "info@kingofsales.net";

/** Domains that send mail but receive none (every mailbox probed returned 550). */
export const NO_MAILBOX_DOMAINS: readonly string[] = ["apex-financial.org"];

/** "Name <a@b.com>" or "a@b.com" -> "a@b.com" (lower-cased); "" when there is no address. */
export function replyAddress(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const m = s.match(/<([^<>]+)>\s*$/);
  const addr = (m ? m[1] : s).trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(addr) ? addr : "";
}

/** The candidate when it is a real, receiving inbox; otherwise RECRUIT_REPLY_TO. */
export function resolveReplyTo(candidate?: string | null): string {
  const addr = replyAddress(candidate);
  if (!addr) return RECRUIT_REPLY_TO;
  const domain = addr.slice(addr.lastIndexOf("@") + 1);
  if (NO_MAILBOX_DOMAINS.includes(domain)) return RECRUIT_REPLY_TO;
  return String(candidate).trim();
}
