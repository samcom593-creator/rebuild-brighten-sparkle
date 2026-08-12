// Admission control for the public contracting intake.
//
// Pure functions, no Deno globals, so the edge function and the vitest suite
// share ONE implementation. These decisions are the entire security boundary of
// an unauthenticated write endpoint, which makes them exactly the code that
// must be tested rather than eyeballed.

/** The complete accepted field set. Everything else in a body is discarded. */
export const ACCEPTED_FIELDS = ["first_name", "last_name", "email", "phone", "npn"] as const;
export type AcceptedField = (typeof ACCEPTED_FIELDS)[number];

/**
 * Fields this intake must never collect.
 *
 * Asserted rather than assumed: the failure mode is somebody adding "just one
 * more field" to a public form and APEX quietly becoming the custodian of
 * social security numbers.
 */
export const FORBIDDEN_FIELDS = [
  "pa_number", "panumber", "ssn", "social_security_number",
  "dob", "date_of_birth", "password", "routing_number",
  "account_number", "bank_account", "medical", "document", "file",
] as const;

/**
 * Copy only the five accepted fields, truncated.
 *
 * An allowlist, never a denylist: a denylist has to predict every name an
 * attacker might send, and it only takes one it did not predict.
 */
export function pickAcceptedFields(body: Record<string, unknown>): Record<AcceptedField, string> {
  const out = {} as Record<AcceptedField, string>;
  for (const field of ACCEPTED_FIELDS) {
    const value = body?.[field];
    out[field] = typeof value === "string" ? value.slice(0, 300) : "";
  }
  return out;
}

/** True when the hidden field carries anything at all. */
export function isHoneypotTripped(body: Record<string, unknown>): boolean {
  const value = body?.company_website;
  return typeof value === "string" && value.trim() !== "";
}

export type RateVerdict = "allow" | "reject_rate_limited" | "reject_unavailable";

/**
 * Decide admission from the rate limiter's answer.
 *
 * FAILS CLOSED. The shared rateLimit helper logs and allows when the limiter
 * errors, which is a defensible default for an authenticated endpoint and the
 * wrong one here: whatever breaks the limiter is precisely when someone is
 * hammering it, and "allow everything while the brake is broken" turns a public
 * form into a spam sink. NPN dedupe does not save us either — an attacker picks
 * a fresh NPN per request.
 */
export function rateLimitVerdict(result: { allowed: unknown; error: unknown }): RateVerdict {
  if (result.error) return "reject_unavailable";
  if (result.allowed === false) return "reject_rate_limited";
  return "allow";
}

/**
 * The body returned when the honeypot trips.
 *
 * Deliberately NOT `status: "accepted"`. Nothing was accepted — there is no
 * intake row, no id and no queued work — and a client that believes the word
 * shows a producer a success screen and an AgentLink continuation for a
 * submission that does not exist. That is fake success aimed at ourselves.
 * `discarded` with a null id is literally true, and it is opaque to a bot,
 * which learns nothing it could not learn from any other 2xx.
 */
export function honeypotResponseBody(): Record<string, unknown> {
  return { ok: true, intake_id: null, status: "discarded", delivery: "none" };
}
