// WP6 (2026-11-10): onboarding-call reminders d2/d5/d10.
//
// The first booking email was one-shot by construction (UNIQUE(agent_id,
// email_kind) + a sweep that skipped sent rows), and 2 of 20 licensed hires
// since 09-10 booked. fn_sweep_onboarding_call_gaps now enqueues up to three
// reminders, one queue kind per step, so the unique index itself caps it at 3.
// They are forward-only (hires created at/after system_settings
// onboarding_wp6_cutoff_at), and the sender re-checks the booking at send time,
// so a booking stops the sequence.
//
// Kept apart from index.ts so it can be tested without starting the server.

export const REMINDER_KINDS = [
  "onboarding_call_reminder_d2",
  "onboarding_call_reminder_d5",
  "onboarding_call_reminder_d10",
] as const;
export type ReminderKind = typeof REMINDER_KINDS[number];

export function isReminderKind(kind: string): kind is ReminderKind {
  return (REMINDER_KINDS as readonly string[]).includes(kind);
}

// Mirrors TRAINING_ROUTES.fieldCourse in src/lib/trainingRoutes.ts: the page
// where the required onboarding_progress modules live. The course email used
// to point at /dashboard/training/library (the extra-practice library), while
// the nudges pointed here; hires got two different "start training" answers.
export const FIELD_COURSE_URL = "https://apex-financial.org/dashboard/training/sales-course";

function firstNameOf(fullName: string | null | undefined): string {
  const cleaned = (fullName ?? "").trim();
  return cleaned ? cleaned.split(/\s+/)[0] : "there";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Short, one link, no staff names: who runs the call is still an open question
// for Sam (audit N5/N7), so the copy never promises a person.
const REMINDER_COPY: Record<ReminderKind, { subject: string; opener: (fn: string) => string; body: string }> = {
  onboarding_call_reminder_d2: {
    subject: "Your onboarding call isn't booked yet",
    opener: (fn) => `Hey ${fn},`,
    body: "Your onboarding call is the step that gets you contracted and on the phones. It takes 30 minutes.",
  },
  onboarding_call_reminder_d5: {
    subject: "Still need your onboarding call on the calendar",
    opener: (fn) => `${fn},`,
    body: "You're licensed and on the team, but we haven't set up your contracting yet. That happens on the onboarding call.",
  },
  onboarding_call_reminder_d10: {
    subject: "Last reminder: book your onboarding call",
    opener: (fn) => `${fn},`,
    body: "This is my last reminder about your onboarding call. If now isn't the time, reply and tell me what's in the way.",
  },
};

export function buildOnboardingCallReminderEmail(
  name: string,
  bookingUrl: string,
  kind: ReminderKind,
): { subject: string; html: string; text: string } {
  const plainFirst = firstNameOf(name);
  const copy = REMINDER_COPY[kind];
  const text = [
    copy.opener(plainFirst),
    "",
    copy.body,
    "",
    `Pick a time here: ${bookingUrl}`,
    "",
    "— Sam",
    "Galaxy Financial",
  ].join("\n");
  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;line-height:1.55;">
  <p>${escapeHtml(copy.opener(plainFirst))}</p>
  <p>${escapeHtml(copy.body)}</p>
  <p><a href="${escapeHtml(bookingUrl)}" style="display:inline-block;padding:12px 20px;background:#0a0a0a;color:#EDB81D;text-decoration:none;border-radius:6px;font-weight:600;">Book your onboarding call</a></p>
  <p style="margin-top:24px;">— Sam<br/>Galaxy Financial</p>
</body></html>`.trim();
  return { subject: copy.subject, html, text };
}

export interface ReminderEligibility {
  ok: boolean;
  reason: "eligible" | "pre_cutoff" | "window_closed" | "no_cutoff" | "unknown_hire_date";
}

/** Send-time re-check, independent of the sweep that enqueued the row. */
export function reminderEligibleAtSend(
  hiredAtIso: string | null | undefined,
  cutoffMs: number | null,
  nowMs: number,
  windowMs = 30 * 24 * 3600 * 1000,
): ReminderEligibility {
  if (cutoffMs === null || !Number.isFinite(cutoffMs)) return { ok: false, reason: "no_cutoff" };
  const hiredMs = hiredAtIso ? Date.parse(hiredAtIso) : NaN;
  if (!Number.isFinite(hiredMs)) return { ok: false, reason: "unknown_hire_date" };
  if (hiredMs < cutoffMs) return { ok: false, reason: "pre_cutoff" };
  if (nowMs - hiredMs > windowMs) return { ok: false, reason: "window_closed" };
  return { ok: true, reason: "eligible" };
}
