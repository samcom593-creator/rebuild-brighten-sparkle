/**
 * My Team > Bring back (src/lib/bringBack.ts, MP-TEAM-BRING-BACK 2026-11-27): the parser refuses a read it cannot
 * trust, people Sam let go stay off until asked for, the state filter keeps "no state on file" as its own value,
 * contract holders come first, and the words say what is on file and nothing more.
 */
import { describe, expect, it } from "vitest";
import {
  BRING_BACK_GROUPS, bringBackCounts, bringBackRows, bringBackStateOptions, carriersLine, compareBringBack, daysSinceKey, ethosLine,
  lastCallLine, matchesBringBack, parseBringBack, parseBringBackFilters, quietLine, soldLine, type BringBackPerson,
} from "@/lib/bringBack";

const TODAY = "2026-11-27";
const person = (o: Partial<BringBackPerson> = {}): BringBackPerson => ({
  person_key: "p1", source: "agent", agent_id: "p1", full_name: "Pat Person", phone: "+16025550111", email: "pat@example.test", home_state: "WI",
  license: "licensed", standing: "hidden", fired: false, let_go_reason: null, can_restore: true, manager_name: "Mia Manager",
  ethos_back: false, ethos_source: null, ethos_since: null, ethos_issued: 0, ethos_inforce: 0, carriers: [], carriers_active: 0,
  deals: 0, lifetime_ap: 0, last_deal: null, last_sign_in_at: null, instagram: null, last_call_outcome: null, last_call_at: null,
  last_active_on: null, comp_level: null, ethos_requested: false, ethos_requested_on: null, ...o,
});
const noFilters = { state: null, includeLetGo: false, search: "" };

const ethosNoAccount = person({ person_key: "e1", source: "ethos_person", agent_id: null, full_name: "Eve Ethos", standing: "no_account", can_restore: false, ethos_back: true, ethos_source: "ethos_hierarchy", ethos_since: "2026-11-19", ethos_issued: 17970.84, ethos_inforce: 15681.84, carriers: [{ carrier: "Ethos", status: "active", source: "ethos_hierarchy", as_of: "2026-11-19", active: true }], carriers_active: 1, home_state: null, last_active_on: "2026-11-20" });
const hiddenSeller = person({ person_key: "h1", agent_id: "h1", full_name: "Hal Hidden", standing: "hidden", deals: 11, lifetime_ap: 22000, last_deal: "2026-06-20", last_active_on: "2026-06-20", carriers: [{ carrier: "Aflac", status: "active", source: "agentlink", as_of: null, active: true }, { carrier: "Prudential", status: "submitted", source: "agentlink", as_of: null, active: false }], carriers_active: 1 });
const inactiveLicensed = person({ person_key: "i1", agent_id: "i1", full_name: "Ina Inactive", standing: "inactive", home_state: "TX", last_active_on: "2026-01-13", deals: 2, lifetime_ap: 3000, last_deal: "2026-01-13" });
const letGo = person({ person_key: "l1", agent_id: "l1", full_name: "Lou Letgo", standing: "let_go", fired: true, can_restore: false, let_go_reason: "no_show", ethos_back: true, ethos_source: "review_mark", carriers_active: 1 });
const sheetOnly = person({ person_key: "sheet:snap:7", source: "mgn_sheet", agent_id: null, full_name: "Sue Sheet", standing: "sheet_only", can_restore: false, home_state: null, comp_level: "L2", manager_name: null });
const all = [ethosNoAccount, hiddenSeller, inactiveLicensed, letGo, sheetOnly];

describe("parseBringBack", () => {
  it("throws on anything but a list of rows with an id and a known standing", () => {
    expect(() => parseBringBack(null)).toThrow(/list/);
    expect(() => parseBringBack([{ standing: "hidden" }])).toThrow(/id or an unknown standing/);
    expect(() => parseBringBack([{ person_key: "x", standing: "fired" }])).toThrow(/unknown standing/);
    expect(parseBringBack([])).toEqual([]);
  });

  it("normalises the database's strings and numbers and drops a malformed carrier", () => {
    const [p] = parseBringBack([{ person_key: "a", source: "ethos_person", standing: "no_account", full_name: " ", home_state: "wi", ethos_issued: "12.5", carriers_active: "2", deals: null, carriers: [{ carrier: "Ethos", active: true }, { status: "x" }], fired: "true" }]);
    expect(p).toMatchObject({ source: "ethos_person", full_name: "Name not on file", home_state: "WI", ethos_issued: 12.5, carriers_active: 2, deals: 0, fired: false, can_restore: false });
    expect(p.carriers).toEqual([{ carrier: "Ethos", status: "unknown", source: "unknown", as_of: null, active: true }]);
  });
});

