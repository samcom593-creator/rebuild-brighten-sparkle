// MP-HIRE-CELEBRATION: the hire email reads only the hire's own fields, escapes them,
// and never carries a link off galaxyfinancial.org or a smuggled contact detail.
//
// Run: deno test supabase/functions/apex-outbox-dispatcher/hire-email-template.test.ts

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  HIRE_EMAIL_DEFAULT_CONTRACTING_URL,
  HIRE_EMAIL_DEFAULT_OPEN_URL,
  renderHireEmail,
  safeHireUrl,
} from "./hire-email-template.ts";

const payload = {
  agentName: "Daniel Bridges",
  agentCode: "DBRIDGES01",
  managerName: "Obiajulu Ifediora",
  licenseStatus: "licensed",
  onboardingStage: "training_online",
  hiredAt: "2026-11-26T01:20:05Z",
  openUrl: "https://galaxyfinancial.org/dashboard/profile?agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  contractingUrl: "https://galaxyfinancial.org/start-contracting",
};

Deno.test("renders the hire's name, code, recruiter, license, stage and date", () => {
  const mail = renderHireEmail(payload);
  assertEquals(mail.subject, "New hire: Daniel Bridges (licensed)");
  for (const needle of ["Daniel Bridges", "DBRIDGES01", "Obiajulu Ifediora", "Licensed", "training online", "2026-11-26"]) {
    assertStringIncludes(mail.html, needle);
    assertStringIncludes(mail.text, needle);
  }
  assertStringIncludes(mail.html, "Welcome Daniel to Galaxy Financial");
  assertStringIncludes(mail.html, payload.openUrl);
  assertStringIncludes(mail.text, payload.contractingUrl);
});

Deno.test("an unlicensed hire reads pre-license, never a blank", () => {
  const mail = renderHireEmail({ agentName: "Brooke Lane", licenseStatus: "unlicensed" });
  assertEquals(mail.subject, "New hire: Brooke Lane (pre-license)");
  assertStringIncludes(mail.html, "Pre-license");
  assert(!mail.html.includes("Agent code"), "no code row when the hire has no code yet");
});

Deno.test("escapes html in every field it renders", () => {
  const mail = renderHireEmail({ ...payload, agentName: "<script>alert(1)</script> Jones", managerName: "O'Neil & Sons" });
  assert(!mail.html.includes("<script>"), "raw script tag must not survive");
  assertStringIncludes(mail.html, "&lt;script&gt;");
  assertStringIncludes(mail.html, "O&#039;Neil &amp; Sons");
});

Deno.test("links off galaxyfinancial.org fall back to the dashboard defaults", () => {
  const mail = renderHireEmail({
    ...payload,
    openUrl: "https://apex-financial.org/dashboard/profile?agentId=x",
    contractingUrl: "javascript:alert(1)",
  });
  assertStringIncludes(mail.html, HIRE_EMAIL_DEFAULT_OPEN_URL);
  assertStringIncludes(mail.html, HIRE_EMAIL_DEFAULT_CONTRACTING_URL);
  assert(!mail.html.includes("apex-financial.org"));
  assert(!mail.html.includes("javascript:"));
  // A declared route on purpose: check:dead-internal-links scans every
  // galaxyfinancial.org literal in the repo against src/App.tsx.
  assertEquals(safeHireUrl("https://galaxyfinancial.org/dashboard/recruiting", "f"), "https://galaxyfinancial.org/dashboard/recruiting");
  assertEquals(safeHireUrl("https://galaxyfinancial.org.evil.com/dashboard", "f"), "f");
});

Deno.test("a payload that smuggles contact details cannot reach the inbox", () => {
  const mail = renderHireEmail({
    ...payload,
    phone: "6015404885",
    email: "leak@example.com",
    dob: "1990-01-01",
    address: "12 Leak St",
    clientName: "LEAK CLIENT",
  });
  for (const leak of ["6015404885", "leak@example.com", "1990-01-01", "12 Leak St", "LEAK CLIENT"]) {
    assert(!mail.html.includes(leak), `html carried ${leak}`);
    assert(!mail.text.includes(leak), `text carried ${leak}`);
    assert(!mail.subject.includes(leak), `subject carried ${leak}`);
  }
});

Deno.test("an empty payload still renders a complete, sendable email", () => {
  const mail = renderHireEmail(null);
  assertEquals(mail.subject, "New hire: A new producer (pre-license)");
  assertStringIncludes(mail.html, HIRE_EMAIL_DEFAULT_OPEN_URL);
  assert(mail.text.length > 40);
});
