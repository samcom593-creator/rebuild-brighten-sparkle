/**
 * Home conversions (OVERHAUL-home, 2026-10-29). Every number on the strip and the Selling
 * agents number is the length of one slice of the server's people, so these tests pin the
 * slicing, the unknown-is-not-zero rules, the comparison words and the line under each name.
 */
import { describe, expect, it } from "vitest";
import {
  CONVERSION_GROUPS,
  CONVERSION_STEPS,
  SELLING_STEP,
  conversionCount,
  conversionTone,
  conversionTrend,
  currentLabel,
  dayLabel,
  dayWords,
  parseConversionPayload,
  peopleFor,
  personDetail,
  personHref,
  personValue,
  priorLabel,
  unknownReason,
  xcelFeedFresh,
  type ConversionPerson,
} from "@/lib/homeConversions";

const person = (over: Partial<ConversionPerson>): ConversionPerson => ({
  kind: "applied",
  period: "current",
  name: "Jamie Rivera",
  at: null,
  on: "2026-10-29",
  application_id: null,
  agent_id: null,
  ...over,
});

const RAW = {
  as_of: "2026-10-29T16:05:00Z",
  today: "2026-10-29",
  week_start: "2026-10-23",
  prior_week_start: "2026-10-16",
  month_start: "2026-09-30",
  xcel_report_on: "2026-10-28",
  people: [
    { kind: "applied", period: "current", name: "Ana Diaz", at: "2026-10-29T16:14:00Z", on: "2026-10-29", application_id: "app-1", agent_id: null, license: "licensed" },
    { kind: "applied", period: "current", name: "Bo Kim", at: "2026-10-29T15:02:00Z", on: "2026-10-29", application_id: "app-2", agent_id: null, license: "unlicensed" },
    { kind: "applied", period: "prior", name: "Cy Lee", at: "2026-10-28T20:00:00Z", on: "2026-10-28", application_id: "app-3", agent_id: null, license: "unlicensed" },
    { kind: "interview_booked", period: "prior", name: "Dee Fox", at: "2026-10-28T18:00:00Z", on: "2026-10-28", application_id: "app-4", agent_id: null, track: "licensed", starts_at: "2026-10-30T21:00:00Z" },
    { kind: "xcel_bought", period: "current", name: "Eli Moss", at: null, on: "2026-10-27", application_id: "app-5", agent_id: null, course: "Life & Health" },
    { kind: "licensed", period: "current", name: "Fay Gold", at: "2026-10-26T17:00:00Z", on: "2026-10-26", application_id: "app-6", agent_id: "agent-6", how: "booking" },
    { kind: "first_deal", period: "prior", name: "Gus Hale", at: null, on: "2026-10-20", application_id: null, agent_id: "agent-7", ap: 1411.4 },
    { kind: "selling", period: "current", name: "Hal Ives", at: null, on: "2026-10-28", application_id: null, agent_id: "agent-8", deals: 8, ap: "13226" },
    { kind: "selling", period: "current", name: "Ida Jay", at: null, on: "2026-10-02", application_id: null, agent_id: "agent-9", deals: 1, ap: 1411 },
    // Rows the page does not know are dropped, never counted somewhere.
    { kind: "hired", period: "current", name: "Unknown kind", on: "2026-10-29" },
    { kind: "applied", period: "later", name: "Unknown period", on: "2026-10-29" },
    null,
  ],
};

describe("parseConversionPayload", () => {
  it("keeps every known row and drops unknown kinds, periods and junk", () => {
    const p = parseConversionPayload(RAW)!;
    expect(p.today).toBe("2026-10-29");
    expect(p.people).toHaveLength(9);
    expect(p.people.some((x) => x.name === "Unknown kind" || x.name === "Unknown period")).toBe(false);
    // Numbers that arrive as strings are read; anything else is null, never NaN.
    expect(p.people.find((x) => x.name === "Hal Ives")?.ap).toBe(13226);
    expect(p.people.find((x) => x.name === "Ana Diaz")?.ap).toBeNull();
  });

  it("returns null (unknown) for anything that is not the shape, never an empty strip", () => {
    for (const bad of [null, undefined, "x", 3, [], {}, { today: "2026-10-29" }, { today: "soon", people: [] }]) {
      expect(parseConversionPayload(bad)).toBeNull();
    }
    expect(parseConversionPayload({ today: "2026-10-29", people: [] })?.people).toEqual([]);
  });
});

