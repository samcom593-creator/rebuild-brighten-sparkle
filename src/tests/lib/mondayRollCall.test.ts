import { describe, expect, it, vi } from "vitest";
import {
  hiredLabel,
  interviewLine,
  leadsLine,
  linkLine,
  sentLinkNoProduction,
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
    const missed = row({ agent_id: "m", name: "Missed", how_hired: "self_enrolled", interview_state: "missed", interview_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), hired_at: "2026-11-01T00:00:00Z", this_week: false });
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

  it("people with nothing special about them are listed newest hire first", () => {
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
    expect(s).toEqual({ total: 6, confirmed: 1, toCall: 2, cantMake: 1, showed: 1, noShow: 1, notInterviewed: 1, noLeadsYet: 3, linkNoProduction: 0 });
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

describe("mondayRollCall: people who were sent the link and are not producing come first", () => {
  const linked = (over: Partial<RollCallRow> = {}) =>
    row({ producing: false, via_hire_link: true, link_sent_at: "2026-11-20T17:00:00Z", link_opened_at: null, contracts_on_file: 0, ...over });

  it("knows who they are: no production, and a hire link, an emailed link or an opened link", () => {
    expect(sentLinkNoProduction(linked())).toBe(true);
    expect(sentLinkNoProduction(linked({ via_hire_link: false }))).toBe(true);
    expect(sentLinkNoProduction(linked({ via_hire_link: false, link_sent_at: null, link_opened_at: "2026-11-13T00:00:00Z" }))).toBe(true);
    expect(sentLinkNoProduction(linked({ via_hire_link: false, link_sent_at: null }))).toBe(false);
    expect(sentLinkNoProduction(linked({ producing: true }))).toBe(false);
    // a payload from before the fields existed prioritizes nobody
    expect(sentLinkNoProduction(row())).toBe(false);
  });

  it("a licensed one outranks an interview still to hold and an ordinary recent hire, but not a missed interview", () => {
    const order = sortRollCall([
      row({ agent_id: "plain", hired_at: "2026-11-22T00:00:00Z" }),
      row({ agent_id: "upcoming", interview_state: "upcoming" }),
      linked({ agent_id: "link", hired_at: "2026-09-01T00:00:00Z", this_week: false }),
      row({ agent_id: "missed", interview_state: "missed" }),
    ]).map((r) => r.agent_id);
    expect(order).toEqual(["missed", "link", "upcoming", "plain"]);
  });

  it("an unlicensed one sits below the licensed group and above ordinary rows", () => {
    const order = sortRollCall([
      row({ agent_id: "plain" }),
      linked({ agent_id: "unlicensed", licensed: false, license_step: "course_started" }),
      linked({ agent_id: "licensed" }),
    ]).map((r) => r.agent_id);
    expect(order).toEqual(["licensed", "unlicensed", "plain"]);
  });

  it("inside the group the most recent sign-in is first, never-signed-in last", () => {
    const order = sortRollCall([
      linked({ agent_id: "never", last_sign_in_at: null, hired_at: "2026-11-22T00:00:00Z" }),
      linked({ agent_id: "old", last_sign_in_at: "2026-09-01T00:00:00Z" }),
      linked({ agent_id: "fresh", last_sign_in_at: "2026-11-22T10:00:00Z", hired_at: "2026-08-01T00:00:00Z" }),
    ]).map((r) => r.agent_id);
    expect(order).toEqual(["fresh", "old", "never"]);
  });

  it("someone already confirmed or already producing no longer leads the list", () => {
    expect(rollCallRank(linked({ mark: "confirmed" }))).toBeGreaterThan(rollCallRank(row()));
    expect(rollCallRank(linked({ producing: true }))).toBe(rollCallRank(row()));
  });

  it("says where each one stands on the link", () => {
    expect(linkLine(linked())).toBe("Contracting link emailed Nov 20, not opened · no carrier contract on file · no production yet");
    expect(linkLine(linked({ link_opened_at: "2026-11-13T18:00:00Z", contracts_on_file: 1 }))).toBe("Contracting link opened Nov 13 · 1 carrier contract on file · no production yet");
    expect(linkLine(linked({ link_sent_at: null, contracts_on_file: 4 }))).toBe("Joined through the hire link · 4 carrier contracts on file · no production yet");
    expect(linkLine(linked({ licensed: false }))).toBe("Joined through the hire link · not licensed yet");
    expect(linkLine(linked({ producing: true }))).toBeNull();
    expect(linkLine(row())).toBeNull();
  });

  it("the header counts them", () => {
    expect(summarize([linked(), linked({ licensed: false }), row(), linked({ producing: true })]).linkNoProduction).toBe(2);
  });
});

describe("mondayRollCall: an old missed interview does not outrank this week's people", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  it("a call missed two days ago leads; one missed six weeks ago falls back into the ordinary order", () => {
    expect(rollCallRank(row({ interview_state: "missed", interview_at: daysAgo(2) }))).toBe(0);
    expect(rollCallRank(row({ interview_state: "missed", interview_at: daysAgo(44) }))).toBeGreaterThan(0);
    // no time on file: treat it as recent rather than bury someone who may be waiting
    expect(rollCallRank(row({ interview_state: "missed", interview_at: null }))).toBe(0);
  });

  it("an old missed interview on a licensed link person ranks with the link group", () => {
    const old = row({ interview_state: "missed", interview_at: daysAgo(44), producing: false, link_sent_at: daysAgo(3) });
    expect(rollCallRank(old)).toBe(1);
  });

  it("the new lead-standing words read plainly", () => {
    expect(leadsLine(row({ leads_state: "ready" }))).toBe("Gets 25 leads at the next hourly run");
    expect(leadsLine(row({ leads_state: "has_leads" }))).toBe("Holds leads");
    expect(leadsLine(row({ leads_state: "no_login" }))).toBe("No leads: no portal login");
  });
});
