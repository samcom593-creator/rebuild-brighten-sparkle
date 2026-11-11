// MP-ONBOARD-ANCHOR-PKG1 (message_map F3): transient provider errors leave the row
// retryable; permanent ones fail honestly; at most 3 attempts.
// Run: deno test --no-check supabase/functions/next-step-dispatch/retry.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BACKOFF_MINUTES, classifyEmailError, EmailSendError, MAX_ATTEMPTS, planRetry } from "./retry.ts";

Deno.test("the 2026-11-11 rate-limit failure is transient", () => {
  const live = new EmailSendError("Too many requests. You can only make 10 requests per second. See rate limit response headers for more information. Or contact support to increase rate limit.", { name: "rate_limit_exceeded", statusCode: 429 });
  assertEquals(classifyEmailError(live).transient, true);
  // the bare Resend error object shape is classified the same way
  assertEquals(classifyEmailError({ name: "rate_limit_exceeded", message: "Too many requests", statusCode: 429 }).transient, true);
  assertEquals(classifyEmailError(new Error("Too many requests")).transient, true);
});

Deno.test("5xx and network failures are transient", () => {
  assertEquals(classifyEmailError({ name: "internal_server_error", message: "x", statusCode: 500 }).transient, true);
  assertEquals(classifyEmailError(new EmailSendError("upstream", { statusCode: 503 })).transient, true);
  assertEquals(classifyEmailError(new TypeError("fetch failed")).transient, true);
  assertEquals(classifyEmailError(new Error("connection timed out")).transient, true);
  assertEquals(classifyEmailError(new EmailSendError("gate", { name: "send_gate_unavailable" })).transient, true);
});

Deno.test("suppression, bad address, quota and validation are permanent", () => {
  assertEquals(classifyEmailError({ name: "suppressed_recipient", message: "recipient is on Resend's suppression list" }).transient, false);
  assertEquals(classifyEmailError({ name: "non_routable_recipient", message: "x" }).transient, false);
  assertEquals(classifyEmailError({ name: "validation_error", message: "Invalid `to` field", statusCode: 422 }).transient, false);
  assertEquals(classifyEmailError({ name: "daily_quota_exceeded", message: "You have reached your daily email sending quota", statusCode: 429 }).transient, false);
  assertEquals(classifyEmailError({ name: "monthly_quota_exceeded", message: "quota", statusCode: 429 }).transient, false);
  assertEquals(classifyEmailError(new EmailSendError("accepted without an id", { name: "no_receipt" })).transient, false);
  assertEquals(classifyEmailError(new Error("something odd")).transient, false);
});

Deno.test("planRetry: 5 then 15 minutes, gives up on the third transient attempt", () => {
  const now = new Date("2026-11-12T15:00:00Z");
  assertEquals(MAX_ATTEMPTS, 3);
  assertEquals([...BACKOFF_MINUTES], [5, 15]);
  const first = planRetry(0, now);
  assertEquals(first, { giveUp: false, attempts: 1, notBefore: "2026-11-12T15:05:00.000Z" });
  const second = planRetry(1, now);
  assertEquals(second, { giveUp: false, attempts: 2, notBefore: "2026-11-12T15:15:00.000Z" });
  const third = planRetry(2, now);
  assertEquals(third.giveUp, true);
  assertEquals(third.attempts, 3);
  assert(planRetry(Number.NaN, now).attempts === 1);
});
