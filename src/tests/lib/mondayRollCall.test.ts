import { describe, expect, it, vi } from "vitest";
import {
  hiredLabel,
  interviewLine,
  leadsLine,
  mondayLabel,
  needsList,
  notInterviewed,
  parseStates,
  phoenixWhen,
  rollCallRank,
  sortRollCall,
  summarize,
  type RollCallRow,
} from "@/lib/mondayRollCall";

function row(over: Partial<RollCallRow> = {}): RollCallRow {
  return {
    agent_id: "a1",
    name: "Pat Example",
    phone: "6025550100",
    email: "pat@example.invalid",
    hired_at: "2026-11-20T02:33:19Z",
    days_since_hire: 3,
    this_week: true,
    how_hired: "hire_link",
    interview_state: "hired_direct",
    interview_at: null,
    licensed: true,
    license_step: null,
    npn_on_file: true,
    npn_note: null,
    license_states: ["AZ"],
    phone_state_hint: null,
    leads_state: "ready",
    live_leads: 0,
    last_sign_in_at: "2026-11-20T02:33:20Z",
    manager_name: "Sam Example",
    stage: "onboarding",
    mark: null,
    mark_note: null,
    marked_at: null,
    marked_by: null,
    ...over,
  };
}

describe("mondayRollCall: who to call first", () => {
  it("an interview that was not held outranks everyone, even a newer hire", () => {
    const missed = row({ agent_id: "m", name: "Missed", how_hired: "self_enrolled", interview_state: "missed", hired_at: "2026-11-01T00:00:00Z", this_week: false });
    const fresh = row({ agent_id: "f", name: "Fresh", hired_at: "2026-11-22T00:00:00Z" });
    expect(sortRollCall([fresh, missed]).map((r) => r.agent_id)).toEqual(["m", "f"]);
  });

  it("confirmed people sink below people nobody has reached", () => {
    const confirmed = row({ agent_id: "c", mark: "confirmed", hired_at: "2026-11-22T00:00:00Z" });
    const open = row({ agent_id: "o", hired_at: "2026-10-20T00:00:00Z", this_week: false });
    expect(sortRollCall([confirmed, open]).map((r) => r.agent_id)).toEqual(["o", "c"]);
  });

  it("a missed interview that has since been confirmed no longer leads the list", () => {
    expect(rollCallRank(row({ interview_state: "missed", mark: "confirmed" }))).toBeGreaterThan(rollCallRank(row()));
  });

  it("this week's hires come before older ones, newest first inside a group", () => {
    const older = row({ agent_id: "old", this_week: false, hired_at: "2026-10-15T00:00:00Z" });
    const a = row({ agent_id: "a", hired_at: "2026-11-19T00:00:00Z" });
    const b = row({ agent_id: "b", hired_at: "2026-11-22T00:00:00Z" });
    expect(sortRollCall([older, a, b]).map((r) => r.agent_id)).toEqual(["b", "a", "old"]);
  });

  it("a no-show on the day is back near the top: that person needs a call", () => {
    expect(rollCallRank(row({ mark: "no_show" }))).toBeLessThan(rollCallRank(row({ mark: "confirmed" })));
  });
});

describe("mondayRollCall: what each person needs", () => {
  it("a complete licensed hire needs nothing", () => {
    expect(needsList(row())).toEqual([]);
  });

  it("names the missing state, the missing NPN with the hire's own reason, and a missing sign-in", () => {
    const needs = needsList(row({ license_states: null, npn_on_file: false, npn_note: "will send it after the call", last_sign_in_at: null }));
    expect(needs).toEqual(["Has not signed in", 'No NPN: "will send it after the call"', "License state not on file"]);
  });

  it("an unlicensed hire shows the licensing step, never an NPN or state gap", () => {
    expect(needsList(row({ licensed: false, license_step: "test_scheduled", npn_on_file: false, license_states: null }))).toEqual(["Exam booked"]);
  });

  it("says when there is no number to dial", () => {
    expect(needsList(row({ phone: null }))).toContain("No phone on file");
  });
});

