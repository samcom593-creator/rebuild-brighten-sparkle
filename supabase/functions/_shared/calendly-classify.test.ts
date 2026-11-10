// Proves the shared Calendly classifier (WP3). No remote imports, plain throws.
// Run: deno test supabase/functions/_shared/calendly-classify.test.ts

import { classifyCalendlyEvent, inviteeIsNoShow, utmApplicationId } from "./calendly-classify.ts";

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Every value must be allowed by interview_events_call_track_check.
const ALLOWED = new Set(["licensed", "leader", "seminar", "exam", "other", "onboarding", "licensing"]);

Deno.test("Licensing Call files as licensing, not other", () => {
  const t = classifyCalendlyEvent("Licensing Call", "licensing-call");
  expect(t === "licensing", `got ${t}`);
});

Deno.test("Manager Call (agents) is not the licensed-recruit track even with a licensed slug", () => {
  const t = classifyCalendlyEvent("Manager Call", "licensed-prospect-call-clone-1");
  expect(t === "other", `got ${t}`);
});

Deno.test("live event names keep their historical tracks", () => {
  const cases: Array<[string, string | null, string]> = [
    ["Licensed Call", null, "licensed"],
    ["Licensed Prospect Call", null, "licensed"],
    ["Licensed Call with Sam", "licensed-prospect-call-clone", "licensed"],
    ["Leader Call ", null, "leader"],
    ["Unlicensed Prospect Call ", null, "leader"],
    ["Interview", null, "leader"],
    ["Preferred Final Expense Review ", null, "other"],
    ["Seminar", null, "seminar"],
  ];
  for (const [name, slug, want] of cases) {
    const got = classifyCalendlyEvent(name, slug);
    expect(got === want, `${name}: want ${want} got ${got}`);
    expect(ALLOWED.has(got), `${name}: ${got} not allowed by the DB constraint`);
  }
});

Deno.test("utm_content only yields a well-formed uuid", () => {
  const id = "0ED2D5E5-3E9A-4F2E-9C1B-123456789ABC";
  expect(utmApplicationId({ utm_content: id }) === id.toLowerCase(), "uuid not accepted");
  expect(utmApplicationId({ utm_content: "ig-bio" }) === null, "non-uuid accepted");
  expect(utmApplicationId({ utm_content: `${id}' or 1=1` }) === null, "suffixed uuid accepted");
  expect(utmApplicationId(null) === null, "null tracking");
  expect(utmApplicationId({}) === null, "missing utm_content");
});

Deno.test("no-show detection reads the invitee no_show object", () => {
  expect(inviteeIsNoShow({ no_show: { uri: "x", created_at: "2026-11-10T00:00:00Z" } }), "object not detected");
  expect(!inviteeIsNoShow({ no_show: null }), "null treated as no-show");
  expect(!inviteeIsNoShow({}), "missing treated as no-show");
});
