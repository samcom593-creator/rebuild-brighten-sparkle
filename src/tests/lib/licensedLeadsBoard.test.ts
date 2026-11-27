import { describe, expect, it } from "vitest";
import {
  isCovered,
  isWaiting,
  leadsReplyLine,
  refillSentence,
  sliceLabel,
  summarizeBoard,
  waitingLabel,
  waitingRows,
  type LicensedLeadsRow,
} from "@/lib/licensedLeadsBoard";

function row(over: Partial<LicensedLeadsRow> = {}): LicensedLeadsRow {
  return {
    agent_id: "a1",
    name: "Pat Example",
    phone: "6025550100",
    phone_state_hint: null,
    last_sign_in_at: "2026-11-20T02:33:20Z",
    license_states: ["AZ"],
    state_source: "agents.license_states",
    new_leads: 25,
    live_leads: 25,
    reason: "has_leads",
    ...over,
  };
}

describe("licensedLeadsBoard: the refill sentence states the live mix (MP-LEAD-BLEND)", () => {
  const blend = [
    { source: "marketing", tiers: ["A", "B"], share: 0.4 },
    { source: "dialer", tiers: ["F"], share: 0.4 },
    { source: "dialer", tiers: ["C"], share: 0.2 },
  ];

  it("names every slice with its share and the recycle window", () => {
    const s = refillSentence({ blend, recycle_days: 5 });
    expect(s).toContain("40% Marketing A/B");
    expect(s).toContain("40% Dialer fresh (never called)");
    expect(s).toContain("20% Dialer lightly dialed");
    expect(s).toContain("untouched for 5 days go back to the pool");
  });

  it("falls back to the plain sentence when the payload carries no mix", () => {
    const s = refillSentence({ blend: null, recycle_days: null });
    expect(s).toBe("Everyone eligible is kept at 25 unworked leads matched to their state, refilled hourly through the day.");
    expect(refillSentence(undefined)).toBe(s);
  });

  it("drops zero-share slices and omits the recycle clause when recycling is off", () => {
    const s = refillSentence({ blend: [...blend, { source: "marketing", tiers: ["C"], share: 0 }], recycle_days: 0 });
    expect(s).not.toContain("Marketing C");
    expect(s).not.toContain("go back to the pool");
  });

  it("labels an unknown slice from its source and tiers, and prefers an explicit label", () => {
    expect(sliceLabel({ source: "winback", tiers: ["A", "B"], share: 0.5 })).toBe("winback A/B");
    expect(sliceLabel({ source: "dialer", tiers: ["F"], share: 0.5, label: "Never-called dialer" })).toBe("Never-called dialer");
    // tier order in the payload must not change the label
    expect(sliceLabel({ source: "marketing", tiers: ["B", "A"], share: 0.5 })).toBe("Marketing A/B");
  });
});

describe("licensedLeadsBoard: who is covered and who is waiting", () => {
  it("covered means unworked leads in hand, or eligible at the next run", () => {
    expect(isCovered(row())).toBe(true);
    expect(isCovered(row({ new_leads: 0, reason: "ready" }))).toBe(true);
    expect(isCovered(row({ new_leads: 0, reason: "license_state_unknown" }))).toBe(false);
  });

  it("waiting is only what a person can clear: a state, an interview, a login", () => {
    expect(isWaiting(row({ reason: "license_state_unknown" }))).toBe(true);
    expect(isWaiting(row({ reason: "not_interviewed_yet" }))).toBe(true);
    expect(isWaiting(row({ reason: "no_login" }))).toBe(true);
    expect(isWaiting(row({ reason: "suspended" }))).toBe(false);
    expect(isWaiting(row({ reason: "has_leads" }))).toBe(false);
  });

  it("every row lands in exactly one bucket", () => {
    const s = summarizeBoard([
      row(),
      row({ new_leads: 0, reason: "ready" }),
      row({ new_leads: 0, reason: "license_state_unknown" }),
      row({ new_leads: 0, reason: "license_state_unknown" }),
      row({ new_leads: 0, reason: "not_interviewed_yet" }),
      row({ new_leads: 0, reason: "no_login" }),
      row({ new_leads: 0, reason: "suspended" }),
      row({ new_leads: 0, reason: "login_banned" }),
    ]);
    expect(s).toEqual({ total: 8, covered: 2, waiting: 4, accessOff: 2, needState: 2, needInterview: 1 });
    expect(s.covered + s.waiting + s.accessOff).toBe(s.total);
  });

  it("a person waiting on a state is not counted covered because of old worked leads", () => {
    const s = summarizeBoard([row({ new_leads: 0, live_leads: 25, reason: "license_state_unknown" })]);
    expect(s.covered).toBe(0);
    expect(s.needState).toBe(1);
  });

  it("the call order is whoever signed in most recently, never-signed-in last", () => {
    const order = waitingRows([
      row({ agent_id: "never", name: "Never", last_sign_in_at: null, reason: "license_state_unknown" }),
      row({ agent_id: "old", name: "Old", last_sign_in_at: "2026-08-01T00:00:00Z", reason: "license_state_unknown" }),
      row({ agent_id: "new", name: "New", last_sign_in_at: "2026-11-22T00:00:00Z", reason: "not_interviewed_yet" }),
      row({ agent_id: "covered", name: "Covered" }),
    ]).map((r) => r.agent_id);
    expect(order).toEqual(["new", "old", "never"]);
  });

  it("labels each wait in plain words", () => {
    expect(waitingLabel("license_state_unknown")).toBe("No license state on file");
    expect(waitingLabel("not_interviewed_yet")).toBe("Not interviewed yet");
    expect(waitingLabel("no_login")).toBe("No portal login");
  });
});

describe("licensedLeadsBoard: what a save says about the leads", () => {
  it("a grant names the number", () => {
    expect(leadsReplyLine({ decision: "granted", leads: 25, reason: "25 leads in WI" })).toBe(" 25 leads are in their My Leads now.");
  });

  it("a skip names the thing still missing", () => {
    expect(leadsReplyLine({ decision: "skip", reason: "not_interviewed_yet" })).toBe(" No leads until they are marked interviewed.");
    expect(leadsReplyLine({ decision: "skip", reason: "has_leads" })).toBe(" They already hold leads.");
    expect(leadsReplyLine({ decision: "skip", reason: "only 2 clean tier A/B lead(s) in WY" })).toBe(" No leads granted: only 2 clean tier A/B lead(s) in WY.");
  });

  it("a failed grant says it will retry, and a save that did not touch leads says nothing", () => {
    expect(leadsReplyLine({ decision: "error", reason: "boom" })).toBe(" The leads did not grant; the next hourly run will retry.");
    expect(leadsReplyLine(null)).toBe("");
    expect(leadsReplyLine(undefined)).toBe("");
    expect(leadsReplyLine({})).toBe("");
  });
});
