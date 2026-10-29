/**
 * The desk's numbers equal the lists they open (OVERHAUL-instagram). People is the funnel: the
 * lists filtered by the server's per-person stage flags carry exactly the stage counts, the
 * booked / applied / hired lists are the server's own stage lists, and an older server (no flags)
 * falls back to the stage lists and reports the slice it holds instead of passing it off as whole.
 */
import { describe, expect, it } from "vitest";
import { filterPeople, hasStageFlags, peopleList, peopleLists, tileTrend } from "../igScore";
import type { IgDashboard, IgRow, IgStage, IgStageKey } from "../igTypes";

function person(i: number, over: Partial<IgRow> = {}): IgRow {
  return {
    external_id: String(1000 + i), handle: `@person${i}`, name: `Person ${i}`, status: "casual", rank: 7,
    last_body: `hello ${i}`, last_direction: "inbound", last_at: null, last_inbound_at: null, age_min: null,
    phone: null, email: null, intent: "casual", licensed: false, human_lane: false, booked_event: null, has_booking: false, applied: false,
    ...over,
  };
}

function stage(key: IgStageKey, count: number, people: IgRow[] = [], prior = 0): IgStage {
  return { key, label: key, caption: "", count, prior_count: prior, prev_key: null, people };
}

// 10 people wrote in: 4 talked business, 1 said licensed, 3 gave a number.
const people = Array.from({ length: 10 }, (_, i) => person(i, {
  stages: { business: i < 4, licensed: i === 0, number: i >= 2 && i < 5, booked: i === 3 },
  phone: i >= 2 && i < 5 ? `48032775${40 + i}` : null,
}));
const bookedPeople = [person(3), person(99, { external_id: "ie:abc", handle: null, name: "Calendly Booker" })];
const appliedPeople = [person(1), person(2), person(50, { external_id: "app:xyz" })];

function dash(over: Partial<Pick<IgDashboard, "people">> = {}, stagesOver?: IgStage[]): Pick<IgDashboard, "funnel" | "people"> {
  return {
    people,
    ...over,
    funnel: {
      since: "", prior_since: "", locked_in_gap: 0, locked_in_people: [],
      stages: stagesOver ?? [
        stage("in", 10, people.slice(0, 5)), stage("business", 4, people.slice(0, 2)), stage("licensed", 1, [people[0]]),
        stage("number", 3, people.slice(2, 5), 1), stage("booked", 2, bookedPeople, 4), stage("showed", 0), stage("applied", 3, appliedPeople, 3),
        stage("hired", 1, [person(1)]), stage("recovered", 0),
      ],
    },
  };
}

describe("peopleList: every chip's number is the rows it shows", () => {
  it("flag lists equal the stage counts the funnel prints", () => {
    const d = dash();
    expect(hasStageFlags(d.people)).toBe(true);
    for (const [key, count] of [["everyone", 10], ["business", 4], ["licensed", 1], ["number", 3]] as const) {
      const l = peopleList(d, key);
      expect(l.rows).toHaveLength(count);
      expect(l.total).toBe(count);
    }
  });
  it("booked, applied and hired are the server's lists, people with no DM thread included", () => {
    const d = dash();
    expect(peopleList(d, "booked").rows.map((r) => r.external_id)).toEqual(["1003", "ie:abc"]);
    expect(peopleList(d, "booked").total).toBe(2);
    expect(peopleList(d, "applied").rows).toHaveLength(3);
    expect(peopleList(d, "hired").rows).toHaveLength(1);
  });
  it("every list is offered, in funnel order with licensed last", () => {
    expect(peopleLists(dash()).map((l) => l.key)).toEqual(["everyone", "business", "number", "booked", "applied", "hired", "licensed"]);
    expect(peopleLists(dash()).map((l) => l.label)).toEqual(["Everyone", "Talked business", "Gave a number", "Booked a call", "Applied", "Hired", "Said they're licensed"]);
  });
  it("an older server (no stage flags) falls back to the stage lists and keeps the true total", () => {
    const legacy = people.map(({ stages: _stages, ...rest }) => rest as IgRow);
    const d = dash({ people: legacy });
    expect(hasStageFlags(d.people)).toBe(false);
    const everyone = peopleList(d, "everyone");
    expect(everyone.rows).toHaveLength(5);
    expect(everyone.total).toBe(10);
    const business = peopleList(d, "business");
    expect(business.rows).toHaveLength(2);
    expect(business.total).toBe(4);
  });
  it("a missing stage is a total of zero and an empty list, never a crash", () => {
    const d = dash({}, []);
    expect(peopleList(d, "booked")).toMatchObject({ rows: [], total: 0 });
  });
});

describe("filterPeople: find a person by what Sam remembers", () => {
  const rows = [
    person(1, { handle: "@kevin.z", name: "KZ", last_in_body: "What place" }),
    person(2, { handle: "@donavon", name: "Donavon Brikho", phone: "2485561837" }),
    person(3, { handle: "@gogetta", last_out: { body: "do you have your license?", at: "", by: "bot", state: "refused", kind: null } }),
  ];
  it("matches handle, name, their words, our words and the number's digits", () => {
    expect(filterPeople(rows, "kevin").map((r) => r.handle)).toEqual(["@kevin.z"]);
    expect(filterPeople(rows, "brikho").map((r) => r.handle)).toEqual(["@donavon"]);
    expect(filterPeople(rows, "what place").map((r) => r.handle)).toEqual(["@kevin.z"]);
    expect(filterPeople(rows, "license").map((r) => r.handle)).toEqual(["@gogetta"]);
    expect(filterPeople(rows, "(248) 556").map((r) => r.handle)).toEqual(["@donavon"]);
    expect(filterPeople(rows, "  ")).toHaveLength(3);
    expect(filterPeople(rows, "nobody-like-this")).toHaveLength(0);
  });
});

describe("tileTrend: words first, the tone repeats them", () => {
  const words = { up: (n: string) => `Up from ${n}`, down: (n: string) => `Down from ${n}`, same: "Same as before" };
  it("up is good, down is hot, same is quiet, unknown is nothing", () => {
    expect(tileTrend(stage("number", 16, [], 2), words)).toEqual({ text: "Up from 2", tone: "good" });
    expect(tileTrend(stage("booked", 3, [], 9), words)).toEqual({ text: "Down from 9", tone: "hot" });
    expect(tileTrend(stage("applied", 4, [], 4), words)).toEqual({ text: "Same as before", tone: "slate" });
    expect(tileTrend(undefined, words)).toBeNull();
    // Nothing then and nothing now is not a trend.
    expect(tileTrend(stage("hired", 0, [], 0), words)).toBeNull();
  });
});
