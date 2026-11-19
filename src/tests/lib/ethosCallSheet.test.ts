import { describe, expect, it } from "vitest";
import {
  callAngle,
  groupOf,
  laneOf,
  parseEthosExport,
  sortForLane,
  tenureLabel,
  type EthosCallSheetRow,
} from "@/lib/ethosCallSheet";

const NOW = Date.parse("2026-11-19T18:00:00Z");

function person(overrides: Partial<EthosCallSheetRow> = {}): EthosCallSheetRow {
  return {
    id: overrides.id ?? overrides.full_name ?? "p",
    full_name: "Test Person",
    npn: "1",
    phone: "6025550100",
    email: null,
    comp_level: null,
    sub_agency: null,
    manager_name: null,
    first_seen_on: null,
    first_seen_source: null,
    issued_premium: 0,
    inforce_premium: 0,
    persistency_4m: null,
    persistency_7m: null,
    persistency_13m: null,
    chargeback_total: null,
    chargeback_personal: null,
    snapshot_on: "2026-11-19",
    on_ethos: true,
    contracts_total: 0,
    contracts_active: 0,
    active_carriers: null,
    al_last_active_at: null,
    stage: null,
    in_app: false,
    standing: null,
    license: null,
    has_login: null,
    last_sign_in_at: null,
    lifetime_ap: null,
    last_deal_on: null,
    deals_30d: null,
    last_outcome: null,
    last_reason: null,
    last_note: null,
    follow_up_on: null,
    last_called_at: null,
    last_called_by: null,
    calls: 0,
    ...overrides,
  };
}

describe("laneOf", () => {
  it("puts a contract holder with nothing in force and no call yet in Call now", () => {
    expect(laneOf(person())).toBe("call_now");
    expect(laneOf(person({ issued_premium: 1653.96, inforce_premium: 0 }))).toBe("call_now");
  });

  it("keeps someone with Ethos premium in force out of the call list until they are called", () => {
    expect(laneOf(person({ issued_premium: 918, inforce_premium: 918 }))).toBe("selling");
  });

  it("treats a deal in the last 30 days as already selling, with or without Ethos premium", () => {
    expect(laneOf(person({ on_ethos: false, deals_30d: 2 }))).toBe("selling");
    expect(laneOf(person({ on_ethos: false, deals_30d: 0 }))).toBe("call_now");
  });

  it("sets a terminated person apart instead of asking for a call", () => {
    expect(laneOf(person({ standing: "terminated" }))).toBe("left");
    expect(laneOf(person({ standing: "terminated", inforce_premium: 3274 }))).toBe("left");
  });

  it("lets the last call result decide once a call is logged", () => {
    expect(laneOf(person({ last_outcome: "no_answer" }))).toBe("follow_up");
    expect(laneOf(person({ last_outcome: "voicemail" }))).toBe("follow_up");
    expect(laneOf(person({ last_outcome: "texted" }))).toBe("follow_up");
    expect(laneOf(person({ last_outcome: "callback" }))).toBe("follow_up");
    expect(laneOf(person({ last_outcome: "coming_back" }))).toBe("coming_back");
    expect(laneOf(person({ last_outcome: "needs_help" }))).toBe("needs_action");
    expect(laneOf(person({ last_outcome: "wrong_number" }))).toBe("needs_action");
    expect(laneOf(person({ last_outcome: "not_interested" }))).toBe("closed");
    // A logged result outranks the terminated flag and in-force premium: the conversation is newer.
    expect(laneOf(person({ last_outcome: "coming_back", standing: "terminated", inforce_premium: 500 }))).toBe("coming_back");
  });
});

describe("callAngle", () => {
  it("ranks someone who wrote Ethos business that did not stick as the easiest pick", () => {
    const angle = callAngle(person({ issued_premium: 1653.96, inforce_premium: 0 }), NOW);
    expect(angle.tier).toBe(1);
    expect(angle.text).toContain("$1,654");
  });

  it("ranks a producer in this app with no Ethos business second", () => {
    expect(callAngle(person({ lifetime_ap: 12000 }), NOW).tier).toBe(2);
  });

  it("ranks a recent sign-in third and a silent contract holder last", () => {
    expect(callAngle(person({ last_sign_in_at: "2026-11-10T00:00:00Z" }), NOW).tier).toBe(3);
    expect(callAngle(person({ last_sign_in_at: "2026-08-01T00:00:00Z" }), NOW).tier).toBe(4);
    expect(callAngle(person(), NOW).tier).toBe(4);
  });
});

describe("groupOf", () => {
  it("puts Ethos first, then carrier contracts, then licensed, then everyone else", () => {
    expect(groupOf(person({ on_ethos: true }))).toBe(1);
    expect(groupOf(person({ on_ethos: true, contracts_active: 9 }))).toBe(1);
    expect(groupOf(person({ on_ethos: false, contracts_active: 3 }))).toBe(2);
    expect(groupOf(person({ on_ethos: false, license: "licensed" }))).toBe(3);
    expect(groupOf(person({ on_ethos: false, license: "unlicensed" }))).toBe(4);
    expect(groupOf(person({ on_ethos: false }))).toBe(4);
  });

  it("words the reason to call by group", () => {
    expect(callAngle(person({ on_ethos: false, contracts_active: 1, lifetime_ap: 8000 }), NOW).text).toBe("1 active carrier contract, sold $8,000 here");
    expect(callAngle(person({ on_ethos: false, contracts_active: 4 }), NOW).text).toBe("4 active carrier contracts, never sold here");
    expect(callAngle(person({ on_ethos: false, license: "licensed" }), NOW).text).toBe("Licensed, no active carrier contract, never sold here");
    expect(callAngle(person({ on_ethos: false }), NOW).text).toBe("Not licensed yet");
  });
});