describe("mondayRollCall: interview and leads wording", () => {
  it("a directly hired person has no interview line", () => {
    expect(interviewLine(row())).toBeNull();
    expect(notInterviewed(row())).toBe(false);
  });

  it("a missed interview states when it was, in Arizona time", () => {
    const line = interviewLine(row({ interview_state: "missed", interview_at: "2026-11-22T00:00:00Z" }));
    expect(line).toBe("Interview was Sat, Nov 21, 5:00 PM and no result was recorded");
  });

  it("an upcoming interview states when it is", () => {
    expect(interviewLine(row({ interview_state: "upcoming", interview_at: "2026-11-23T21:45:00Z" }))).toBe("Interview Mon, Nov 23, 2:45 PM");
  });

  it("leads in hand win over every reason", () => {
    expect(leadsLine(row({ live_leads: 25, leads_state: "license_state_unknown" }))).toBe("25 leads in My Leads");
  });

  it("each blocked reason names the thing that unblocks it", () => {
    expect(leadsLine(row({ leads_state: "license_state_unknown" }))).toBe("No leads until a license state is on file");
    expect(leadsLine(row({ leads_state: "not_interviewed_yet" }))).toBe("No leads until interviewed");
    expect(leadsLine(row({ leads_state: "not_signed_in_since_hire" }))).toBe("No leads until they sign in");
    expect(leadsLine(row({ leads_state: "not_licensed" }))).toBe("No leads until licensed");
  });

  it("a self-enrolled person is described as joined, not hired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T06:00:00Z"));
    try {
      expect(hiredLabel({ hired_at: "2026-11-21T20:30:00Z", how_hired: "self_enrolled" })).toBe("Joined yesterday from an application");
      expect(hiredLabel({ hired_at: "2026-11-23T04:27:00Z", how_hired: "hire_link" })).toBe("Hired 1h ago");
      expect(hiredLabel({ hired_at: "2026-11-20T02:33:00Z", how_hired: "added" })).toBe("Hired 3d ago");
      expect(hiredLabel({ hired_at: "2026-10-17T13:00:00Z", how_hired: "added" })).toBe("Hired Oct 17");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("mondayRollCall: header counts", () => {
  it("counts every row once and flags the gaps", () => {
    const s = summarize([
      row({ mark: "confirmed", live_leads: 25 }),
      row({ mark: "no_answer" }),
      row({ mark: "cant_make_it", licensed: false }),
      row({ interview_state: "missed" }),
      row({ mark: "showed", live_leads: 10 }),
      row({ mark: "no_show" }),
    ]);
    expect(s).toEqual({ total: 6, confirmed: 1, toCall: 2, cantMake: 1, showed: 1, noShow: 1, notInterviewed: 1, noLeadsYet: 3 });
    expect(s.confirmed + s.toCall + s.cantMake + s.showed + s.noShow).toBe(s.total);
  });
});

describe("mondayRollCall: small helpers", () => {
  it("reads two-letter states out of whatever was typed", () => {
    expect(parseStates("wi, mn")).toEqual(["WI", "MN"]);
    expect(parseStates("AZ AZ az")).toEqual(["AZ"]);
    expect(parseStates("Arizona")).toEqual([]);
    expect(parseStates("")).toEqual([]);
  });

  it("labels the Monday and survives a bad date", () => {
    expect(mondayLabel("2026-11-23")).toBe("Monday, Nov 23");
    expect(mondayLabel("")).toBe("Monday");
    expect(phoenixWhen(null)).toBe("");
    expect(phoenixWhen("not a date")).toBe("");
  });
});

describe("mondayRollCall: a number that cannot be dialed", () => {
  it("a country code kept and the last digit lost is a need, not a phone", () => {
    // What the hire link stored for an iPhone-autofilled "+1 (480) 555-0100" before 2026-11-22.
    const needs = needsList(row({ phone: "1480555010" }));
    expect(needs).toContain("Phone on file is missing a digit: get the right number");
    expect(needs).not.toContain("No phone on file");
  });
});