describe("filters, groups and order", () => {
  it("people Sam let go stay off until asked for; the toggle brings only them in", () => {
    expect(bringBackCounts(all, noFilters)).toEqual({ no_account: 1, sheet_only: 1, hidden: 1, inactive: 1, excluded: 0, let_go: 0 });
    expect(bringBackRows(all, "sheet_only", noFilters, TODAY).map((p) => p.person_key)).toEqual(["sheet:snap:7"]);
    expect(bringBackCounts(all, { ...noFilters, includeLetGo: true }).let_go).toBe(1);
    expect(bringBackRows(all, "let_go", noFilters, TODAY)).toEqual([]);
    expect(bringBackRows(all, "let_go", { ...noFilters, includeLetGo: true }, TODAY).map((p) => p.person_key)).toEqual(["l1"]);
  });

  it("the state filter matches the home state; no state on file is its own value; search reads name, email, upline and phone digits", () => {
    expect(matchesBringBack(hiddenSeller, { ...noFilters, state: "WI" })).toBe(true);
    expect(matchesBringBack(inactiveLicensed, { ...noFilters, state: "WI" })).toBe(false);
    expect(matchesBringBack(ethosNoAccount, { ...noFilters, state: "" })).toBe(true);
    expect(matchesBringBack(hiddenSeller, { ...noFilters, state: "" })).toBe(false);
    expect(matchesBringBack(hiddenSeller, { ...noFilters, search: "hal" })).toBe(true);
    expect(matchesBringBack(hiddenSeller, { ...noFilters, search: "mia" })).toBe(true);
    expect(matchesBringBack(hiddenSeller, { ...noFilters, search: "555 0111" })).toBe(true);
    expect(matchesBringBack(hiddenSeller, { ...noFilters, search: "zed" })).toBe(false);
    expect(parseBringBackFilters((k) => ({ state: "tx", letgo: "1", q: "hal" })[k] ?? null)).toEqual({ state: "TX", includeLetGo: true, search: "hal" });
    expect(parseBringBackFilters(() => null)).toEqual({ state: null, includeLetGo: false, search: "" });
  });

  it("state options count the people shown, most first, with 'No state on file' last", () => {
    // Equal counts fall back to the state's name, so Texas sits before Wisconsin.
    // "No state on file" is always offered last, whatever its count, so the real states keep their place.
    expect(bringBackStateOptions(all, false)).toEqual([
      { code: "TX", name: "Texas", count: 1 },
      { code: "WI", name: "Wisconsin", count: 1 },
      { code: "", name: "No state on file", count: 2 },
    ]);
    expect(bringBackStateOptions(all, true).find((s) => s.code === "WI")?.count).toBe(2);
  });

  it("contract holders first: Ethos in force, then Ethos back, then active carriers, then sales, then the most recently active", () => {
    const sorted = [inactiveLicensed, hiddenSeller, ethosNoAccount, letGo].sort(compareBringBack(TODAY)).map((p) => p.person_key);
    expect(sorted).toEqual(["e1", "l1", "h1", "i1"]);
    const quietFirst = person({ person_key: "q", last_active_on: "2026-11-01" });
    const quietLater = person({ person_key: "r", last_active_on: "2026-05-01" });
    const never = person({ person_key: "n", last_active_on: null });
    expect([never, quietLater, quietFirst].sort(compareBringBack(TODAY)).map((p) => p.person_key)).toEqual(["q", "r", "n"]);
  });

  it("every group is declared once and the let-go group is last", () => {
    expect(BRING_BACK_GROUPS.map((g) => g.key)).toEqual(["no_account", "sheet_only", "hidden", "inactive", "excluded", "let_go"]);
  });
});

describe("words", () => {
  it("say what is on file: Ethos money, active carriers with Ethos first, sales here, how long quiet, the last logged call", () => {
    expect(ethosLine(ethosNoAccount)).toBe("Ethos back, $18.0K issued, $15.7K in force");
    expect(ethosLine(letGo)).toBe("Ethos back, nothing written on it yet");
    expect(ethosLine(hiddenSeller)).toBeNull();
    expect(ethosLine(person({ ethos_requested: true }))).toBe("Ethos requested, not back yet");
    expect(carriersLine(hiddenSeller)).toBe("Contracts: Aflac");
    expect(carriersLine(person({ carriers: ["Transamerica", "Ethos", "Aflac", "Combined", "Foresters"].map((c) => ({ carrier: c, status: "active", source: "agentlink", as_of: null, active: true })) }))).toBe("Contracts: Ethos, Aflac, Combined, Foresters +1");
    expect(carriersLine(inactiveLicensed)).toBeNull();
    expect(soldLine(hiddenSeller, TODAY)).toBe("Sold $22.0K here, last deal 160 days ago");
    expect(soldLine(person(), TODAY)).toBe("Never sold here");
    expect(soldLine(ethosNoAccount, TODAY)).toBeNull();
    expect(quietLine(hiddenSeller, TODAY)).toBe("Quiet 160 days");
    expect(quietLine(person({ last_active_on: TODAY }), TODAY)).toBe("Active today");
    expect(quietLine(person(), TODAY)).toBe("No activity on file");
    expect(quietLine(sheetOnly, TODAY)).toBe("Contracting requested on the MGN sheet, nothing else on file");
    expect(soldLine(sheetOnly, TODAY)).toBeNull();
    expect(lastCallLine(person({ last_call_outcome: "not_interested", last_call_at: "2026-11-03T18:00:00Z" }))).toMatch(/^Last call: Not interested \(Nov 3\)$/);
    expect(lastCallLine(person())).toBeNull();
    expect(daysSinceKey("2026-11-20", TODAY)).toBe(7);
    expect(daysSinceKey("2026-12-01", TODAY)).toBe(0);
    expect(daysSinceKey(null, TODAY)).toBeNull();
  });
});
