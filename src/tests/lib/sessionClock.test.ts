/**
 * MP-366 — the arithmetic that decides whether a session is expiring.
 *
 * The bug being locked out: `expires_at - Date.now()/1000` asks a clock the
 * DEVICE owns how old a token the SERVER stamped is. On one agent's Mac that
 * produced 135 POST /token calls in 55 minutes and a rate-limited logout.
 *
 * The second bug being locked out is one this file's own first draft shipped
 * into review: measuring skew as `now - iat` whenever asked reads the token's
 * AGE as clock error, so a correct machine holding a 40-minute-old token looks
 * 40 minutes wrong. That one is guarded explicitly below, because it would have
 * told every user on the platform their clock was broken.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  SKEW_TOLERANCE_SECONDS, STORM_THRESHOLD,
  __resetSessionClock, describeSessionFault, describeSkew, isClockSkewed,
  isRefreshStorm, measuredSkewSeconds, readIssuedAt, recordIssuedToken,
  recordTokenRefresh, secondsUntilExpiry,
} from "@/lib/sessionClock";

/** A JWT with only the claim under test. Signature is never checked. */
function tokenIssuedAt(iat: number): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iat, sub: "agent" })}.sig`;
}

const HOUR = 3600;
const IAT = 1_756_800_000;

beforeEach(__resetSessionClock);

describe("readIssuedAt", () => {
  it("reads the server's iat out of a real-shaped token", () => {
    expect(readIssuedAt(tokenIssuedAt(IAT))).toBe(IAT);
  });

  it("returns null for anything it cannot parse, rather than guessing", () => {
    for (const bad of [null, undefined, "", "not-a-jwt", "a.b", "a.!!!.c"]) {
      expect(readIssuedAt(bad)).toBeNull();
    }
  });
});

describe("skew is measured at issue, never re-derived from an old token", () => {
  it("reads a device running ahead as positive", () => {
    recordIssuedToken(tokenIssuedAt(IAT), (IAT + HOUR) * 1000);
    expect(measuredSkewSeconds()).toBe(HOUR);
    expect(isClockSkewed(measuredSkewSeconds())).toBe(true);
  });

  it("reads a device running behind as negative", () => {
    recordIssuedToken(tokenIssuedAt(IAT), (IAT - 900) * 1000);
    expect(measuredSkewSeconds()).toBe(-900);
    expect(isClockSkewed(measuredSkewSeconds())).toBe(true);
  });

  it("treats ordinary request latency as no skew at all", () => {
    recordIssuedToken(tokenIssuedAt(IAT), (IAT + 2) * 1000);
    expect(isClockSkewed(measuredSkewSeconds())).toBe(false);
    expect(isClockSkewed(SKEW_TOLERANCE_SECONDS)).toBe(false);
    expect(isClockSkewed(SKEW_TOLERANCE_SECONDS + 1)).toBe(true);
  });

  it("THE DRAFT BUG: a correct clock holding an OLD token is not a skewed clock", () => {
    // Token issued 40 minutes ago, device clock perfect. The rejected design
    // computed now - iat on demand and would report 2400s of error here, firing
    // the banner for every signed-in user on the platform.
    const fortyMinutesLater = (IAT + 40 * 60) * 1000;
    recordIssuedToken(tokenIssuedAt(IAT), (IAT + 1) * 1000); // measured AT ISSUE
    expect(measuredSkewSeconds()).toBe(1);
    expect(isClockSkewed(measuredSkewSeconds())).toBe(false);
    expect(describeSessionFault(fortyMinutesLater)).toBeNull();
  });

  it("an unmeasurable token leaves the previous reading alone", () => {
    recordIssuedToken(tokenIssuedAt(IAT), (IAT + 300) * 1000);
    recordIssuedToken("not-a-jwt", Date.now());
    expect(measuredSkewSeconds()).toBe(300);
  });

  it("starts out unknown rather than assuming zero", () => {
    expect(measuredSkewSeconds()).toBeNull();
    expect(isClockSkewed(null)).toBe(false);
  });
});

describe("secondsUntilExpiry", () => {
  const expiresAt = IAT + HOUR;

  it("agrees with the naive arithmetic when the clock is right", () => {
    recordIssuedToken(tokenIssuedAt(IAT), IAT * 1000);
    const nowMs = (IAT + 60) * 1000;
    expect(secondsUntilExpiry(expiresAt, nowMs)).toBe(HOUR - 60);
    expect(expiresAt - Math.floor(nowMs / 1000)).toBe(HOUR - 60);
  });

  it("THE INCIDENT: a device an hour ahead reads a fresh token as expired; corrected it does not", () => {
    // The server issued this token at IAT. This device thinks it is an hour later.
    recordIssuedToken(tokenIssuedAt(IAT), (IAT + HOUR) * 1000);
    const nowMs = (IAT + HOUR + 60) * 1000; // one minute of real time has passed

    // What the old line computed — at or past expiry on a one-minute-old token,
    // every single time it was evaluated, which is why it refreshed every time.
    expect(expiresAt - Math.floor(nowMs / 1000)).toBeLessThanOrEqual(0);

    // What the corrected one computes: 59 minutes of real life left.
    expect(secondsUntilExpiry(expiresAt, nowMs)).toBe(HOUR - 60);
  });

  it("ages normally once the skew is known", () => {
    recordIssuedToken(tokenIssuedAt(IAT), (IAT + HOUR) * 1000);
    expect(secondsUntilExpiry(expiresAt, (IAT + HOUR + 50 * 60) * 1000)).toBe(10 * 60);
  });

  it("has nothing to say about a session with no expiry", () => {
    expect(secondsUntilExpiry(null, Date.now())).toBeNull();
    expect(secondsUntilExpiry(undefined, Date.now())).toBeNull();
  });
});

describe("refresh storm", () => {
  it("does not call an hourly refresh a storm", () => {
    let t = 1_000_000;
    for (let i = 0; i < 10; i++) { recordTokenRefresh(t); t += HOUR * 1000; }
    expect(isRefreshStorm(t)).toBe(false);
  });

  it("catches the measured shape: many refreshes inside seconds", () => {
    const t = 1_000_000;
    // 37 rotations in 15 seconds is what the auth log actually recorded.
    for (let i = 0; i < 37; i++) recordTokenRefresh(t + i * 400);
    expect(isRefreshStorm(t + 15_000)).toBe(true);
  });

  it("forgets a storm once the window has passed, so it cannot stick on", () => {
    const t = 1_000_000;
    for (let i = 0; i < STORM_THRESHOLD; i++) recordTokenRefresh(t + i);
    expect(isRefreshStorm(t + 1_000)).toBe(true);
    expect(isRefreshStorm(t + 120_000)).toBe(false);
  });
});

describe("describeSessionFault", () => {
  it("says nothing when the clock is right and refreshes are normal", () => {
    recordIssuedToken(tokenIssuedAt(IAT), (IAT + 1) * 1000);
    expect(describeSessionFault((IAT + 1) * 1000)).toBeNull();
  });

  it("names the clock ahead of the storm, because it is the cause and it is fixable", () => {
    const nowMs = (IAT + HOUR) * 1000;
    recordIssuedToken(tokenIssuedAt(IAT), nowMs);
    for (let i = 0; i < 10; i++) recordTokenRefresh(nowMs + i);
    expect(describeSessionFault(nowMs)).toEqual({ kind: "clock", skewSeconds: HOUR });
  });

  it("falls back to the storm when the clock is fine", () => {
    const nowMs = (IAT + 1) * 1000;
    recordIssuedToken(tokenIssuedAt(IAT), nowMs);
    for (let i = 0; i < STORM_THRESHOLD; i++) recordTokenRefresh(nowMs + i);
    expect(describeSessionFault(nowMs)).toEqual({
      kind: "storm", refreshes: STORM_THRESHOLD,
    });
  });
});

describe("describeSkew", () => {
  it("reads as a sentence in both directions", () => {
    expect(describeSkew(45)).toBe("45 seconds ahead of real time");
    expect(describeSkew(-2_820)).toBe("47 minutes behind real time");
    expect(describeSkew(HOUR * 3)).toBe("3 hours ahead of real time");
  });
});
