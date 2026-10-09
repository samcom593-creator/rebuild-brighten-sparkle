// The stalled-applicant follow-up that system-health-check mails through
// send-notification. send-notification treats a service caller's `message` as
// trusted HTML (other service callers send a deliberate magic-login anchor), so
// escaping is this caller's job: first_name is whatever the applicant typed on
// /apply. The send is email only (no userId), so there is no SMS or push copy
// for an entity to show up in.
import { escapeHtml } from "../_shared/notify-caller-policy.ts";

export function stalledFollowUpMessage(firstName: unknown): string {
  const name = typeof firstName === "string" ? firstName.trim() : "";
  return `Hey ${name ? escapeHtml(name) : "there"}, we noticed you applied but haven't heard back. Are you still interested in getting licensed? Reply to this email or call us.`;
}
