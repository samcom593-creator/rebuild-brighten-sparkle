/**
 * MP-366 — session expiry decided against a clock the device owns.
 *
 * Edwin Ac-lumor: "it keeps logging me out."
 *
 * MEASURED, from Supabase auth logs for his IP on 2026-09-02 between 18:51 and
 * 19:57: 135 successful POST /token calls, 10 refused with "429: Request rate
 * limit reached". His six sessions that evening each burned 10-37 refresh-token
 * rotations and died 1.7 to 15 seconds after being created. Six of the six
 * sessions in the last 30 days that rotated 5+ tokens and died inside five
 * minutes are his; nobody else on the platform does this. Every rotation
 * returned 200 — the server was perfectly happy with each token it was handed.
 * Only the browser believed the session was expiring.
 *
 * WHAT DECIDES THAT. useGlobalSessionRefresh computed
 *
 *     secondsLeft = session.expires_at - Date.now()/1000
 *
 * `expires_at` is stamped by the server; `Date.now()` is whatever the device
 * says. A device running far enough ahead makes a freshly-issued one-hour token
 * look like it expires inside the 15-minute window, so the refresh fires
 * immediately — and on success it invalidated EVERY query, which re-fires the
 * 70-90 request first-paint burst MP-361 documented, each of which asks
 * supabase-js for a token, which compares the same expiry against the same
 * skewed clock. A loop with no floor, ending at Supabase's rate limiter, after
 * which the session cannot be refreshed at all and the user is returned to the
 * login page with no explanation.
 *
 * THE MISTAKE THIS FILE ALMOST SHIPPED. The first cut measured skew as
 * `now - iat` at any moment it was asked. That is not the clock error — it is
 * the clock error PLUS the age of the token. On a correct machine holding a
 * 40-minute-old token it reads 2400 seconds, so the tolerance below would have
 * fired for every user on the platform continuously, and the banner would have
 * told the whole company their clock was wrong. Its own test caught it by
 * disagreeing about a single second.
 *
 * The fix is that skew can only be measured at the INSTANT a token is issued,
 * when elapsed-since-issue is bounded by the round trip. So it is recorded from
 * the auth events that carry a fresh token, stored, and reused — never
 * recomputed from a token of unknown age.
 */

/** Beyond this the device clock cannot be trusted to age a token. */
export const SKEW_TOLERANCE_SECONDS = 120;

/** A refresh storm: this many token refreshes inside the window below. */
export const STORM_THRESHOLD = 5;
export const STORM_WINDOW_MS = 60_000;

/**
 * `iat` out of a JWT, in epoch seconds. Payload only — this reads a claim the
 * server wrote, it does not and must not verify anything.
 */
export function readIssuedAt(accessToken: string | null | undefined): number | null {
  if (!accessToken) return null;
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { iat?: unknown };
    return typeof claims.iat === "number" && Number.isFinite(claims.iat) ? claims.iat : null;
  } catch {
    // empty-catch-allow:untrusted-token-shape — a token we cannot parse yields
    // "unknown skew", which is the same safe answer as no token at all.
    return null;
  }
}

let measuredSkew: number | null = null;

/**
 * Record the device's clock error from a token that has JUST been issued.
 *
 * ONLY call this for TOKEN_REFRESHED. SIGNED_IN may replay an old session
 * on tab focus and does not prove token freshness. Called against a stored session of unknown age it would
 * report that age as clock error — the mistake described in the header.
 *
 * Positive means the device runs ahead, which is the direction that makes a
 * live token look expired.
 */
export function recordIssuedToken(accessToken: string | null | undefined, nowMs: number): void {
  const iat = readIssuedAt(accessToken);
  if (iat === null) return;
  measuredSkew = Math.round(nowMs / 1000 - iat);
}

/** The device's clock error in seconds, or null until a fresh token proves it. */
export function measuredSkewSeconds(): number | null {
  return measuredSkew;
}

export function isClockSkewed(skewSeconds: number | null): boolean {
  return skewSeconds !== null && Math.abs(skewSeconds) > SKEW_TOLERANCE_SECONDS;
}

/**
 * Seconds until the session expires, corrected by the measured skew.
 *
 * When the skew is not yet known this falls back to the device clock — the
 * arithmetic that caused the incident. That is deliberate and safe here only
 * because the caller now holds a one-attempt-per-minute floor: an unmeasured
 * bad clock costs one wasted refresh, and that refresh is itself the event
 * that measures the skew, after which this returns the truth. The fallback
 * cannot loop.
 */
export function secondsUntilExpiry(
  expiresAt: number | null | undefined,
  nowMs: number,
): number | null {
  if (!expiresAt) return null;
  const serverNow = nowMs / 1000 - (measuredSkew ?? 0);
  return Math.round(expiresAt - serverNow);
}

/**
 * A rolling count of token refreshes, so the app can notice it is in the loop
 * described above. Module scope on purpose: the point is to survive the
 * component remounts that were part of the storm.
 */
const refreshTimestamps: number[] = [];

export function recordTokenRefresh(nowMs: number): void {
  refreshTimestamps.push(nowMs);
  while (refreshTimestamps.length > 0 && nowMs - refreshTimestamps[0] > STORM_WINDOW_MS) {
    refreshTimestamps.shift();
  }
}

export function refreshesInWindow(nowMs: number): number {
  return refreshTimestamps.filter((t) => nowMs - t <= STORM_WINDOW_MS).length;
}

/**
 * A healthy client refreshes about once an hour: the busiest legitimate session
 * measured over 30 days rotated 64 tokens across 3.5 days, one per 79 minutes.
 * Edwin's rotated 37 in 15 seconds. Any threshold between those is safe, and
 * this one sits four orders of magnitude clear of normal use.
 */
export function isRefreshStorm(nowMs: number): boolean {
  return refreshesInWindow(nowMs) >= STORM_THRESHOLD;
}

/** Test seam. Never called by the app. */
export function __resetSessionClock(): void {
  refreshTimestamps.length = 0;
  measuredSkew = null;
}

export type SessionFault =
  | { kind: "clock"; skewSeconds: number }
  | { kind: "storm"; refreshes: number }
  | null;

/**
 * What to tell the user. The clock reading wins over the storm, because it is
 * the cause and the storm is the symptom — and unlike the storm, it names
 * something the person can go and fix.
 */
export function describeSessionFault(nowMs: number): SessionFault {
  const skew = measuredSkewSeconds();
  if (isClockSkewed(skew)) return { kind: "clock", skewSeconds: skew as number };
  if (isRefreshStorm(nowMs)) return { kind: "storm", refreshes: refreshesInWindow(nowMs) };
  return null;
}

/** "47 minutes ahead" / "3 minutes behind" — for a sentence, not a log line. */
export function describeSkew(skewSeconds: number): string {
  const magnitude = Math.abs(skewSeconds);
  const direction = skewSeconds > 0 ? "ahead of" : "behind";
  if (magnitude < 90) return `${magnitude} seconds ${direction} real time`;
  const minutes = Math.round(magnitude / 60);
  if (minutes < 90) return `${minutes} minutes ${direction} real time`;
  const hours = Math.round(magnitude / 360) / 10;
  return `${hours} hours ${direction} real time`;
}

/** Recovered SIGNED_IN sessions must never be mistaken for newly issued tokens. */
export function recordSessionAuthEvent(event: string, accessToken: string | null | undefined, nowMs: number): void {
  if (event !== "TOKEN_REFRESHED") return;
  recordIssuedToken(accessToken, nowMs);
  recordTokenRefresh(nowMs);
}
