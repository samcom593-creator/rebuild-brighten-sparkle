import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSections, isSendHour, phoenixDay, renderOverview, type OverviewData } from "./render.ts";

const EMPTY: OverviewData = {
  day: "2026-11-11", today: "2026-11-12",
  applicants: { licensed: [], unlicensed: [] },
  interviews: { booked: 0, today: [] },
  followups: { late: 0, untouched_new: 0 },
  hires: { new: [], not_onboarded: [] },
  production: { deals: 0, ap: 0 },
  content: { awaiting_approval: 0, failed: 0 },
  system: { critical_24h: [] },
};

Deno.test("nothing happened: no sections, and the message says so instead of listing zeros", () => {
  const r = renderOverview(EMPTY);
  assertEquals(r.sections.length, 0);
  assertStringIncludes(r.html, "Nothing needs you today");
  assertEquals(r.subject, "Galaxy daily overview: nothing needs you");
});

Deno.test("only sections with content appear, licensed first, each person linked to the pipeline", () => {
  const d: OverviewData = {
    ...EMPTY,
    applicants: { licensed: [{ id: "a1", name: "Lee <b>", state: "AZ" }], unlicensed: [{ id: "a2", name: "Kim", state: null }] },
    production: { deals: 2, ap: 3145.2 },
  };
  const s = buildSections(d);
  assertEquals(s.map((x) => x.title), ["New applicants, Wednesday, November 11", "Production, Wednesday, November 11"]);
  const html = renderOverview(d).html;
  assertStringIncludes(html, "/dashboard/recruiting?person=a1");
  assertStringIncludes(html, "Lee &lt;b&gt; (AZ)");
  assertStringIncludes(html, "$3,145 annual premium posted on 2 deals. Production, not income.");
  assertEquals(html.includes("Interviews"), false);
});

Deno.test("an interview today with no prep notes says so", () => {
  const d: OverviewData = { ...EMPTY, interviews: { booked: 1, today: [{ name: "Pat", at: "2026-11-12T21:00:00Z", track: "licensed", application_id: null, needs_prep: true }] } };
  const html = renderOverview(d).html;
  assertStringIncludes(html, "Today 2:00 PM AZ: Pat, licensed call · no prep notes yet");
});

Deno.test("send hour is read in Phoenix, and a malformed time never sends", () => {
  const sevenAz = new Date("2026-11-12T14:05:00Z");
  assertEquals(isSendHour("07:00", sevenAz), true);
  assertEquals(isSendHour("07:30", sevenAz), true);
  assertEquals(isSendHour("08:00", sevenAz), false);
  assertEquals(isSendHour("7am", sevenAz), false);
  assertEquals(phoenixDay(new Date("2026-11-13T03:00:00Z")), "2026-11-12");
});
