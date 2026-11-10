// WP4: a carrier-gateway SMS is best effort and must not end the ladder; only a
// provider SID does. Run: deno test --no-check supabase/functions/next-step-dispatch/ladder.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isTerminalSmsReceipt, runLadder } from "./ladder.ts";

function spy<T>(value: T | Error) {
  const calls = { n: 0 };
  const fn = () => {
    calls.n++;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };
  return { fn, calls };
}

Deno.test("gateway SMS is best effort: the email rung still runs", async () => {
  const sms = spy("gateway:uscellular");
  const email = spy("re_123");
  const r = await runLadder({ telegram: null, sms: sms.fn, email: email.fn });
  assertEquals(sms.calls.n, 1);
  assertEquals(email.calls.n, 1, "email rung must run after a gateway receipt");
  assertEquals(r.smsBestEffort, true);
  assertEquals(r.terminal, "email");
  assertEquals(r.emailRung, "sent");
  assertEquals(r.emailId, "re_123");
  assert(r.anySent);
});

Deno.test("twilio SID is terminal: no email", async () => {
  const sms = spy("twilio:SM0123456789abcdef");
  const email = spy("re_123");
  const r = await runLadder({ telegram: null, sms: sms.fn, email: email.fn });
  assertEquals(email.calls.n, 0);
  assertEquals(r.terminal, "sms");
  assertEquals(r.emailRung, "skipped_terminal");
  assertEquals(r.smsBestEffort, false);
});

Deno.test("gateway SMS + failed email: still sent (best effort), rung recorded as failed", async () => {
  const r = await runLadder({ telegram: null, sms: spy("gateway:metro").fn, email: spy(new Error("suppressed")).fn });
  assertEquals(r.terminal, null);
  assertEquals(r.smsBestEffort, true);
  assertEquals(r.emailRung, "failed");
  assert(r.anySent);
  assert(r.errors.some((e) => e.startsWith("email:")));
});

Deno.test("gateway SMS + no email on file: rung says no_email (not a regression)", async () => {
  const r = await runLadder({ telegram: null, sms: spy("gateway:cricket").fn, email: null });
  assertEquals(r.emailRung, "no_email");
  assert(r.anySent);
});

Deno.test("SMS refused (skipped, no consent, retired gateway): falls through to email", async () => {
  const email = spy("re_9");
  const r = await runLadder({ telegram: null, sms: spy(new Error("send-sms-auto-detect outcome=skipped")).fn, email: email.fn });
  assertEquals(email.calls.n, 1);
  assertEquals(r.terminal, "email");
  assertEquals(r.smsReceipt, null);
});

Deno.test("Telegram enqueue ends the ladder; failure falls through", async () => {
  const sms = spy("gateway:uscellular");
  const ok = await runLadder({ telegram: () => Promise.resolve(), sms: sms.fn, email: spy("re_1").fn });
  assertEquals(ok.terminal, "telegram");
  assertEquals(sms.calls.n, 0);
  assertEquals(ok.emailRung, "skipped_terminal");
  const bad = await runLadder({ telegram: () => Promise.reject(new Error("x")), sms: null, email: spy("re_2").fn });
  assertEquals(bad.terminal, "email");
});

Deno.test("nothing available: nothing sent", async () => {
  const r = await runLadder({ telegram: null, sms: null, email: null });
  assertEquals(r.anySent, false);
  assertEquals(r.terminal, null);
});

Deno.test("isTerminalSmsReceipt only accepts a provider SID", () => {
  assert(isTerminalSmsReceipt("twilio:SM0123456789abcdef"));
  assert(!isTerminalSmsReceipt("gateway:broadcast"));
  assert(!isTerminalSmsReceipt("gateway:tmobile"));
  assert(!isTerminalSmsReceipt("twilio:"));
  assert(!isTerminalSmsReceipt(null));
});
