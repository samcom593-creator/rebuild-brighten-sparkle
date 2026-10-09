import { beforeEach, describe, expect, it, vi } from "vitest";
import { CARRIERS, agent, emptyProfile, rosterPayload } from "../helpers/reviewFixtures";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  circleAriaLabel, levelText, markSentence, markedCountOf, matchesFilter, matchesSearch, missingIntake, nextToReview, npnProblem,
  parseReviewRoster, reviewCounts, saveLevel, saveMark, saveProfileForAgent, teamOptions, visibleAgents, withMark,
} from "@/lib/contractReview";

const N = CARRIERS.length;

describe("reading the review: a failed or short read is never 'everyone is unmarked'", () => {
  it("refuses a payload that is not ok", () => {
    expect(() => parseReviewRoster(null)).toThrow();
    expect(() => parseReviewRoster({ ok: false })).toThrow();
    expect(() => parseReviewRoster({ ...rosterPayload([agent()]), ok: undefined })).toThrow();
  });
  it("refuses a list that is shorter than its own count (truncation)", () => {
    const p = rosterPayload([agent({ id: "a" }), agent({ id: "b" })]);
    p.counts.agents = 3;
    expect(() => parseReviewRoster(p)).toThrow(/cut short/);
  });
  it("refuses a payload with no carriers or no agents array", () => {
    expect(() => parseReviewRoster({ ...rosterPayload([agent()]), carriers: [] })).toThrow();
    expect(() => parseReviewRoster({ ...rosterPayload([agent()]), agents: undefined })).toThrow();
  });
  it("accepts a successful read of zero people as an empty review, which is different from a failure", () => {
    const r = parseReviewRoster(rosterPayload([]));
    expect(r.agents).toEqual([]);
  });
  it("gives every person a value for every carrier (null = Not yet reviewed) and recomputes the marked count from the marks", () => {
    const raw = agent({ id: "a", marked: ["gto"] });
    delete (raw.marks as Record<string, unknown>).ethos;
    raw.marked_count = 99;
    const r = parseReviewRoster(rosterPayload([raw]));
    expect(Object.keys(r.agents[0].marks)).toEqual(["combine", "aflac", "gto", "ethos"]);
    expect(r.agents[0].marks.ethos).toBeNull();
    expect(r.agents[0].marked_count).toBe(1);
  });
  it("orders the circles Combine, AFLAC, GTO, Ethos whatever order they arrive in", () => {
    const p = rosterPayload([agent()]);
    p.carriers = [...CARRIERS].reverse();
    expect(parseReviewRoster(p).carriers.map((c) => c.label)).toEqual(["Combine", "AFLAC", "GTO", "Ethos"]);
  });
});

describe("filters partition the people by how many circles are confirmed", () => {
  const people = [
    agent({ id: "none" }), agent({ id: "one", marked: ["aflac"] }), agent({ id: "three", marked: ["aflac", "gto", "ethos"] }),
    agent({ id: "four", marked: ["combine", "aflac", "gto", "ethos"] }),
  ];
  it("Needs review = at least one Unmarked; Partially = 1 to 3; All four = all", () => {
    const ids = (f: "needs_review" | "partial" | "all_four") => people.filter((a) => matchesFilter(a, f, N)).map((a) => a.agent_id);
    expect(ids("needs_review")).toEqual(["none", "one", "three"]);
    expect(ids("partial")).toEqual(["one", "three"]);
    expect(ids("all_four")).toEqual(["four"]);
  });
  it("counts distinct people, and all-four does not mean licensed", () => {
    expect(reviewCounts(people, N)).toEqual({ total: 4, needsReview: 3, partial: 2, allFour: 1, unmarkedAll: 1 });
  });
  it("a person who is marked is counted once however they are marked", () => {
    expect(markedCountOf(people[2], CARRIERS)).toBe(3);
  });
});

