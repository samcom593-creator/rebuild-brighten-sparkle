// send-sms-auto-detect consent gate. Pure, so consent.test.ts drives the exact
// decision index.ts acts on.
//
// WP4 (2026-11-10 onboarding audit, FRONTDOOR-9). Consent was enforced only for
// signed-in staff callers who passed an applicationId; every service caller
// (submit-application's welcome text, next-step-dispatch, the licensing drips,
// numbers-reminder, ...) skipped it. Measured over 120 days: 52 texts recorded
// "sent" to applicants whose application says sms_consent_given = false, and in
// the 30 days to 2026-11-10, 36 more to 4 such phones. One gate here covers
// every caller, including any added later.
//
// The answer comes from public.fn_sms_consent_for_phone (one SQL definition):
//   application_id     -> that application's sms_consent_given
//   operator_self      -> an admin's own phone (system alerts to the operator)
//   application_phone  -> the latest application with the same 10 digits
//   no_consent_record  -> nothing on file: not allowed
// Fails CLOSED: a lookup error sends nothing. SMS is never the only channel a
// caller has (every caller falls back on outcome "skipped"), so a DB blip costs
// one best-effort text, while sending without consent is a TCPA exposure.
//
// Contract with callers (MP-270 / MP-336): outcome stays inside
// {sent, skipped, failed}. A refusal here is outcome "skipped" with
// reason "skipped_no_consent", the same shape as reason
// "carrier_gateway_retired", so callers that fall back on "skipped"
// (license-milestone-sms-drain, numbers-reminder, monday-starter-reminders)
// keep falling back instead of booking a failure.

export const SKIPPED_NO_CONSENT = "skipped_no_consent";

export type ConsentDecision =
  | { send: true; source: string }
  | { send: false; reason: typeof SKIPPED_NO_CONSENT; source: string | null; detail: string };

export function consentDecision(data: unknown, error: { message?: string } | null | undefined): ConsentDecision {
  if (error) {
    return {
      send: false, reason: SKIPPED_NO_CONSENT, source: null,
      detail: `consent lookup failed (${String(error.message ?? "unknown").slice(0, 120)}); not sending without proof of consent`,
    };
  }
  const d = (data ?? {}) as { allowed?: unknown; source?: unknown };
  const source = typeof d.source === "string" ? d.source : null;
  if (d.allowed === true) return { send: true, source: source ?? "unknown" };
  const detail = source === "application_id" || source === "application_phone"
    ? "the applicant did not give SMS consent"
    : source === "no_phone"
      ? "no usable phone number"
      : "no SMS consent on file for this number";
  return { send: false, reason: SKIPPED_NO_CONSENT, source, detail };
}
