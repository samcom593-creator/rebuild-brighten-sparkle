import { describe, expect, it } from "vitest";
import {
  basisShortLabel, compareByUrgency, contractingSummary, ensureCompleteRead, followupLine, formatDay, indexPeople, matchesContractingFilter,
  msUntilNextPhoenixMidnight, nextActionFor, plural, priorityOne, reasonSentence,
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

describe("formatDay", () => {
  it("formats a calendar date without shifting it a day", () => {
    expect(formatDay("2026-10-12")).toBe("Oct 12");
    expect(formatDay("2026-01-01")).toBe("Jan 1");
    expect(formatDay("2026-12-31")).toBe("Dec 31");
  });
  it("hands back anything that is not a plain date instead of inventing one", () => {
    expect(formatDay(null)).toBe("");
    expect(formatDay("soon")).toBe("soon");
    expect(formatDay("2026-13-40")).toBe("2026-13-40");
  });
});

describe("compareByUrgency", () => {
  const soon = (id: string, days: number) => person({ agent_id: id, p1: false, p1_rank: null, due_soon: true, milestones: [ms("aflac", "due_soon", { days_until_overdue: days })] });
  const open = person({ agent_id: "open", p1: false, p1_rank: null, milestones: [ms("aflac", "not_due_yet")] });
  const done = person({ agent_id: "done", p1: false, p1_rank: null, milestones: [ms("aflac", "done")] });
  const review = person({ agent_id: "review", p1: false, p1_rank: null, needs_review: true, milestones: [ms("aflac", "unknown")] });
  const na = person({ agent_id: "na", p1: false, p1_rank: null, milestones: [ms("aflac", "not_applicable")] });

  it("orders Priority 1, due soon, review, open, then done and outside contracting, then people with no record", () => {
    const list = [undefined, done, open, review, soon("s1", 2), person({ agent_id: "p1b", p1_rank: 2 }), person({ agent_id: "p1a", p1_rank: 1 }), na];
    const ids = list.sort(compareByUrgency).map((p) => p?.agent_id ?? "none");
    expect(ids.slice(0, 2)).toEqual(["p1a", "p1b"]);
    expect(ids[2]).toBe("s1");
    expect(ids[3]).toBe("review");
    expect(ids[4]).toBe("open");
    expect(ids.slice(5, 7).sort()).toEqual(["done", "na"]);
    expect(ids[7]).toBe("none");
  });
  it("puts the soonest deadline first inside due soon and ties return 0", () => {
    expect(compareByUrgency(soon("a", 1), soon("b", 3))).toBeLessThan(0);
    expect(compareByUrgency(soon("a", 3), soon("b", 1))).toBeGreaterThan(0);
    expect(compareByUrgency(open, open)).toBe(0);
  });
  it("is a stable total order once a name tie-break is added", () => {
    const people = ["Zed", "Amy", "Bob"].map((n, i) => person({ agent_id: `x${i}`, display_name: n, p1: false, p1_rank: null, milestones: [ms("aflac", "not_due_yet")] }));
    const sorted = [...people].sort((a, b) => compareByUrgency(a, b) || a.display_name.localeCompare(b.display_name)).map((p) => p.display_name);
    expect(sorted).toEqual(["Amy", "Bob", "Zed"]);
  });
});

describe("contractingSummary", () => {
  it("is none when there is no person or nothing applies", () => {
    expect(contractingSummary(undefined)).toEqual({ kind: "none" });
    expect(contractingSummary(person({ milestones: [] }))).toEqual({ kind: "none" });
    expect(contractingSummary(person({ milestones: [ms("aflac", "not_applicable"), ms("ethos", "not_applicable")] }))).toEqual({ kind: "none" });
  });
  it("is all_done only when every applicable milestone is done", () => {
    expect(contractingSummary(person({ milestones: [ms("aflac", "done"), ms("ethos", "done"), ms("agentlink", "not_applicable")] }))).toEqual({ kind: "all_done", total: 2 });
  });
  it("splits overdue and due soon from the quietly open ones and counts what is done", () => {
    const s = contractingSummary(person({ milestones: [ms("aflac", "overdue"), ms("ethos", "due_soon"), ms("first_contract", "policy_pending"), ms("agentlink", "done")] }));
    expect(s.kind).toBe("open");
    if (s.kind === "open") {
      expect(s.urgent.map((m) => m.key)).toEqual(["aflac", "ethos"]);
      expect(s.quiet.map((m) => m.key)).toEqual(["first_contract"]);
      expect(s.done).toBe(1);
      expect(s.total).toBe(4);
    }
  });
});

describe("followupLine", () => {
  const f = (o: Partial<TeamPerson["followup"]>) => ({ ...person().followup, ...o });
  it("says nothing when there is nothing left to chase", () => {
    expect(followupLine(undefined)).toBeNull();
    expect(followupLine(person({ milestones: [ms("aflac", "done")] }))).toBeNull();
  });
  it("flags a missing follow-up only for overdue or due-soon people", () => {
    expect(followupLine(person({ followup: f({ next_on: null }) }))).toEqual({ text: "No follow-up set", tone: "urgent" });
    expect(followupLine(person({ p1: false, due_soon: true, milestones: [ms("aflac", "due_soon")], followup: f({ next_on: null }) }))).toEqual({ text: "No follow-up set", tone: "warn" });
    expect(followupLine(person({ p1: false, milestones: [ms("aflac", "not_due_yet")], followup: f({ next_on: null }) }))).toBeNull();
  });
  it("shows a due date as urgent and a future date as a plan that does not clear the overdue milestone", () => {
    expect(followupLine(person({ followup: f({ next_on: "2026-10-08", due_now: true }) }))).toEqual({ text: "Follow-up due Oct 8", tone: "urgent" });
    const planned = person({ followup: f({ next_on: "2026-10-12", due_now: false }) });
    expect(followupLine(planned)).toEqual({ text: "Follow-up Oct 12", tone: "normal" });
    expect(planned.p1).toBe(true); // a reminder for later does not make the overdue person any less overdue
  });
});

describe("ensureCompleteRead", () => {
  it("passes short reads, nulls and empty reads", () => {
    expect(() => ensureCompleteRead("roster", Array(999).fill(0))).not.toThrow();
    expect(() => ensureCompleteRead("roster", [])).not.toThrow();
    expect(() => ensureCompleteRead("roster", null)).not.toThrow();
  });
  it("refuses a read that stops exactly at the page limit so it can never look like a complete roster", () => {
    expect(() => ensureCompleteRead("roster", Array(1000).fill(0))).toThrow(/may be incomplete/);
    expect(() => ensureCompleteRead("roster", Array(1200).fill(0))).toThrow(/roster returned 1200 rows/);
    expect(() => ensureCompleteRead("roster", Array(50).fill(0), 50)).toThrow();
  });
});
