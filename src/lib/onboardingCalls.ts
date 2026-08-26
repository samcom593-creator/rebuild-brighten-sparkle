// Pure helpers for the Interviews page "Onboarding" tab (Lane 3, 2026-08-26).
// Kept out of the page so the labelling rules are unit-testable.

export type OnboardingInvite = {
  recipient: string;
  kind: "request" | "cancel";
  status: "queued" | "sent" | "failed" | "skipped";
  sent_at: string | null;
  resend_message_id: string | null;
  last_error: string | null;
  attempt_count: number;
};

export type OnboardingCall = {
  id: string;
  invitee_name: string | null;
  invitee_email: string | null;
  invitee_phone: string | null;
  scheduled_at: string;
  ended_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  outcome: string | null;
  reschedule_url: string | null;
  cancel_url: string | null;
  agent_id: string | null;
  agent_display_name: string | null;
  bucket: "upcoming" | "overdue" | "completed" | "canceled";
  invites: OnboardingInvite[];
};

export type OnboardingGap = {
  agent_id: string;
  display_name: string | null;
  licensed_at: string | null;
  queue_id: string | null;
  booking_email_sent_at: string | null;
  booking_email_attempts: number | null;
  booking_email_last_error: string | null;
};

export const PHOENIX_TZ = "America/Phoenix";

export function formatPhoenix(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PHOENIX_TZ, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

export function onboardingBucketMeta(bucket: OnboardingCall["bucket"]) {
  switch (bucket) {
    case "upcoming": return { label: "Upcoming", tone: "text-primary", dot: "bg-primary" };
    case "overdue": return { label: "Overdue", tone: "text-destructive", dot: "bg-destructive" };
    case "completed": return { label: "Completed", tone: "text-success", dot: "bg-success" };
    case "canceled": return { label: "Canceled", tone: "text-muted-foreground", dot: "bg-muted-foreground" };
  }
}

/**
 * The onboarding-team invite receipt for a booking, as one honest chip.
 * A Resend message id is the only thing that means "delivered to Resend";
 * everything else is reported as what it is.
 */
export function inviteReceipt(invites: OnboardingInvite[]): { label: string; tone: string; detail: string | null } {
  const requests = invites.filter((i) => i.kind === "request");
  const cancels = invites.filter((i) => i.kind === "cancel");
  if (cancels.some((i) => i.status === "sent")) {
    return { label: "Cancel sent", tone: "text-muted-foreground", detail: cancels.find((i) => i.status === "sent")?.resend_message_id ?? null };
  }
  if (requests.length === 0) return { label: "No invite queued", tone: "text-warning", detail: "no recipients configured or booking not ahead" };
  const sent = requests.filter((i) => i.status === "sent" && i.resend_message_id);
  if (sent.length === requests.length) {
    return { label: `Invite sent · ${sent.map((i) => i.recipient).join(", ")}`, tone: "text-success", detail: sent.map((i) => i.resend_message_id).join(", ") };
  }
  const failed = requests.find((i) => i.status === "failed");
  if (failed) return { label: `Invite failed · ${failed.recipient}`, tone: "text-destructive", detail: failed.last_error };
  const skipped = requests.find((i) => i.status === "skipped");
  if (skipped && requests.every((i) => i.status === "skipped")) {
    return { label: "Invite skipped", tone: "text-muted-foreground", detail: skipped.last_error };
  }
  const queued = requests.find((i) => i.status === "queued");
  return { label: `Invite queued · ${queued?.recipient ?? requests[0].recipient}`, tone: "text-warning", detail: queued?.last_error ?? "sends within 5 minutes" };
}

export function gapEmailState(gap: OnboardingGap): { label: string; tone: string; canSend: boolean } {
  if (gap.booking_email_sent_at) return { label: `Booking link sent ${formatPhoenix(gap.booking_email_sent_at)}`, tone: "text-success", canSend: false };
  if (gap.queue_id && (gap.booking_email_attempts ?? 0) >= 5) return { label: `Booking link dead · ${gap.booking_email_last_error ?? "5 attempts"}`, tone: "text-destructive", canSend: false };
  if (gap.queue_id) return { label: "Booking link queued · goes out at 9:30 AM Central", tone: "text-warning", canSend: false };
  return { label: "No booking link sent", tone: "text-muted-foreground", canSend: true };
}