describe("search and team", () => {
  const a = agent({ id: "a", display_name: "Ana María Pérez", email: "ana@example.test", manager_id: "m1", manager_name: "Mia", profile: emptyProfile({ npn: "0123456" }) });
  const b = agent({ id: "b", display_name: "Bo Chen", manager_id: "m2", manager_name: "Max" });
  it("matches name (accent-insensitive), email, NPN with its leading zero, and team", () => {
    expect(matchesSearch(a, "maria perez")).toBe(true);
    expect(matchesSearch(a, "ANA@EXAMPLE")).toBe(true);
    expect(matchesSearch(a, "0123456")).toBe(true);
    expect(matchesSearch(a, "mia")).toBe(true);
    expect(matchesSearch(a, "chen")).toBe(false);
  });
  it("narrows to one team", () => {
    const v = visibleAgents([a, b], { filter: "needs_review", search: "", managerId: "m2" }, N);
    expect(v.map((x) => x.agent_id)).toEqual(["b"]);
  });
  it("lists the teams with counts", () => {
    expect(teamOptions([a, b])).toEqual([{ id: "m2", name: "Max", count: 1 }, { id: "m1", name: "Mia", count: 1 }]);
  });
});

describe("the person you are working on stays visible until you advance", () => {
  const done = agent({ id: "done", marked: ["combine", "aflac", "gto", "ethos"] });
  const todo = agent({ id: "todo" });
  it("a finished person leaves the Needs review list, unless pinned", () => {
    const q = { filter: "needs_review" as const, search: "", managerId: "all" };
    expect(visibleAgents([done, todo], q, N).map((x) => x.agent_id)).toEqual(["todo"]);
    expect(visibleAgents([done, todo], q, N, new Set(["done"])).map((x) => x.agent_id)).toEqual(["done", "todo"]);
  });
  it("pinning never overrides search or the team", () => {
    const q = { filter: "needs_review" as const, search: "zzz", managerId: "all" };
    expect(visibleAgents([done, todo], q, N, new Set(["done"]))).toEqual([]);
  });
});

describe("next unreviewed", () => {
  const list = [agent({ id: "a" }), agent({ id: "b", marked: ["combine", "aflac", "gto", "ethos"] }), agent({ id: "c" }), agent({ id: "d", marked: ["aflac"] })];
  it("goes to the next person after the current one who still has an Unmarked circle", () => {
    expect(nextToReview(list, "a", N)?.agent_id).toBe("c");
    expect(nextToReview(list, "c", N)?.agent_id).toBe("d");
  });
  it("wraps once to the start, and never returns the current person", () => {
    expect(nextToReview(list, "d", N)?.agent_id).toBe("a");
  });
  it("starts from the top when there is no current person", () => {
    expect(nextToReview(list, null, N)?.agent_id).toBe("a");
  });
  it("is null when nobody else needs review", () => {
    expect(nextToReview([agent({ id: "a" })], "a", N)).toBeNull();
    expect(nextToReview([], null, N)).toBeNull();
  });
});

describe("optimistic update", () => {
  it("changes one circle and the count, leaving the rest and the original untouched", () => {
    const a = agent({ id: "a", marked: ["aflac"] });
    const b = withMark(a, CARRIERS, "gto", { at: "x", by: null, by_name: "you" });
    expect(b.marked_count).toBe(2);
    expect(b.marks.aflac).not.toBeNull();
    expect(a.marked_count).toBe(1);
    expect(withMark(b, CARRIERS, "gto", null).marked_count).toBe(1);
  });
});

describe("words", () => {
  it("never calls Unmarked late, pending or failed", () => {
    const s = markSentence(null);
    expect(s).toBe("Not yet reviewed");
    expect(s).not.toMatch(/late|overdue|pending|fail|missing/i);
  });
  it("says who confirmed and on what Phoenix day", () => {
    expect(markSentence({ at: "2026-10-08T18:00:00Z", by: "u", by_name: "Mia Manager" })).toBe("Confirmed by Mia Manager on Oct 8");
  });
  it("a circle's accessible name carries the carrier, the state and the action; a viewer is told it is view only", () => {
    expect(circleAriaLabel("GTO", null, true)).toBe("GTO: Not yet reviewed. Press to confirm.");
    expect(circleAriaLabel("GTO", { at: "2026-10-08T18:00:00Z", by: null, by_name: "Mia" }, true)).toMatch(/^GTO: Confirmed by Mia on Oct 8\. Press to clear/);
    expect(circleAriaLabel("GTO", null, false)).toMatch(/View only/);
  });
  it("an unknown level is 'Not set', never 0; a real value shows its percent", () => {
    expect(levelText(null)).toBe("Not set");
    expect(levelText({ pct: 0, source: null, effective_from: null, updated_at: null })).toBe("0%");
    expect(levelText({ pct: 82.5, source: null, effective_from: null, updated_at: null })).toBe("82.5%");
  });
});

