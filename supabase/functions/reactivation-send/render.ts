// render.ts: pure helpers for reactivation-send. No env, no network, no remote imports,
// so render.test.ts runs under `deno test --no-check --allow-read` with nothing else granted.

export type Track = "cold" | "pending" | "licensed" | "in_course" | "course_done";
export type Touch = 1 | 2 | 3;
export type Variant = "a" | "b";

// One stage row per (track, touch, subject variant). The variant is the A/B subject line;
// bodies are identical across a/b so the test isolates the subject.
const STAGE_KEY = /^reactivation_v2_(cold|pending|licensed|in_course|course_done)_t([123])_([ab])$/;

export function parseStageKey(stageKey: string): { track: Track; touch: Touch; variant: Variant } | null {
  const m = STAGE_KEY.exec(stageKey);
  if (!m) return null;
  return { track: m[1] as Track, touch: Number(m[2]) as Touch, variant: m[3] as Variant };
}

export interface BookingLinks { questions: string | null; licensing: string; licensed: string }

// cold = never bought the course -> the 10-minute questions call (no purchase needed).
// in_course / course_done bought it -> the licensing call. pending / licensed -> the licensed call.
export function bookingBaseFor(track: Track, links: BookingLinks): string | null {
  switch (track) {
    case "cold": return links.questions;
    case "in_course":
    case "course_done": return links.licensing;
    case "pending":
    case "licensed": return links.licensed;
  }
}

/**
 * Applicant-typed names arrive as "JOHN", "john" or "John". A subject line that opens with an
 * all-caps name reads as shouting and an all-lowercase one reads as careless, so normalize only
 * those two shapes. Mixed case ("DeShawn", "McKenzie") is the person's own spelling: keep it.
 */
export function normalizeName(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (!letters) return s;
  const allUpper = letters === letters.toUpperCase();
  const allLower = letters === letters.toLowerCase();
  if (!allUpper && !allLower) return s;
  return s.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_m: string, sep: string, c: string) => sep + c.toUpperCase());
}

/**
 * Subjects that open with "{{first_name}}, " must not render as "there, still looking...".
 * With no usable first name, drop the vocative and capitalize what follows.
 */
export function subjectTemplateFor(tpl: string, hasFirstName: boolean): string {
  if (hasFirstName) return tpl;
  const m = /^\s*\{\{\s*first_name\s*\}\}\s*,\s*(.)(.*)$/s.exec(tpl);
  if (!m) return tpl;
  return m[1].toUpperCase() + m[2];
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Fills {{key}} tokens. Every token must have a value: a missing key is reported, never
 * rendered as blank. "html" escapes values; "plain" (subjects) also collapses to one line;
 * "text" (the plain-text body) keeps line breaks and does not escape.
 */
export function renderTemplate(
  tpl: string,
  vars: Record<string, string>,
  mode: "html" | "plain" | "text",
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m: string, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      missing.push(key);
      return "";
    }
    return mode === "html" ? escapeHtml(vars[key]) : vars[key];
  });
  return { text: mode === "plain" ? oneLine(text) : text.trim(), missing };
}

/**
 * Classifies a provider refusal for the receipt. Rate limits, timeouts and 5xx are worth a
 * retry; anything else (suppressed, invalid address, validation) is not.
 */
export function isRetryable(message: string): boolean {
  return /too many requests|rate limit|429|timeout|timed out|5\d\d|internal server|service unavailable|econnreset|network/i.test(message);
}

/**
 * Who a provider refusal is about (review SF-1/DS-1, 2026-11-12).
 *   person  - this address can never be mailed (suppressed, non-routable, a malformed `to`): stop this person.
 *   account - the key, quota, sender, rate or provider: never this person's fault. The receipt trigger releases
 *             the claim untouched and opens the campaign breaker, instead of stopping one innocent person per
 *             tick until the cohort is gone (a monthly-quota refusal used to read as a permanent per-person stop).
 *   unknown - no answer we can trust (the SDK threw, or "success" without an id): the email may be out, so the
 *             person is HELD and never resent blind.
 * Keyed on the error NAME (resend@2.0.0 forwards the API's `name`), with the message only to tell a bad `to`
 * apart from the account-level validation errors that share its name.
 */
export type FailureScope = "person" | "account" | "unknown";
export interface ProviderFailure {
  scope: FailureScope;
  retryable: boolean;
  reason: string;
}

const PERSON_NAMES = new Set(["suppressed_recipient", "non_routable_recipient"]);
const TO_FIELD_NAMES = new Set(["validation_error", "invalid_parameter", "missing_required_field"]);

export function classifyProviderError(err: { name?: unknown; message?: unknown } | null | undefined): ProviderFailure {
  const name = String(err?.name ?? "").trim();
  const message = String(err?.message ?? "").trim();
  const reason = `${name || "provider_error"}: ${message || "no message"}`.slice(0, 480);
  if (!err || (!name && !message)) {
    return { scope: "unknown", retryable: false, reason: "provider returned neither an id nor an error" };
  }
  if (PERSON_NAMES.has(name)) return { scope: "person", retryable: false, reason };
  if (TO_FIELD_NAMES.has(name) && /`to`|\bto field\b|\brecipient/i.test(message) &&
      !/domain|`from`|\bfrom field\b|api key|testing emails|verify/i.test(message)) {
    return { scope: "person", retryable: false, reason };
  }
  const transient = name === "rate_limit_exceeded" || name === "application_error" || name === "internal_server_error" ||
    isRetryable(message);
  return { scope: "account", retryable: transient && !/quota/i.test(name + " " + message), reason };
}
