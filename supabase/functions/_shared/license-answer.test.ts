// Regression test for welcome.start's unparsed reply (2026-10-07).
//
// The live replies come first: "UNLICENSED" and "I’m unlicensed" (curly
// apostrophe) are the two messages application 03be96c0 actually sent, and
// both got ai.fallback_unknown. The negative half matters as much: a real
// question that mentions a license must still reach aiAnswer.
//
// Run: deno test supabase/functions/_shared/license-answer.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseLicenseAnswer } from "./license-answer.ts";

Deno.test("the two replies a real applicant sent are answers", () => {
  assertEquals(parseLicenseAnswer("UNLICENSED"), "unlicensed");
  assertEquals(parseLicenseAnswer("I’m unlicensed"), "unlicensed");
});

Deno.test("the two words the template asks for, in any case", () => {
  assertEquals(parseLicenseAnswer("LICENSED"), "licensed");
  assertEquals(parseLicenseAnswer("licensed"), "licensed");
  assertEquals(parseLicenseAnswer("Unlicensed."), "unlicensed");
  assertEquals(parseLicenseAnswer("  unlicensed!! "), "unlicensed");
});

Deno.test("natural phrasings of the same answer", () => {
  assertEquals(parseLicenseAnswer("not licensed"), "unlicensed");
  assertEquals(parseLicenseAnswer("Not licensed yet"), "unlicensed");
  assertEquals(parseLicenseAnswer("not yet licensed"), "unlicensed");
  assertEquals(parseLicenseAnswer("un licensed"), "unlicensed");
  assertEquals(parseLicenseAnswer("No license"), "unlicensed");
  assertEquals(parseLicenseAnswer("I'm licensed"), "licensed");
  assertEquals(parseLicenseAnswer("im already licensed"), "licensed");
  assertEquals(parseLicenseAnswer("I am licensed in Texas"), "licensed");
  assertEquals(parseLicenseAnswer("licenced"), "licensed");
});

Deno.test("an unlicensed reply is never read as licensed", () => {
  // UNLICENSED contains LICENSED. The ^ anchor on LICENSED_RE is what keeps
  // them apart; an unanchored match reads every one of these as licensed.
  for (const s of ["UNLICENSED", "not licensed", "I'm not licensed yet"]) {
    assertEquals(parseLicenseAnswer(s), "unlicensed", s);
  }
});

Deno.test("real questions still go to aiAnswer", () => {
  for (const s of [
    "how do I get licensed?",
    "licensed?",
    "when will I be licensed",
    "do I need to be licensed to start",
    "I'm licensed in Texas but moving to Ohio, does that matter",
    "what does licensed mean",
    "",
    "   ",
  ]) {
    assertEquals(parseLicenseAnswer(s), null, JSON.stringify(s));
  }
});
