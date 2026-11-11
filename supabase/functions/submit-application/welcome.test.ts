// MP-ONBOARD-ANCHOR-PKG1: the day-0 welcome carries one next step, in Sam's voice, with no
// income claim and no promised call-back.
// Run: deno test --no-check --allow-read supabase/functions/submit-application/welcome.test.ts
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildApplicantWelcome, QUESTIONS_CALL_LINE, subjectName, welcomeVariant } from "./welcome.ts";

const APP = "1afcf998-0eb4-4bb2-9a3a-000000000001";
const base = { applicationId: APP, firstName: "Jordan", lastName: "Lee", email: "jordan@example.com" };

function links(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

Deno.test("three variants, chosen by license status", () => {
  assertEquals(welcomeVariant("licensed"), "licensed");
  assertEquals(welcomeVariant("pending"), "pending");
  assertEquals(welcomeVariant("unlicensed"), "unlicensed");
  assertEquals(welcomeVariant(null), "unlicensed");
});

Deno.test("every variant: one button, at most one secondary link, the status page, signed Sam", () => {
  for (const licenseStatus of ["licensed", "pending", "unlicensed"]) {
    const w = buildApplicantWelcome({ ...base, licenseStatus });
    const hrefs = links(w.html);
    assert(hrefs.length >= 1 && hrefs.length <= 2, `${licenseStatus}: ${hrefs.length} links`);
    assertEquals((w.html.match(/display:inline-block/g) ?? []).length, 1, `${licenseStatus}: one button`);
    assert(hrefs.some((h) => h.includes(`/status/${APP}`)), `${licenseStatus}: status page link`);
    assertStringIncludes(w.html, ">Sam</p>");
    assertStringIncludes(w.text, "Sam");
    // three sentences at most, the secondary line included (link labels are not sentences)
    const n = sentenceCount(w);
    assert(n >= 1 && n <= 3, `${licenseStatus}: ${n} sentences`);
  }
});

// Sentences in the copy a person reads: the body lines plus the secondary line's lead (a link
// label such as "Open my page" is not a sentence).
function sentenceCount(w: { copy: string[] }): number {
  return (w.copy.join(" ").match(/[.?!](\s|$)/g) ?? []).length;
}

Deno.test("sentence counter: the 2026-11-12 review's licensed welcome had 4; every variant now has 3", () => {
  // the reviewed licensed copy: 2 body lines with 3 sentences + the secondary lead
  assertEquals(sentenceCount({ copy: [
    "Jordan, I got your application and saw you're already licensed.",
    "The next step is a 15-minute call with me. Have your NPN and your resident state ready.",
    "Your application page stays open any time.",
  ] }), 4);
  for (const licenseStatus of ["licensed", "pending", "unlicensed"]) {
    const w = buildApplicantWelcome({ ...base, licenseStatus });
    assertEquals(sentenceCount(w), 3, licenseStatus);
    // every sentence the person reads is in the HTML and the text part
    for (const s of w.copy) {
      assertStringIncludes(w.text, s);
      assertStringIncludes(w.html, s.replace(/'/g, "&#39;"));
    }
  }
});

Deno.test("no income claims, no promised call-back, no hype, no emoji, brand is Galaxy Financial", () => {
  for (const licenseStatus of ["licensed", "pending", "unlicensed"]) {
    const w = buildApplicantWelcome({ ...base, licenseStatus });
    const all = `${w.subject}\n${w.html}\n${w.text}`;
    assertEquals(/\$\s?\d|per month|a month|earn|income|six-figure|6-figure/i.test(all), false, `${licenseStatus}: income claim`);
    assertEquals(/within (24|48) hours|will call you|hear from a manager/i.test(all), false, `${licenseStatus}: promise`);
    assertEquals(/most people never|show up|hand-holding|incredible|\bNOW\b|!/.test(all), false, `${licenseStatus}: hype`);
    assertEquals(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(all), false, `${licenseStatus}: emoji`);
    assertEquals(/Apex Financial/i.test(all), false, `${licenseStatus}: retired brand`);
    assertEquals(/discord|whatsapp/i.test(all), false, `${licenseStatus}: retired channel`);
    assertEquals(/ — .* — /.test(all), false, `${licenseStatus}: em-dash chain`);
  }
});

Deno.test("licensed: the button is the licensed call, prefilled, utm_content = application id", () => {
  const w = buildApplicantWelcome({ ...base, licenseStatus: "licensed" });
  assertEquals(w.variant, "licensed");
  assertEquals(w.subject, "Jordan, book your call with Sam");
  const u = new URL(w.primaryUrl);
  assertEquals(`${u.origin}${u.pathname}`, "https://calendly.com/apexfinancialempire/licensed-prospect-call-clone");
  assertEquals(u.searchParams.get("utm_content"), APP);
  assertEquals(u.searchParams.get("email"), "jordan@example.com");
  assertStringIncludes(w.html, "NPN");
});

Deno.test("unlicensed: status page is the button; the questions-call line is kept", () => {
  const w = buildApplicantWelcome({ ...base, licenseStatus: "unlicensed" });
  assertEquals(w.subject, "Jordan, your Galaxy application is in");
  assertEquals(w.primaryUrl, `https://apex-financial.org/status/${APP}`);
  assertStringIncludes(w.html, QUESTIONS_CALL_LINE);
  const q = new URL(w.secondaryUrl ?? "");
  assertEquals(`${q.origin}${q.pathname}`, "https://calendly.com/apexfinancialempire/licensing-questions");
  assertEquals(q.searchParams.get("utm_content"), APP);
});

Deno.test("pending: the page's real first step (receipt or certificate), no NPN-field promise", () => {
  const w = buildApplicantWelcome({ ...base, licenseStatus: "pending" });
  assertEquals(w.variant, "pending");
  assertStringIncludes(w.html, "pending");
  assertStringIncludes(w.html, "receipt or certificate");
  // the NPN field (LicensingSelfReport) renders only after a receipt upload
  assertEquals(/NPN/.test(`${w.subject}\n${w.text}`), false);
  assertEquals(w.primaryUrl, `https://apex-financial.org/status/${APP}`);
});

Deno.test("the pending copy matches the page: PendingBody asks for the receipt and the NPN waits for it", async () => {
  const page = await Deno.readTextFile(new URL("../../../src/components/landing/ApplicationConfirmationV2.tsx", import.meta.url));
  const pending = page.slice(page.indexOf("function PendingBody"), page.indexOf("// ---------- Reusable step row"));
  assertStringIncludes(pending, "Upload the receipt or completion certificate");
  const proof = await Deno.readTextFile(new URL("../../../src/components/landing/LicensingProofStep.tsx", import.meta.url));
  assertStringIncludes(proof, 'state === "submitted" && applicationId ? <LicensingSelfReport');
});

Deno.test("names are escaped in HTML and kept plain (single line) in the subject", () => {
  const w = buildApplicantWelcome({ ...base, firstName: "<b>O'Neil</b>\r\nBcc: x@y.z", licenseStatus: "unlicensed" });
  assertEquals(w.html.includes("<b>"), false);
  assertStringIncludes(w.html, "&lt;b&gt;O&#39;Neil&lt;/b&gt;");
  assertEquals(/[\r\n]/.test(w.subject), false);
  assertEquals(subjectName("  "), "there");
  assertEquals(subjectName(null), "there");
});
