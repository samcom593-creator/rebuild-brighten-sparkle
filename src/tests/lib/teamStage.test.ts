import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import {
  STAGE_UNSET_LABEL, accessSummary, bulkPreview, dateKeyLabel, expectedLabel, filterAttendance, parseAttendanceDay, parseTeamFacts,
  phoenixToday, shiftDateKey, stageLabel, statusLabel, workdaysSummary, type AttendancePerson,
} from "@/lib/teamStage";
import { OVER_5K, isOverFiveK, overFiveKTooltip, showOverFiveK } from "@/lib/overFiveK";

describe("stage labels", () => {
  it("uses the three exact labels and a visible 'not set'", () => {
    expect(stageLabel("online_training")).toBe("Online training");
    expect(stageLabel("training")).toBe("Training");
    expect(stageLabel("released_in_field")).toBe("Released in field");
    expect(stageLabel(null)).toBe(STAGE_UNSET_LABEL);
    expect(stageLabel("field")).toBe(STAGE_UNSET_LABEL);
  });
});

describe("weekday summary", () => {
  it("writes 'Mon, Wed, Fri · 3 days/week', sorted and de-duplicated", () => {
    expect(workdaysSummary([5, 1, 3, 1])).toBe("Mon, Wed, Fri · 3 days/week");
    expect(workdaysSummary([2])).toBe("Tue · 1 day/week");
  });
  it("tells 'not set' apart from 'no days'", () => {
    expect(workdaysSummary(null)).toBe("Schedule not set");
    expect(workdaysSummary(undefined)).toBe("Schedule not set");
    expect(workdaysSummary([])).toBe("No scheduled days");
  });
  it("ignores weekend numbers it is never given", () => {
    expect(workdaysSummary([6, 7, 1])).toBe("Mon · 1 day/week");
  });
});

describe("reads refuse a failed or short payload", () => {
  const person = (over: Record<string, unknown> = {}) => ({ agent_id: "a", stage: "training", stage_label: "Training", stage_source: "staff", schedule_set: true, weekdays: [1, 2], next_schedule: null, access: { has_login: false, invitation: "pending" }, ...over });
  it("team facts: not ok, missing counts, or a count that disagrees with the list all throw", () => {
    expect(() => parseTeamFacts(null)).toThrow();
    expect(() => parseTeamFacts({ ok: false, people: [], counts: { people: 0 } })).toThrow();
    expect(() => parseTeamFacts({ ok: true, people: [person()], counts: { people: 2, stage_unset: 0, schedule_unset: 0 } })).toThrow(/cut short/);
    const f = parseTeamFacts({ ok: true, as_of: "2026-10-09", people: [person({ stage: "bogus", weekdays: "x", access: {} })], counts: { people: 1, stage_unset: 0, schedule_unset: 0 } });
    expect(f.people[0].stage).toBeNull();
    expect(f.people[0].weekdays).toBeNull();
    expect(f.people[0].access).toEqual({ has_login: false, invitation: "none" });
  });
  it("attendance: the same rules, and unknown statuses never become Present", () => {
    expect(() => parseAttendanceDay({ ok: true })).toThrow();
    expect(() => parseAttendanceDay({ ok: true, date: "2026-10-09", people: [], summary: { total: 1 } })).toThrow(/cut short/);
    const d = parseAttendanceDay({ ok: true, date: "2026-10-09", is_today: true, weekday: 5, people: [{ agent_id: "a", display_name: "A", email: null, stage: null, stage_label: null, expected: "maybe", weekdays: null, status: "late", marked_by_name: null, marked_at: null, note: null }], summary: { total: 1, expected: 0, present: 0, absent: 0, excused: 0, unmarked: 0, not_scheduled: 0, schedule_not_set: 1 } });
    expect(d.people[0].status).toBe("unmarked");
    expect(d.people[0].expected).toBe("unknown");
  });
});

describe("access summary never claims more than the record shows", () => {
  it("distinguishes signed in, pending, accepted-but-never-signed-in, expired, revoked and none", () => {
    expect(accessSummary({ has_login: true, invitation: "none" }).text).toBe("Signed in before");
    expect(accessSummary({ has_login: false, invitation: "pending" })).toEqual({ text: "Invitation pending", tone: "wait" });
    expect(accessSummary({ has_login: false, invitation: "accepted" }).text).toMatch(/no sign-in yet/);
    expect(accessSummary({ has_login: false, invitation: "expired" }).tone).toBe("off");
    expect(accessSummary({ has_login: false, invitation: "revoked" }).tone).toBe("off");
    expect(accessSummary({ has_login: false, invitation: "none" }).text).toBe("No login yet");
  });
});