describe("counts are the lists", () => {
  const p = parseConversionPayload(RAW)!;

  it("every tile's number equals the length of the list it opens, in both periods", () => {
    for (const step of [...CONVERSION_STEPS, SELLING_STEP]) {
      for (const period of ["current", "prior"] as const) {
        const count = conversionCount(p, step.kind, period);
        expect(count).toBe(peopleFor(p, step.kind, period).length);
      }
    }
    expect(conversionCount(p, "applied")).toBe(2);
    expect(conversionCount(p, "applied", "prior")).toBe(1);
    expect(conversionCount(p, "interview_booked")).toBe(0);
    expect(conversionCount(p, "selling")).toBe(2);
    expect(peopleFor(p, "applied").map((x) => x.name)).toEqual(["Ana Diaz", "Bo Kim"]);
  });

  it("an empty slice of a read that arrived is a true zero; no read at all is unknown", () => {
    expect(conversionCount(p, "passed_test")).toBe(0);
    expect(conversionCount(null, "passed_test")).toBeNull();
    expect(peopleFor(null, "applied")).toEqual([]);
  });

  it("Bought Xcel is unknown when Xcel's daily report is more than two days old, or never came", () => {
    expect(xcelFeedFresh(p)).toBe(true);
    expect(conversionCount(p, "xcel_bought")).toBe(1);
    expect(conversionCount({ ...p, xcel_report_on: "2026-10-27" }, "xcel_bought")).toBe(1);
    const late = { ...p, xcel_report_on: "2026-10-26" };
    expect(conversionCount(late, "xcel_bought")).toBeNull();
    expect(unknownReason(late, "xcel_bought")).toBe("Xcel's daily report has not arrived since Mon, Oct 26, so recent purchases may be missing.");
    expect(conversionCount({ ...p, xcel_report_on: null }, "xcel_bought")).toBeNull();
    expect(unknownReason({ ...p, xcel_report_on: null }, "xcel_bought")).toMatch(/No Xcel daily report/);
    // The feed only matters to the Xcel number.
    expect(conversionCount(late, "applied")).toBe(2);
    expect(unknownReason(late, "applied")).toBeNull();
    expect(unknownReason(null, "xcel_bought")).toBeNull();
  });
});

