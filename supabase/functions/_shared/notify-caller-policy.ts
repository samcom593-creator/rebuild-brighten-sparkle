// notify-caller-policy.ts — who send-notification will mail on whose behalf.
//
// THE BUG THIS EXISTS FOR (PL-WIB-SEND-NOTIFICATION-RECIPIENT, 2026-10-09)
// PL-WIB-SEND-NOTIFICATION-AUTH (2026-10-08) closed the anonymous relay with a
// requireSendAuth floor of any_authenticated. That floor is a real gate only if
// "authenticated" means "one of ours". It does not: GoTrue /auth/v1/settings
// reports disable_signup=false, so anyone with an inbox can sign up, confirm,
// and hold a JWT that passes. The handler then took `email`, `userId`, `title`,
// `message` and `url` off the body, put title and message into the HTML
// unescaped and url into an href, and sent from notifications@apex-financial.org.
// That is a phishing relay on Sam's sending domain behind a free signup.
//
// WHO ACTUALLY CALLS IT (measured, not assumed)
//   service key  system-health-check, applicant_login_send,
//                send_reapply_email_blast. These compose deliberate HTML (the
//                magic-login anchor), so they are never escaped.
//   admin        NotificationHub + InboxPage resend (requireAdmin routes), by
//                userId or by a logged email.
//   any user     AgentPipelineSimple: manager-switch request to Sam's inbox.
//                RecruiterDashboard: an agent or VA following up an applicant
//                or aged lead that is already on their own screen.
// notification_log, 60 days to 2026-10-09: every send-notification row came
// from a service-key caller. No user-JWT send is on record, so the narrowing
// below locks nobody out of anything they have used.
//
// THE RULE
// service and admin/manager keep today's behaviour. Everyone else ("member")
// may only:
//   - address an email, never a userId (a userId fans out to push and SMS on
//     the person's profile, which the caller cannot see);
//   - reach Sam's two inboxes, or an address on an applications / aged_leads
//     row that the caller's OWN RLS returns. The visibility read is done by the
//     handler with the caller's token, so the policies are the authority and
//     this file does not restate them;
//   - send plain text: no url, and title/message are HTML-escaped.

export const STAFF_INBOXES: ReadonlySet<string> = new Set([
  "sam@apex-financial.org",
  "info@kingofsales.net",
]);

export const PRIVILEGED_ROLES: ReadonlySet<string> = new Set(["admin", "manager"]);

export type CallerClass = "service" | "privileged" | "member";

/**
 * `caller` is requireSendAuth's result ("service" or "user:<uuid>").
 * `roles` is the user's user_roles rows, or null when they could not be read.
 * Returns null when the class cannot be decided: the handler must refuse, never
 * fall through to the unrestricted path.
 */
export function classifyCaller(
  caller: string | undefined,
  roles: readonly unknown[] | null,
): CallerClass | null {
  if (caller === "service") return "service";
  if (!caller || !caller.startsWith("user:") || caller.length <= 5) return null;
  if (roles === null) return null;
  return roles.some((r) => PRIVILEGED_ROLES.has(String(r))) ? "privileged" : "member";
}

export interface Refusal {
  status: number;
  error: string;
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
}

/** Shape checks for a member request, before any DB read. */
export function memberRefusal(body: Record<string, unknown>): Refusal | null {
  if (present(body.userId)) {
    return { status: 403, error: "forbidden: only staff can address a user id" };
  }
  if (present(body.url)) {
    return { status: 403, error: "forbidden: only staff can attach a link" };
  }
  if (typeof body.email !== "string" || body.email.trim() === "") {
    return { status: 400, error: "email is required" };
  }
  return null;
}

export function isStaffInbox(email: string): boolean {
  return STAFF_INBOXES.has(email.trim().toLowerCase());
}

export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
