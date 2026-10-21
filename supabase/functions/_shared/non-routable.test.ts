// 2026-10-21 (WIB resend-deliverability): sendEmail refuses recipients on
// domains that cannot receive mail, before Resend is called. Tests the leaf
// module because importing email.ts loads the Resend SDK, which reads env.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { nonRoutableDomain } from "./non-routable.ts";
Deno.test("refuses non-routable", () => {
  assertEquals(nonRoutableDomain("kae.x@placeholder.apex"), "placeholder.apex");
  assertEquals(nonRoutableDomain("Kae <kae.x@Placeholder.APEX>"), "placeholder.apex");
  assertEquals(nonRoutableDomain("a@example.com"), "example.com");
  assertEquals(nonRoutableDomain("a@foo.test"), "foo.test");
});
Deno.test("passes real domains", () => {
  for (const a of ["a@gmail.com", "a@apex-financial.org", "5551234567@tmomail.net", "a@apexfinancial.com", "a@notexample.com", "a@example.co"]) assertEquals(nonRoutableDomain(a), null, a);
});
