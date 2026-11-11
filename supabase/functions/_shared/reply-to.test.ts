// MP-ONBOARD-ANCHOR-PKG1: every recruit email replies to the one mailbox that exists.
// Run: deno test --no-check --allow-read supabase/functions/_shared/reply-to.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { NO_MAILBOX_DOMAINS, RECRUIT_REPLY_TO, replyAddress, resolveReplyTo } from "./reply-to.ts";

Deno.test("no value, an empty value and a blank secret all fall back to the live inbox", () => {
  for (const v of [undefined, null, "", "   ", "not-an-address"]) {
    assertEquals(resolveReplyTo(v as string | null | undefined), RECRUIT_REPLY_TO, String(v));
  }
  assertEquals(RECRUIT_REPLY_TO, "info@kingofsales.net");
});

Deno.test("an address on the sending domain is refused: those mailboxes return 550", () => {
  for (const v of [
    "sam@apex-financial.org",
    "notifications@apex-financial.org",
    "Galaxy Financial <hello@apex-financial.org>",
    "ALERTS@APEX-FINANCIAL.ORG",
  ]) {
    assertEquals(resolveReplyTo(v), RECRUIT_REPLY_TO, v);
  }
  assertEquals(NO_MAILBOX_DOMAINS.includes("apex-financial.org"), true);
});

Deno.test("a real receiving inbox named by the caller is kept as given", () => {
  assertEquals(resolveReplyTo("info@kingofsales.net"), "info@kingofsales.net");
  assertEquals(resolveReplyTo("Aisha <aisha@example.com>"), "Aisha <aisha@example.com>");
});

Deno.test("replyAddress extracts and lower-cases the bare address", () => {
  assertEquals(replyAddress("Sam <Sam@KingOfSales.net>"), "sam@kingofsales.net");
  assertEquals(replyAddress("x@y"), "");
  assertEquals(replyAddress(42), "");
});
