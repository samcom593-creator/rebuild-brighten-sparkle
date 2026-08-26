import { describe, expect, it } from "vitest";
import { formatPhoenix, gapEmailState, inviteReceipt, onboardingBucketMeta, type OnboardingInvite } from "@/lib/onboardingCalls";

const inv = (over: Partial<OnboardingInvite>): OnboardingInvite => ({
  recipient: "milver.taca@gmail.com", kind: "request", status: "queued",
  sent_at: null, resend_message_id: null, last_error: null, attempt_count: 0, ...over,
});

describe("onboardingCalls helpers", () => {
  it("renders Phoenix time (no DST) regardless of the runner's zone", () => {
    // 2026-08-26T18:30Z = 11:30 AM Phoenix (UTC-7 year-round)
    expect(formatPhoenix("2026-08-26T18:30:00.000Z")).toBe("Wed, Aug 26, 11:30 AM");
    // 2026-01-15T18:30Z is still 11:30 AM Phoenix — Chicago would read 12:30 PM
    expect(formatPhoenix("2026-01-15T18:30:00.000Z")).toBe("Thu, Jan 15, 11:30 AM");
  });

  it("only a Resend message id counts as sent", () => {
    expect(inviteReceipt([inv({ status: "sent", resend_message_id: "re_123" })]).label).toMatch(/^Invite sent/);
    // status says sent but no receipt: reported as queued, never as delivered
    expect(inviteReceipt([inv({ status: "sent", resend_message_id: null })]).label).toMatch(/^Invite queued/);
    expect(inviteReceipt([inv({ status: "failed", last_error: "resend error: 422" })])).toEqual(
      expect.objectContaining({ label: "Invite failed · milver.taca@gmail.com", detail: "resend error: 422" }),
    );
    expect(inviteReceipt([]).label).toBe("No invite queued");
  });

  it("a delivered cancel outranks the original request", () => {
    const r = inviteReceipt([
      inv({ status: "sent", resend_message_id: "re_req" }),
      inv({ kind: "cancel", status: "sent", resend_message_id: "re_cancel" }),
    ]);
    expect(r.label).toBe("Cancel sent");
    expect(r.detail).toBe("re_cancel");
  });

  it("bucket meta covers every bucket with a semantic tone", () => {
    expect(onboardingBucketMeta("upcoming").tone).toBe("text-primary");
    expect(onboardingBucketMeta("overdue").tone).toBe("text-destructive");
    expect(onboardingBucketMeta("completed").tone).toBe("text-success");
    expect(onboardingBucketMeta("canceled").tone).toBe("text-muted-foreground");
  });

  it("gap email state offers Send only when nothing was queued", () => {
    const base = { agent_id: "a", display_name: "X", licensed_at: null, queue_id: null, booking_email_sent_at: null, booking_email_attempts: null, booking_email_last_error: null };
    expect(gapEmailState(base).canSend).toBe(true);
    expect(gapEmailState({ ...base, queue_id: "q" }).canSend).toBe(false);
    expect(gapEmailState({ ...base, queue_id: "q", booking_email_attempts: 5, booking_email_last_error: "profile email missing" }).label).toMatch(/dead/);
    expect(gapEmailState({ ...base, queue_id: "q", booking_email_sent_at: "2026-08-26T14:30:00Z" }).label).toMatch(/^Booking link sent/);
  });
});
