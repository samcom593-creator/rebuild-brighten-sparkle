import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { emailTypoSuggestion, licensedNpnIssue, REAPPLY_LIVE_AFTER_DAYS, shouldSendWelcomeSms } from "./policy.ts";

Deno.test("re-application window: index.ts and the migration use the same 30 days", async () => {
  assertEquals(REAPPLY_LIVE_AFTER_DAYS, 30);
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  // the full-form short-circuit reads the shared constant, not a literal
  assertEquals(src.includes("REAPPLY_LIVE_AFTER_DAYS * 24 * 3600 * 1000"), true);
  // the repeat-submit path no longer marks the person's only live row as a duplicate
  assertEquals(/is_duplicate:\s*true/.test(src), false);
  const mig = await Deno.readTextFile(
    new URL("../../migrations/20261112000150_pkg1_reapplication_live_record.sql", import.meta.url),
  );
  assertEquals(mig.includes("interval '30 days'"), true);
});

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

const SENT = { recipientSuspended: false, welcomeSent: true };

Deno.test("consent gate: no welcome SMS without an explicit opt-in", () => {
  assertEquals(shouldSendWelcomeSms("+15555550100", { smsConsentGiven: true }, SENT), true);
  assertEquals(shouldSendWelcomeSms("+15555550100", { smsConsentGiven: false }, SENT), false);
  assertEquals(shouldSendWelcomeSms("+15555550100", {}, SENT), false);
  assertEquals(shouldSendWelcomeSms("+15555550100", null, SENT), false);
  assertEquals(shouldSendWelcomeSms("", { smsConsentGiven: true }, SENT), false);
});

Deno.test("suspension gate: no welcome SMS to a suspended or banned login, or when the lookup failed", () => {
  const consent = { smsConsentGiven: true };
  // Kirsten (1afcf998, suspended) applied on 2026-11-02: the email was skipped, the text was not
  assertEquals(shouldSendWelcomeSms("+15555550100", consent, { recipientSuspended: true, welcomeSent: false }), false);
  assertEquals(shouldSendWelcomeSms("+15555550100", consent, { recipientSuspended: true, welcomeSent: true }), false);
  // could not look: the SMS is optional, so it does not go
  assertEquals(shouldSendWelcomeSms("+15555550100", consent, { recipientSuspended: null, welcomeSent: true }), false);
  assertEquals(shouldSendWelcomeSms("+15555550100", consent, null), false);
  assertEquals(shouldSendWelcomeSms("+15555550100", consent, undefined), false);
});

Deno.test("the text points at an email: no welcome SMS when the welcome email did not go out", () => {
  assertEquals(shouldSendWelcomeSms("+15555550100", { smsConsentGiven: true }, { recipientSuspended: false, welcomeSent: false }), false);
});

Deno.test("index.ts wires the SMS to the welcome outcome (no text before the email's result)", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const sms = src.slice(src.indexOf("function dispatchFullSubmissionSideEffects"), src.indexOf("async function handleQuickQualify"));
  assertEquals(sms.includes("const outcome = await welcomeOutcome;"), true);
  assertEquals(sms.includes("shouldSendWelcomeSms(data.phone, data.consent, outcome)"), true);
  // the fetch itself (comments may name the function earlier)
  assertEquals(sms.indexOf("await welcomeOutcome") < sms.indexOf("/functions/v1/send-sms-auto-detect"), true);
});
