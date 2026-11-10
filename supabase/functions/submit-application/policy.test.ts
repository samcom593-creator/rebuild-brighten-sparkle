import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { emailTypoSuggestion, licensedNpnIssue, shouldSendWelcomeSms } from "./policy.ts";

Deno.test("typo map: the measured dead domains are refused with a suggestion", () => {
  assertEquals(emailTypoSuggestion("Jo@Gmail.fom"), "jo@gmail.com");
  assertEquals(emailTypoSuggestion("jo@icloud.con"), "jo@icloud.com");
  assertEquals(emailTypoSuggestion("jo@yahoo.con"), "jo@yahoo.com");
  assertEquals(emailTypoSuggestion("jo@hotmial.com"), "jo@hotmail.com");
  assertEquals(emailTypoSuggestion("jo@gmial.com"), "jo@gmail.com");
  assertEquals(emailTypoSuggestion("jo@outlok.com"), "jo@outlook.com");
  assertEquals(emailTypoSuggestion("jo@gmail.co"), "jo@gmail.com");
});

Deno.test("typo map fails open: real and unknown domains pass untouched", () => {
  for (const e of ["jo@gmail.com", "jo@icloud.com", "jo@mail.com", "jo@protonmail.ch", "jo@company.co", "jo@some-agency.insurance", "", "no-at-sign"]) {
    assertEquals(emailTypoSuggestion(e), null, e);
  }
});

Deno.test("NPN refine: licensed needs 5-10 digits; other statuses need none", () => {
  assertEquals(licensedNpnIssue("licensed", "12345678"), null);
  assertEquals(licensedNpnIssue("licensed", "NPN: 1234-5678"), null);
  assertEquals(typeof licensedNpnIssue("licensed", ""), "string");
  assertEquals(typeof licensedNpnIssue("licensed", null), "string");
  assertEquals(typeof licensedNpnIssue("licensed", "1234"), "string");
  assertEquals(typeof licensedNpnIssue("licensed", "12345678901"), "string");
  assertEquals(licensedNpnIssue("unlicensed", ""), null);
  assertEquals(licensedNpnIssue("pending", null), null);
});

Deno.test("consent gate: no welcome SMS without an explicit opt-in", () => {
  assertEquals(shouldSendWelcomeSms("+15555550100", { smsConsentGiven: true }), true);
  assertEquals(shouldSendWelcomeSms("+15555550100", { smsConsentGiven: false }), false);
  assertEquals(shouldSendWelcomeSms("+15555550100", {}), false);
  assertEquals(shouldSendWelcomeSms("+15555550100", null), false);
  assertEquals(shouldSendWelcomeSms("", { smsConsentGiven: true }), false);
});