describe("intake rules the screen can explain before a round trip", () => {
  it("names which of the five fields are missing", () => {
    expect(missingIntake(emptyProfile({ npn: "1234567", first_name: "A" }))).toEqual(["last_name", "email", "resident_state"]);
    expect(missingIntake(emptyProfile({ npn: "1234567", first_name: "A", last_name: "B", email: "a@b.co", resident_state: "AZ" }))).toEqual([]);
  });
  it("accepts 5-10 digits and keeps the leading zero as text; rejects anything else", () => {
    expect(npnProblem("0123456")).toBeNull();
    expect(npnProblem("")).toBeNull();
    expect(npnProblem("1234")).not.toBeNull();
    expect(npnProblem("12345678901")).not.toBeNull();
    expect(npnProblem("12-3456")).not.toBeNull();
    expect(npnProblem("12345a")).not.toBeNull();
  });
});

describe("writers report what really happened", () => {
  beforeEach(() => rpc.mockReset());
  it("sends the expected state with every mark so a stale screen is refused", async () => {
    rpc.mockResolvedValue({ data: { ok: true, confirmed: true, confirmed_at: "t" }, error: null });
    const r = await saveMark("a1", "gto", true, false);
    expect(rpc).toHaveBeenCalledWith("set_contract_review_mark", { p_agent_id: "a1", p_carrier_key: "gto", p_confirmed: true, p_expected: false });
    expect(r).toMatchObject({ ok: true, conflict: false, confirmed: true });
  });
  it("reports a conflict as a conflict carrying the truth, not as success or failure", async () => {
    rpc.mockResolvedValue({ data: { ok: false, conflict: true, confirmed: true, confirmed_at: "t" }, error: null });
    expect(await saveMark("a1", "gto", false, false)).toMatchObject({ ok: false, conflict: true, confirmed: true, error: null });
  });
  it("never reports success for a transport error, an empty reply or a refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await saveMark("a", "gto", true, false)).toMatchObject({ ok: false, error: "boom" });
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await saveMark("a", "gto", true, false)).ok).toBe(false);
    rpc.mockResolvedValue({ data: { ok: false }, error: null });
    expect((await saveMark("a", "gto", true, false)).ok).toBe(false);
  });
  it("a level write sends 'expect unset' for a person with no level, and the old value otherwise", async () => {
    rpc.mockResolvedValue({ data: { ok: true, pct: 80, changed: true }, error: null });
    await saveLevel("a1", 80, null);
    expect(rpc).toHaveBeenLastCalledWith("set_review_placement_level", { p_agent_id: "a1", p_pct: 80, p_expect_unset: true });
    await saveLevel("a1", 90, 80);
    expect(rpc).toHaveBeenLastCalledWith("set_review_placement_level", { p_agent_id: "a1", p_pct: 90, p_expected: 80 });
  });
  it("surfaces an NPN conflict with the other person's name instead of saving", async () => {
    rpc.mockResolvedValue({ data: { ok: false, conflict: "npn_in_use", field: "npn", other_name: "Ann Lee", error: "That NPN is already on another profile (Ann Lee)." }, error: null });
    const r = await saveProfileForAgent("a1", { npn: "0123456", first_name: "A", last_name: "B", email: "a@b.co", resident_state: "AZ" });
    expect(r).toMatchObject({ ok: false, conflict: "npn_in_use", otherName: "Ann Lee", field: "npn" });
  });
});
