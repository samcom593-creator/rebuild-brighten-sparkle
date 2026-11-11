// Pure pieces of trigger-new-hire-flow (MP-ONBOARD-ANCHOR-PKG2, 2026-11-12), split out so the retry rules and the
// copy are pinned by deno tests (legs.test.ts) instead of read off a live send.

/** A leg's recorded outcome, e.g. "sent:re_123", "failed:rate limited", "skipped:no_email", "ok". */
export type LegStatus = string;

/** Outcomes that must not be attempted again on a retry. */
export function isSettled(status: LegStatus | null | undefined): boolean {
  if (!status) return false;
  return status === "ok" || status.startsWith("sent:") || status.startsWith("skipped:") || status.startsWith("refused:");
}

/**
 * The run is finished once the welcome email reached a terminal outcome: delivered to the provider, refused by the
 * gate (suppressed / non-routable: retrying cannot change that), or impossible (no address). Only then is the agent
 * marked unlocked; a transient failure leaves the run open for the hourly retry (3 attempts).
 */
export function runIsDone(legs: Record<string, LegStatus | undefined>): boolean {
  return isSettled(legs.welcome_email);
}

/** sendEmail's result as a leg status. A provider id is the only thing that makes a send "sent". */
export function legFromSend(reply: { ok: boolean; id: string | null; error?: string; refused?: string }): LegStatus {
  if (reply.ok && reply.id && reply.id.trim() !== "") return `sent:${reply.id}`;
  if (reply.refused) return `refused:${reply.refused}`;
  return `failed:${String(reply.error ?? "no provider id").slice(0, 200)}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function firstNameOf(fullName: string | null | undefined, displayName: string | null | undefined): string {
  const pick = [fullName, displayName].map((s) => (s ?? "").trim()).find((s) => s !== "" && !s.includes("@")) ?? "";
  return pick.split(/\s+/)[0] || "there";
}

export const DASHBOARD_URL = "https://apex-financial.org/agent-dashboard";

/** The hire's email: three short sentences and one link, no claims, no emoji. Sam's voice. */
export function welcomeEmail(first: string): { subject: string; html: string; text: string } {
  const f = escapeHtml(first);
  return {
    subject: `${first}, your Galaxy dashboard is live`,
    text:
      `${first}, you're in field training now, and your production dashboard is live. ` +
      `Every deal you write shows there and on the team leaderboard. ` +
      `If you get stuck this week, reply to this email.\n\nOpen my dashboard: ${DASHBOARD_URL}\n\nSam`,
    html:
      `<p>${f}, you're in field training now, and your production dashboard is live. ` +
      `Every deal you write shows there and on the team leaderboard. ` +
      `If you get stuck this week, reply to this email.</p>` +
      `<p><a href="${DASHBOARD_URL}">Open my dashboard</a></p><p>Sam</p>`,
  };
}

export function staffNotice(first: string): { subject: string; html: string } {
  return {
    subject: `${first} is in field training: watch for the first deal`,
    html: `<p>${escapeHtml(first)} moved into field training. Production dashboard unlocked.</p>`,
  };
}

export function managerNotice(first: string): { subject: string; html: string } {
  return {
    subject: `${first} is in field training on your team`,
    html: `<p>${escapeHtml(first)} moved into field training. Help them write their first deal this week.</p>`,
  };
}

/**
 * Whether the hiring manager may be emailed. invited_by_manager_id is an AGENT id; a departed, deactivated or
 * suspended manager (KJ's team was banned on 10-25) gets nothing.
 */
export function managerEligible(m: {
  status?: string | null;
  is_deactivated?: boolean | null;
  is_inactive?: boolean | null;
  suspended?: boolean | null;
  email?: string | null;
} | null): { ok: boolean; reason: string } {
  if (!m) return { ok: false, reason: "no_manager" };
  if (m.suspended) return { ok: false, reason: "manager_suspended" };
  if ((m.status ?? "") !== "active" || m.is_deactivated || m.is_inactive) return { ok: false, reason: "manager_not_active" };
  if (!m.email || !m.email.includes("@")) return { ok: false, reason: "manager_no_email" };
  return { ok: true, reason: "ok" };
}
