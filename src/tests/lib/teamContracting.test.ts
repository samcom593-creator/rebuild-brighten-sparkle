import { describe, expect, it } from "vitest";
import {
  basisShortLabel, indexPeople, matchesContractingFilter, msUntilNextPhoenixMidnight, nextActionFor, plural, priorityOne, reasonSentence,
  type Milestone, type TeamPerson,
} from "@/lib/teamContracting";

const ms = (key: string, state: Milestone["state"], o: Partial<Milestone> = {}): Milestone => ({
  key, label: key, state, done: state === "done", checked_at: null, checked_by_name: null, days_late: null, days_until_overdue: null,
  amber_day: 3, deadline_day: 3, red_day: 4, ...o,
});
const person = (o: Partial<TeamPerson> = {}): TeamPerson => ({
  agent_id: "a", alias_ids: [], display_name: "Ann Lee", manager_id: null, manager_name: "Sam", license_status: "licensed", eligibility: "eligible",
  needs_review: false, license_review: false, review_reason: null,
  start: { date: "2026-10-01", validity: "ok", elapsed_days: 6 },
  milestones: [ms("aflac", "overdue", { days_late: 3 }), ms("ethos", "overdue", { days_late: 3 }), ms("first_contract", "overdue", { days_late: 1 }), ms("agentlink", "done")],
  p1: true, p1_rank: 1, due_soon: false, max_days_late: 3, overdue_keys: ["aflac", "ethos", "first_contract"], due_soon_keys: [], overdue_labels: "aflac, ethos and first_contract",
  followup: { last_at: null, last_outcome: null, call_count: 0, next_on: null, next_action: null, waiting_on: null, blocker: null, due_now: true },
  owner: { user_id: null, name: "Sam", source: "manager" },
  ...o,
});

describe("contracting filters", () => {
  const p1 = person();
  const soon = person({ agent_id: "b", p1: false, due_soon: true, milestones: [ms("aflac", "due_soon", { days_until_overdue: 1 })] });
  const review = person({ agent_id: "c", p1: false, needs_review: true, milestones: [ms("aflac", "unknown")] });
  const fine = person({ agent_id: "d", p1: false, milestones: [ms("aflac", "done")] });
  const licence = person({ agent_id: "e", p1: false, eligibility: "license_conflict", license_review: true, milestones: [ms("aflac", "not_applicable")] });

  it("Priority 1 means at least one overdue milestone, and a milestone filter narrows it", () => {
    expect(matchesContractingFilter(p1, "p1")).toBe(true);
    expect(matchesContractingFilter(p1, "p1", "agentlink")).toBe(false); // agentlink is done
    expect(matchesContractingFilter(p1, "p1", "ethos")).toBe(true);
    expect(matchesContractingFilter(soon, "p1")).toBe(false);
  });
  it("Due soon, timing review and all-eligible are separate sets", () => {
    expect(matchesContractingFilter(soon, "due_soon")).toBe(true);
    expect(matchesContractingFilter(p1, "due_soon")).toBe(false);
    expect(matchesContractingFilter(review, "timing_review")).toBe(true);
    expect(matchesContractingFilter(licence, "timing_review")).toBe(false); // a licence question is not a timing question
    expect(matchesContractingFilter(licence, "eligible")).toBe(false);
    expect(matchesContractingFilter(fine, "eligible")).toBe(true);
    expect(matchesContractingFilter(fine, "all")).toBe(true);
  });
});

describe("priority section", () => {
  it("counts one person once however many milestones are late, and keeps the server's order", () => {
    const list = priorityOne([person({ agent_id: "x", p1_rank: 3 }), person({ agent_id: "y", p1_rank: 1 }), person({ agent_id: "z", p1: false, p1_rank: null }), person({ agent_id: "w", p1_rank: 2 })]);
    expect(list.map((p) => p.agent_id)).toEqual(["y", "w", "x"]);
    expect(person().overdue_keys).toHaveLength(3); // three reasons, still one entry above
  });
  it("writes the reason as plain language with the clock source and the days past the deadline", () => {
    const s = reasonSentence(person({ overdue_labels: "Aflac and Ethos" }), basisShortLabel("hired"));
    expect(s).toBe("Aflac and Ethos overdue · 6 days since hired · 3 days past the deadline");
  });
  it("uses singular wording for one day", () => {
    expect(plural(1, "day")).toBe("1 day");
    expect(plural(0, "day")).toBe("0 days");
    expect(reasonSentence(person({ overdue_labels: "Aflac", max_days_late: 1, start: { date: "x", validity: "ok", elapsed_days: 1 } }), "hired")).toBe("Aflac overdue · 1 day since hired · 1 day past the deadline");
  });
});

describe("actions and lookups", () => {
  it("never offers a dead Call button when the phone is missing", () => {
    expect(nextActionFor(person(), true).kind).toBe("call");
    expect(nextActionFor(person(), false).kind).toBe("open_profile");
  });
  it("points at the blocker when someone other than the agent is holding it up", () => {
    const blocked = person({ followup: { ...person().followup, blocker: "carrier_issue", waiting_on: "carrier" } });
    expect(nextActionFor(blocked, true).kind).toBe("review_blocker");
    const agentSide = person({ followup: { ...person().followup, blocker: "missing_documents", waiting_on: "agent" } });
    expect(nextActionFor(agentSide, true).kind).toBe("call");
  });
  it("finds a person through a duplicate twin id as well as the canonical id", () => {
    const m = indexPeople([person({ agent_id: "canon", alias_ids: ["twin1", "twin2"] })]);
    expect(m.get("canon")?.display_name).toBe("Ann Lee");
    expect(m.get("twin1")?.agent_id).toBe("canon");
    expect(m.get("twin2")?.agent_id).toBe("canon");
    expect(m.get("other")).toBeUndefined();
  });
});

describe("Phoenix midnight timer", () => {
  it("is measured to Phoenix midnight (UTC-7, no daylight saving), not the viewer's midnight", () => {
    // 2026-10-09 06:59:00Z is 23:59 on Oct 8 in Phoenix: one minute to midnight.
    expect(msUntilNextPhoenixMidnight(new Date("2026-10-09T06:59:00Z"))).toBe(60_000);
    // 2026-10-09 07:00:00Z is exactly Phoenix midnight: the next one is a full day away.
    expect(msUntilNextPhoenixMidnight(new Date("2026-10-09T07:00:00Z"))).toBe(24 * 3600_000);
    // The same instant from a viewer in Tokyo or New York still resolves against Phoenix.
    expect(msUntilNextPhoenixMidnight(new Date("2026-07-01T20:00:00Z"))).toBe(11 * 3600_000);
  });
});