describe("attendance words, dates and filters", () => {
  const p = (over: Partial<AttendancePerson>): AttendancePerson => ({ agent_id: "x", display_name: "X", email: null, stage: null, stage_label: null, expected: "yes", weekdays: [1], status: "unmarked", marked_by_name: null, marked_at: null, note: null, ...over });
  it("labels", () => {
    expect(expectedLabel("yes")).toBe("Expected"); expect(expectedLabel("no")).toBe("Not scheduled"); expect(expectedLabel("unknown")).toBe("Schedule not set");
    expect(statusLabel("unmarked")).toBe("Unmarked"); expect(statusLabel("excused")).toBe("Excused");
  });
  it("Phoenix today, no daylight saving: 06:59 UTC is still yesterday in Phoenix", () => {
    expect(phoenixToday(new Date("2026-10-10T06:59:00Z"))).toBe("2026-10-09");
    expect(phoenixToday(new Date("2026-10-10T07:00:00Z"))).toBe("2026-10-10");
    expect(shiftDateKey("2026-10-01", -1)).toBe("2026-09-30");
    expect(dateKeyLabel("2026-10-09")).toBe("Friday, Oct 9, 2026");
  });
  it("filters by stage (including 'not set'), by search and by expected", () => {
    const people = [p({ agent_id: "a", display_name: "Ann", stage: "training" }), p({ agent_id: "b", display_name: "Bo", stage: null, expected: "no" }), p({ agent_id: "c", display_name: "Cy", stage: "released_in_field", email: "cy@x.test" })];
    expect(filterAttendance(people, "training", "", false).map((x) => x.agent_id)).toEqual(["a"]);
    expect(filterAttendance(people, "unset", "", false).map((x) => x.agent_id)).toEqual(["b"]);
    expect(filterAttendance(people, "all", "cy@", false).map((x) => x.agent_id)).toEqual(["c"]);
    expect(filterAttendance(people, "all", "", true).map((x) => x.agent_id)).toEqual(["a", "c"]);
  });
  it("a bulk preview says who changes, who is left alone and who is not expected, and writes nothing", () => {
    const people = [p({ agent_id: "a" }), p({ agent_id: "b", status: "present" }), p({ agent_id: "c", expected: "no" })];
    const pv = bulkPreview(people, new Set(["a", "b", "c", "zzz"]));
    expect(pv.willChange.map((x) => x.agent_id)).toEqual(["a", "c"]);
    expect(pv.alreadyMarked.map((x) => x.agent_id)).toEqual(["b"]);
    expect(pv.notExpected.map((x) => x.agent_id)).toEqual(["c"]);
  });
});

describe("Over $5K badge", () => {
  it("is strictly over: exactly $5,000 is not over, $5,000.01 is", () => {
    expect(isOverFiveK(5000)).toBe(false);
    expect(isOverFiveK(5000.01)).toBe(true);
    expect(isOverFiveK(4999.99)).toBe(false);
  });
  it("unknown is unknown, never false-as-zero", () => {
    expect(isOverFiveK(null)).toBeNull(); expect(isOverFiveK(undefined)).toBeNull(); expect(isOverFiveK(Number.NaN)).toBeNull();
  });
  it("stays off until the metric, period, scope and reversal handling are all defined; then its tooltip states them", () => {
    expect(OVER_5K.active).toBe(false);
    expect(overFiveKTooltip()).toBeNull();
    expect(showOverFiveK(9999)).toBe(false);
    const on = { active: true, metric: "alp" as const, period: "month_to_date" as const, scope: "personal" as const, reversals: "subtract" as const };
    expect(overFiveKTooltip(on)).toBe("Over $5,000 ALP this month, personal production, reversals subtracted.");
    expect(showOverFiveK(5001, on)).toBe(true);
    expect(showOverFiveK(5000, on)).toBe(false);
    expect(showOverFiveK(null, on)).toBe(false);
    expect(overFiveKTooltip({ ...on, period: null })).toBeNull();
  });
});