describe("sortForLane", () => {
  it("never lets a carrier-contracted or licensed agent outrank an Ethos contract holder", () => {
    const rows = [
      person({ full_name: "Unlicensed", on_ethos: false }),
      person({ full_name: "Licensed producer", on_ethos: false, license: "licensed", lifetime_ap: 90000 }),
      person({ full_name: "Contracted producer", on_ethos: false, contracts_active: 6, lifetime_ap: 50000 }),
      person({ full_name: "Ethos never sold" }),
      person({ full_name: "Ethos wrote", issued_premium: 1142.4 }),
    ];
    expect(sortForLane(rows, "call_now", NOW).map((r) => r.full_name)).toEqual([
      "Ethos wrote",
      "Ethos never sold",
      "Contracted producer",
      "Licensed producer",
      "Unlicensed",
    ]);
  });

  it("orders the call list easiest pick first", () => {
    const rows = [
      person({ full_name: "Silent" }),
      person({ full_name: "Recent", last_sign_in_at: "2026-11-15T00:00:00Z" }),
      person({ full_name: "Producer", lifetime_ap: 5000 }),
      person({ full_name: "Wrote", issued_premium: 1142.4 }),
    ];
    expect(sortForLane(rows, "call_now", NOW).map((r) => r.full_name)).toEqual(["Wrote", "Producer", "Recent", "Silent"]);
  });

  it("orders follow-ups by the date promised, undated ones last and oldest attempt first", () => {
    const rows = [
      person({ full_name: "Undated new", last_outcome: "no_answer", last_called_at: "2026-11-19T10:00:00Z" }),
      person({ full_name: "Undated old", last_outcome: "no_answer", last_called_at: "2026-11-17T10:00:00Z" }),
      person({ full_name: "Friday", last_outcome: "callback", follow_up_on: "2026-11-20" }),
      person({ full_name: "Next week", last_outcome: "callback", follow_up_on: "2026-11-25" }),
    ];
    expect(sortForLane(rows, "follow_up", NOW).map((r) => r.full_name)).toEqual(["Friday", "Next week", "Undated old", "Undated new"]);
  });
});

describe("tenureLabel", () => {
  it("reads the time with us in the largest sensible unit", () => {
    expect(tenureLabel("2026-11-14", NOW)).toBe("5 d");
    expect(tenureLabel("2026-10-20", NOW)).toBe("4 wk");
    expect(tenureLabel("2026-03-30", NOW)).toBe("7 mo");
    expect(tenureLabel("2025-08-19", NOW)).toBe("1 yr 3 mo");
  });

  it("says nothing when the start date is unknown or in the future", () => {
    expect(tenureLabel(null, NOW)).toBe("");
    expect(tenureLabel("2027-01-01", NOW)).toBe("");
  });
});

describe("parseEthosExport", () => {
  const HEADER = "Name,NPN,Issued Premium,In-Force Issued Premium,Persistency - 4M,Persistency - 7M,Persistency - 13M,Chargeback - Total Created,Chargeback - Personal";

  it("reads the portal export, turning dashes into blanks", () => {
    const parsed = parseEthosExport([
      HEADER,
      "Billy Kalonji,22181690,1653.96,0,-,-,-,33.5,33.5",
      "Jahiem House,20576099,0,0,-,1.0000,0.6000,0,-",
      "Ramon Lopez,,0,0,-,-,-,-,-",
      "",
    ].join("\n"));
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toEqual([
      { name: "Billy Kalonji", npn: "22181690", issued: "1653.96", inforce: "0", p4: "", p7: "", p13: "", cb_total: "33.5", cb_personal: "33.5" },
      { name: "Jahiem House", npn: "20576099", issued: "0", inforce: "0", p4: "", p7: "1.0000", p13: "0.6000", cb_total: "0", cb_personal: "" },
      { name: "Ramon Lopez", npn: "", issued: "0", inforce: "0", p4: "", p7: "", p13: "", cb_total: "", cb_personal: "" },
    ]);
  });

  it("handles quoted names, money formatting, a byte-order mark and Windows line endings", () => {
    const parsed = parseEthosExport(`﻿${HEADER}\r\n"Smith, Jr., Al",123,"$1,200.50",900,-,-,-,-,-\r\n`);
    expect(parsed.error).toBeNull();
    expect(parsed.rows[0]).toMatchObject({ name: "Smith, Jr., Al", npn: "123", issued: "1200.50", inforce: "900" });
  });

  it("refuses a file that is not the performance export", () => {
    expect(parseEthosExport("First,Last,Email\nA,B,c@d.com").error).toMatch(/not the Ethos hierarchy performance export/);
    expect(parseEthosExport("").error).toBe("That file has no rows.");
    expect(parseEthosExport(HEADER).error).toBe("That file has no rows.");
  });
});
