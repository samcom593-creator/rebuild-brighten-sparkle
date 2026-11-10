// WP6 onboarding-call reminders: copy, kinds and the send-time forward-only gate.
//
// Run: deno test supabase/functions/send-agent-onboarding-email/reminders.test.ts
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildOnboardingCallReminderEmail,
  FIELD_COURSE_URL,
  isReminderKind,
  REMINDER_KINDS,
  reminderEligibleAtSend,
} from "./reminders.ts";

const DAY = 24 * 3600 * 1000;
const CUTOFF = Date.parse("2026-11-10T21:10:01Z");

Deno.test("exactly three reminder kinds, one per step (the unique index caps a hire at 3)", () => {
  assertEquals([...REMINDER_KINDS], [
    "onboarding_call_reminder_d2",
    "onboarding_call_reminder_d5",
    "onboarding_call_reminder_d10",
  ]);
  assert(isReminderKind("onboarding_call_reminder_d5"));
  assertFalse(isReminderKind("onboarding_call"));
  assertFalse(isReminderKind("discord"));
});

Deno.test("every reminder carries the booking link, a first name only, and no staff name", () => {
  for (const kind of REMINDER_KINDS) {
    const e = buildOnboardingCallReminderEmail("Di Park", "https://calendly.com/d/abc-123", kind);
    assertStringIncludes(e.text, "https://calendly.com/d/abc-123");
    assertStringIncludes(e.html, 'href="https://calendly.com/d/abc-123"');
    assertStringIncludes(e.text, "Di");
    assertFalse(e.text.includes("Park"), "surname must not appear");
    assertFalse(/milver|aisha/i.test(e.text), "the call owner is an open Sam decision (N5/N7)");
    assert(e.subject.length > 0 && e.subject.length < 60);
  }
});

Deno.test("reminder HTML escapes the name", () => {
  const e = buildOnboardingCallReminderEmail("<b>x</b>", "https://calendly.com/d/x", "onboarding_call_reminder_d2");
  assertFalse(e.html.includes("<b>x</b>"));
  assertStringIncludes(e.html, "&lt;b&gt;x&lt;/b&gt;");
});

Deno.test("send-time gate: forward-only cutoff and 30-day window", () => {
  const now = CUTOFF + 5 * DAY;
  assertEquals(reminderEligibleAtSend(new Date(CUTOFF + DAY).toISOString(), CUTOFF, now).reason, "eligible");
  // Hired before the cutoff: never, whatever the sweep enqueued.
  assertEquals(reminderEligibleAtSend(new Date(CUTOFF - 1000).toISOString(), CUTOFF, now).reason, "pre_cutoff");
  // No cutoff configured means nobody, not everybody.
  assertEquals(reminderEligibleAtSend(new Date(CUTOFF + DAY).toISOString(), null, now).reason, "no_cutoff");
  assertEquals(reminderEligibleAtSend(null, CUTOFF, now).reason, "unknown_hire_date");
  // Past day 30: closed.
  assertEquals(reminderEligibleAtSend(new Date(CUTOFF + DAY).toISOString(), CUTOFF, CUTOFF + 32 * DAY).reason, "window_closed");
});

Deno.test("course email target is the required-course page, not the library", () => {
  assert(FIELD_COURSE_URL.endsWith("/dashboard/training/sales-course"));
});
