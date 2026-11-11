// MP-ONBOARD-ANCHOR-PKG1: a retried email rung reuses one Resend Idempotency-Key per row, and
// the key never costs the request its Authorization header.
// Run: deno test --no-check --allow-read supabase/functions/next-step-dispatch/idempotency.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { IDEMPOTENCY_HEADER, idempotencyKeyFor, idempotentSendOptions } from "./idempotency.ts";

const ROW = "4f6b1a2c-0000-4000-8000-000000000001";

Deno.test("one key per parent row, stable across attempts, within Resend's 256 characters", () => {
  assertEquals(idempotencyKeyFor(ROW), `next-step-dispatch:${ROW}:email`);
  assertEquals(idempotencyKeyFor(ROW), idempotencyKeyFor(` ${ROW} `));
  assert(idempotencyKeyFor("x".repeat(400)).length <= 256);
});

Deno.test("the key rides on a COPY of the client's headers, Authorization kept", () => {
  const client = new Headers({ Authorization: "Bearer re_test", "Content-Type": "application/json", "User-Agent": "resend-node:2.0.0" });
  const opts = idempotentSendOptions(client, idempotencyKeyFor(ROW));
  assert(opts);
  assertEquals(opts.headers.get(IDEMPOTENCY_HEADER), `next-step-dispatch:${ROW}:email`);
  assertEquals(opts.headers.get("Authorization"), "Bearer re_test");
  assertEquals(opts.headers.get("Content-Type"), "application/json");
  // the client's own headers are not mutated (every other send keeps no key)
  assertEquals(client.get(IDEMPOTENCY_HEADER), null);
});

Deno.test("no usable client headers: no option at all (never a request without auth)", () => {
  assertEquals(idempotentSendOptions(undefined, idempotencyKeyFor(ROW)), undefined);
  assertEquals(idempotentSendOptions({ Authorization: "Bearer x" }, idempotencyKeyFor(ROW)), undefined);
  assertEquals(idempotentSendOptions(new Headers({ "Content-Type": "application/json" }), idempotencyKeyFor(ROW)), undefined);
  assertEquals(idempotentSendOptions(new Headers({ Authorization: "Bearer x" }), null), undefined);
});