describe("the strip", () => {
  it("walks the funnel in order with plain labels and one window each", () => {
    expect(CONVERSION_STEPS.map((s) => [s.kind, s.label, s.window])).toEqual([
      ["applied", "Applied today", "day"],
      ["interview_booked", "Interviews booked today", "day"],
      ["xcel_bought", "Bought Xcel", "week"],
      ["passed_test", "Passed the test", "week"],
      ["licensed", "Newly licensed", "week"],
      ["first_deal", "First deals", "week"],
    ]);
    expect(SELLING_STEP).toMatchObject({ kind: "selling", label: "Selling agents", window: "month" });
    expect(SELLING_STEP.definition).toMatch(/Licensed agents on the roster with at least one posted deal in the last 30 days/);
    for (const s of [...CONVERSION_STEPS, SELLING_STEP]) {
      expect(s.definition.length).toBeGreaterThan(20);
      expect(s.emptyText.endsWith(".")).toBe(true);
      expect(s.emptyAction.to.startsWith("/")).toBe(true);
    }
  });

  it("groups the strip by when: Today (two numbers) and Last 7 days (four), every step once", () => {
    expect(CONVERSION_GROUPS.map((g) => [g.title, g.compared, g.steps.map((s) => s.short)])).toEqual([
      ["Today", "compared with yesterday", ["Applied", "Interviews booked"]],
      ["Last 7 days", "compared with the 7 days before", ["Bought Xcel", "Passed the test", "Newly licensed", "First deals"]],
    ]);
    const grouped = CONVERSION_GROUPS.flatMap((g) => g.steps.map((s) => s.kind));
    expect(grouped).toEqual(CONVERSION_STEPS.map((s) => s.kind));
  });

  it("lists Selling agents like a leaderboard: most ALP first, then by name; other lists keep the server's order", () => {
    const p = parseConversionPayload({
      today: "2026-10-29",
      people: [
        { kind: "selling", period: "current", name: "Zed", ap: 100, on: "2026-10-28" },
        { kind: "selling", period: "current", name: "Amy", ap: 900, on: "2026-10-01" },
        { kind: "selling", period: "current", name: "Bea", ap: 100, on: "2026-10-27" },
        { kind: "selling", period: "current", name: "Cal", ap: null, on: "2026-10-26" },
        { kind: "applied", period: "current", name: "Second", on: "2026-10-29" },
        { kind: "applied", period: "current", name: "First", on: "2026-10-29" },
      ],
    });
    expect(peopleFor(p, "selling").map((x) => x.name)).toEqual(["Amy", "Bea", "Zed", "Cal"]);
    expect(peopleFor(p, "applied").map((x) => x.name)).toEqual(["Second", "First"]);
    // Sorting never changes the count.
    expect(conversionCount(p, "selling")).toBe(4);
  });

  it("colours each step from the tone meanings: new and booked are cool, licensing royal, wins good", () => {
    expect(conversionTone("applied")).toBe("cool");
    expect(conversionTone("interview_booked")).toBe("cool");
    expect(conversionTone("xcel_bought")).toBe("good");
    expect(conversionTone("passed_test")).toBe("royal");
    expect(conversionTone("licensed")).toBe("good");
    expect(conversionTone("first_deal")).toBe("good");
    expect(conversionTone("selling")).toBe("good");
  });

  it("says the comparison in words, and says nothing when either side is unknown", () => {
    expect(conversionTrend(3, 1, "day")).toEqual({ text: "Up from 1", spoken: "Up from 1 yesterday", tone: "good" });
    expect(conversionTrend(0, 2, "week")).toEqual({ text: "Down from 2", spoken: "Down from 2 the week before", tone: "warm" });
    expect(conversionTrend(0, 0, "day")).toEqual({ text: "No change", spoken: "Same as yesterday", tone: "slate" });
    expect(conversionTrend(1200, 1000, "week")?.spoken).toBe("Up from 1,000 the week before");
    expect(conversionTrend(null, 2, "week")).toBeNull();
    expect(conversionTrend(2, null, "week")).toBeNull();
    expect(priorLabel("month")).toBe("the 30 days before");
    expect(currentLabel("week")).toBe("Last 7 days");
    expect(currentLabel("day")).toBe("Today");
  });
});

