// WP6 magic-link receipts: 'sent' only with a provider message id.
//
// Run: deno test supabase/functions/cron-newhire-portal-login/receipt.test.ts
import { assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { maskEmail, receiptFor } from "./receipt.ts";

const NOW = new Date("2026-11-10T22:00:00Z");

Deno.test("a provider id is the only thing that makes a send 'sent'", () => {
  assertEquals(receiptFor({ ok: true, id: "re_123" }, NOW), {
    send_status: "sent", send_message_id: "re_123", sent_at: "2026-11-10T22:00:00.000Z",
  });
});

Deno.test("ok without an id is a failure, not a success", () => {
  assertEquals(receiptFor({ ok: true, id: null }, NOW).send_status, "failed");
  assertEquals(receiptFor({ ok: true, id: "  " }, NOW).send_status, "failed");
});

Deno.test("provider error is failed; suppression is refused; neither stamps sent_at", () => {
  const failed = receiptFor({ ok: false, id: null, error: "rate limited" }, NOW);
  assertEquals(failed.send_status, "failed");
  assertEquals(failed.sent_at, null);
  const refused = receiptFor({ ok: false, id: null, error: "suppressed", refused: "suppressed" }, NOW);
  assertEquals(refused.send_status, "refused");
  assertEquals(refused.send_message_id, null);
});

Deno.test("dry-run masking never returns the full address", () => {
  assertEquals(maskEmail("jordan@example.com"), "jor***@example.com");
  assertEquals(maskEmail("ab@x.io"), "ab***@x.io");
  assertFalse(maskEmail("jordan@example.com").includes("jordan"));
  assertEquals(maskEmail(""), "");
});
