// Resend idempotency for the email rung (MP-ONBOARD-ANCHOR-PKG1, 2026-11-12). Pure: no env,
// no SDK, so idempotency.test.ts runs offline.
//
// A network error on the email rung is classified transient (retry.ts) and the drain posts the
// row again. If the first request timed out AFTER Resend accepted it, the retry would send a
// second, identical email. Resend keeps an Idempotency-Key for 24 hours and answers a repeat
// with the original response instead of sending again; a deferred or retried row always goes
// out inside that window (retries 5 and 15 minutes apart, the row expires at 72 hours but a
// key is only sent once Resend is actually asked). One key per parent row.
//
// resend@2.0.0's emails.send(payload, options) merges `options` into its fetch init, so a
// `headers` option REPLACES the client's headers. The key therefore goes on a copy of the
// client's own headers (Authorization included). When the client does not expose them, no
// option is passed at all: sending without the key is better than sending without auth.

export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** One key per next_step_messages parent row: every attempt for that row shares it. */
export function idempotencyKeyFor(parentId: string): string {
  return `next-step-dispatch:${String(parentId ?? "").trim()}:email`.slice(0, 256);
}

/** The send options carrying the key, or undefined when the client's headers are unusable. */
export function idempotentSendOptions(
  clientHeaders: unknown,
  key: string | null | undefined,
): { headers: Headers } | undefined {
  if (!key) return undefined;
  if (!(clientHeaders instanceof Headers)) return undefined;
  if (!clientHeaders.get("Authorization")) return undefined;
  const h = new Headers(clientHeaders);
  h.set(IDEMPOTENCY_HEADER, key);
  return { headers: h };
}