describe("the line under each name", () => {
  const today = "2026-10-29";

  it("names the day in Phoenix words, lower case inside a sentence", () => {
    expect(dayLabel("2026-10-29", today)).toBe("Today");
    expect(dayLabel("2026-10-28", today)).toBe("Yesterday");
    expect(dayLabel("2026-10-20", today)).toBe("Tue, Oct 20");
    expect(dayLabel(null, today)).toBe("Date unknown");
    expect(dayWords("2026-10-29", today)).toBe("today");
    expect(dayWords("2026-10-28", today)).toBe("yesterday");
    expect(dayWords("2026-10-20", today)).toBe("Tue, Oct 20");
    expect(dayWords(null, today)).toBe("date unknown");
  });

  it("reads each kind in plain words, times in Phoenix", () => {
    // 16:14 UTC is 9:14 AM in Phoenix (UTC-7, no daylight saving). Day lists sit under "Today" and
    // "Yesterday", so their lines carry the time, not the day again.
    expect(personDetail(person({ kind: "applied", at: "2026-10-29T16:14:00Z", license: "licensed" }), today)).toBe("Applied 9:14 AM · Licensed");
    expect(personDetail(person({ kind: "applied", at: "2026-10-29T16:14:00Z", license: "unlicensed" }), today)).toBe("Applied 9:14 AM · Not licensed yet");
    expect(personDetail(person({ kind: "applied", at: null, license: null }), today)).toBe("Applied today");
    expect(personDetail(person({ kind: "interview_booked", on: "2026-10-28", at: "2026-10-28T18:00:00Z", track: "licensed", starts_at: "2026-10-30T21:00:00Z" }), today))
      .toBe("Licensed call Fri, Oct 30, 2:00 PM · booked 11:00 AM");
    expect(personDetail(person({ kind: "interview_booked", at: "2026-10-29T18:00:00Z", track: "leader", starts_at: null }), today))
      .toBe("Leader call time not set · booked 11:00 AM");
    expect(personDetail(person({ kind: "xcel_bought", on: "2026-10-27", course: "Life & Health" }), today)).toBe("Enrolled Tue, Oct 27 · Life & Health");
    expect(personDetail(person({ kind: "xcel_bought", on: "2026-10-27", course: null }), today)).toBe("Enrolled Tue, Oct 27");
    expect(personDetail(person({ kind: "passed_test", on: "2026-10-28", at: "2026-10-28T23:30:00Z" }), today)).toBe("Passed yesterday, 4:30 PM");
    expect(personDetail(person({ kind: "licensed", on: "2026-10-26", at: "2026-10-26T17:00:00Z", how: "booking" }), today)).toBe("Licensed Mon, Oct 26, 10:00 AM · booked the licensed call");
    expect(personDetail(person({ kind: "licensed", on: "2026-10-26", at: "2026-10-26T17:00:00Z", how: "record" }), today)).toBe("Licensed Mon, Oct 26, 10:00 AM");
    expect(personDetail(person({ kind: "first_deal", on: "2026-10-20", ap: 1411.4 }), today)).toBe("First deal Tue, Oct 20");
    expect(personDetail(person({ kind: "selling", on: "2026-10-28", deals: 8, ap: 13226 }), today)).toBe("8 deals · last sale yesterday");
    expect(personDetail(person({ kind: "selling", on: "2026-10-02", deals: 1, ap: null }), today)).toBe("1 deal · last sale Fri, Oct 2");
  });

  it("puts the money on the right for producers only", () => {
    expect(personValue(person({ kind: "selling", ap: 13226 }))).toEqual({ amount: "$13,226", label: "ALP, 30 days" });
    expect(personValue(person({ kind: "first_deal", ap: 1411.4 }))).toEqual({ amount: "$1,411", label: "first-day ALP" });
    expect(personValue(person({ kind: "first_deal", ap: null }))).toBeNull();
    expect(personValue(person({ kind: "applied", ap: 5 }))).toBeNull();
  });

  it("never prints Invalid Date for an unreadable time", () => {
    const line = personDetail(person({ kind: "applied", at: "not a time", license: "licensed" }), today);
    expect(line).toBe("Applied today · Licensed");
    expect(personDetail(person({ kind: "interview_booked", at: "x", starts_at: "y", track: "licensed" }), today)).toBe("Licensed call time not set · booked today");
  });
});

describe("where a person opens", () => {
  it("producers open their agent page; the funnel opens the Call list or New hires", () => {
    expect(personHref(person({ kind: "selling", agent_id: "a 1" }))).toBe("/dashboard/agents/a%201");
    expect(personHref(person({ kind: "first_deal", agent_id: "a2" }))).toBe("/dashboard/agents/a2");
    expect(personHref(person({ kind: "applied", application_id: "app-1" }))).toBe("/dashboard/recruiting?person=app-1");
    expect(personHref(person({ kind: "interview_booked", application_id: "app-4" }))).toBe("/dashboard/recruiting?person=app-4");
    expect(personHref(person({ kind: "interview_booked", application_id: null, agent_id: "a3" }))).toBe("/dashboard/agents/a3");
    expect(personHref(person({ kind: "xcel_bought", name: "Eli Moss" }))).toBe("/dashboard/recruits?q=Eli%20Moss");
    expect(personHref(person({ kind: "passed_test", name: "Ana Diaz" }))).toBe("/dashboard/recruits?q=Ana%20Diaz");
    expect(personHref(person({ kind: "licensed", name: "Fay Gold", agent_id: "agent-6" }))).toBe("/dashboard/recruits?q=Fay%20Gold");
  });

  it("opens nothing when there is nothing to open the person by", () => {
    expect(personHref(person({ kind: "applied", application_id: null, name: null }))).toBeNull();
    expect(personHref(person({ kind: "xcel_bought", name: null }))).toBeNull();
    expect(personHref(person({ kind: "selling", agent_id: null }))).toBeNull();
  });
});
