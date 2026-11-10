// WP4: no SMS without recorded consent, for every caller.
// Run: deno test --no-check supabase/functions/send-sms-auto-detect/consent.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { consentDecision, SKIPPED_NO_CONSENT } from "./consent.ts";

Deno.test("sms_consent_given=false -> skipped_no_consent", () => {
  const d = consentDecision({ allowed: false, source: "application_id", application_id: "x" }, null);
  assertEquals(d.send, false);
  if (!d.send) {
    assertEquals(d.reason, SKIPPED_NO_CONSENT);
    assertEquals(d.reason, "skipped_no_consent");
    assertEquals(d.source, "application_id");
  }
});

Deno.test("no record for the number -> skipped_no_consent", () => {
  const d = consentDecision({ allowed: false, source: "no_consent_record" }, null);
  assertEquals(d.send, false);
});

Deno.test("recorded consent -> send", () => {
  assertEquals(consentDecision({ allowed: true, source: "application_phone" }, null), { send: true, source: "application_phone" });
  assertEquals(consentDecision({ allowed: true, source: "operator_self" }, null).send, true);
});

Deno.test("fails closed: lookup error, null data, truthy-but-not-true", () => {
  assertEquals(consentDecision(null, { message: "boom" }).send, false);
  assertEquals(consentDecision(null, null).send, false);
  assertEquals(consentDecision({ allowed: "true" }, null).send, false);
  assertEquals(consentDecision({ allowed: 1 }, null).send, false);
  const e = consentDecision({ allowed: true }, { message: "boom" });
  assert(!e.send, "an error must win over a data payload");
});
