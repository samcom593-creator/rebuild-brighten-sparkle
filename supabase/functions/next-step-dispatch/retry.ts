// next-step-dispatch retry policy (MP-ONBOARD-ANCHOR-PKG1, 2026-11-12). Pure: no env, no SDK.
//
// F3 in message_map_and_copy.md: a transient provider error stamped failed_at, no cron drained
// the queue, and the dedupe key blocked re-queueing, so the message was lost for good. On
// 2026-11-11 four rows died on Resend's "Too many requests. You can only make 10 requests per
// second" and the reactivation runner recorded success. Rule now:
//   - transient (HTTP 429 rate limit, HTTP 5xx, network failure, our own gate unreachable):
//     the row stays retryable (sent_at and failed_at null) with metadata.not_before, and the
//     drain fn_next_step_retry_drain (pg_cron, every 5 min) posts it back here;
//   - permanent (suppressed, invalid address, quota, validation): failed_at with the reason;
//   - at most MAX_ATTEMPTS transient attempts, then failed_at "gave up after N attempts".

export const MAX_ATTEMPTS = 3;
/** Minutes to wait after transient attempt 1 and 2 (attempt 3 gives up): 20 minutes end to end. */
export const BACKOFF_MINUTES: readonly number[] = [5, 15];

export interface ProviderErrorShape {
  name?: string | null;
  message?: string | null;
  statusCode?: number | null;
}

/** An email send that did not produce a provider receipt. Carries what the provider said. */
export class EmailSendError extends Error {
  readonly providerName: string | null;
  readonly statusCode: number | null;
  readonly forcedTransient: boolean | null;
  constructor(message: string, opts: { name?: string | null; statusCode?: number | null; transient?: boolean } = {}) {
    super(message);
    this.name = "EmailSendError";
    this.providerName = opts.name ?? null;
    this.statusCode = typeof opts.statusCode === "number" ? opts.statusCode : null;
    this.forcedTransient = typeof opts.transient === "boolean" ? opts.transient : null;
  }
}

const PERMANENT_NAMES = new Set([
  "suppressed_recipient", "non_routable_recipient", "validation_error", "missing_required_field",
  "invalid_from_address", "invalid_to_address", "invalid_attachment", "invalid_api_key", "restricted_api_key",
  "missing_api_key", "not_found", "method_not_allowed", "daily_quota_exceeded", "monthly_quota_exceeded",
  "invalid_idempotency_key", "invalid_parameter", "no_receipt",
]);
const TRANSIENT_NAMES = new Set([
  "rate_limit_exceeded", "internal_server_error", "application_error", "concurrent_idempotent_requests",
  "network_error", "send_gate_unavailable",
]);
const TRANSIENT_TEXT =
  /too many requests|rate limit|timed? ?out|timeout|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|network|fetch failed|temporar|service unavailable|bad gateway|gateway time|\b50[0234]\b/i;
const QUOTA_TEXT = /quota/i;

export interface Classified {
  transient: boolean;
  message: string;
}

export function classifyEmailError(e: unknown): Classified {
  const err = (e ?? {}) as EmailSendError & ProviderErrorShape;
  const message = String(err?.message ?? e ?? "unknown error").slice(0, 300);
  const name = String((err as EmailSendError).providerName ?? err?.name ?? "").toLowerCase();
  const status = typeof (err as EmailSendError).statusCode === "number"
    ? (err as EmailSendError).statusCode
    : null;
  if (e instanceof EmailSendError && e.forcedTransient !== null) return { transient: e.forcedTransient, message };
  if (PERMANENT_NAMES.has(name)) return { transient: false, message };
  if (QUOTA_TEXT.test(message) || /quota/.test(name)) return { transient: false, message };
  if (TRANSIENT_NAMES.has(name)) return { transient: true, message };
  if (status !== null && (status === 429 || status >= 500)) return { transient: true, message };
  if (status !== null && status >= 400) return { transient: false, message };
  return { transient: TRANSIENT_TEXT.test(message), message };
}

export interface RetryPlan {
  giveUp: boolean;
  attempts: number;
  notBefore: string | null;
}

/** attemptsSoFar = transient attempts already recorded on the row (0 on the first failure). */
export function planRetry(attemptsSoFar: number, now: Date = new Date()): RetryPlan {
  const attempts = Math.max(0, Math.floor(Number(attemptsSoFar) || 0)) + 1;
  if (attempts >= MAX_ATTEMPTS) return { giveUp: true, attempts, notBefore: null };
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
  return { giveUp: false, attempts, notBefore: new Date(now.getTime() + minutes * 60_000).toISOString() };
}
