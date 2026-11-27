import { describe, expect, it } from "vitest";
import {
  EMPTY_STATE_FILTER,
  NO_STATE,
  NO_STATE_LABEL,
  countStates,
  groupPeopleByState,
  matchesStateFilter,
  mergeStateCounts,
  normalizeStates,
  parseTab,
  toggleState,
  type RecoveryPerson,
} from "@/lib/teamRecovery";

function person(over: Partial<RecoveryPerson> = {}): RecoveryPerson {
  return { key: "cs:1", name: "Pat Example", phone: "6025550100", states: ["AZ"], source: "call_sheet", detail: "Has the contract", ...over };
}

describe("teamRecovery: tab parsing keeps old bookmarks working", () => {
  it("maps the two retired page names and the new names onto the three tabs", () => {
    expect(parseTab("ethos-call-sheet")).toBe("call-sheet");
    expect(parseTab("inactive-agents")).toBe("recovery");
    expect(parseTab("by-state")).toBe("by-state");
    expect(parseTab("STATES")).toBe("by-state");
    expect(parseTab(null)).toBe("call-sheet");
    expect(parseTab("nonsense")).toBe("call-sheet");
  });
});

describe("teamRecovery: state normalisation", () => {
  it("upper-cases, dedupes, sorts and drops anything that is not a two-letter state", () => {
    expect(normalizeStates(["tx", "AZ", " az ", "Texas", null, undefined, ""])).toEqual(["AZ", "TX"]);
    expect(normalizeStates(null)).toEqual([]);
  });
});

describe("teamRecovery: the state filter", () => {
  it("shows everyone when nothing is picked", () => {
    expect(matchesStateFilter(["AZ"], EMPTY_STATE_FILTER)).toBe(true);
    expect(matchesStateFilter([], EMPTY_STATE_FILTER)).toBe(true);
    expect(matchesStateFilter(null, EMPTY_STATE_FILTER)).toBe(true);
  });

  it("matches any picked state and hides people with no state unless No state is picked too", () => {
    const f = toggleState(EMPTY_STATE_FILTER, "TX");
    expect(matchesStateFilter(["AZ", "TX"], f)).toBe(true);
    expect(matchesStateFilter(["AZ"], f)).toBe(false);
    expect(matchesStateFilter([], f)).toBe(false);
    const withUnknown = toggleState(f, NO_STATE);
    expect(matchesStateFilter([], withUnknown)).toBe(true);
    expect(matchesStateFilter(["AZ"], withUnknown)).toBe(false);
  });

  it("toggles a state off again and never mutates the previous filter", () => {
    const a = toggleState(EMPTY_STATE_FILTER, "AZ");
    const b = toggleState(a, "AZ");
    expect(a.has("AZ")).toBe(true);
    expect(b.size).toBe(0);
    expect(EMPTY_STATE_FILTER.size).toBe(0);
  });
});

describe("teamRecovery: counts", () => {
  it("counts a multi-state person once per state and keeps the no-state people separate", () => {
    const c = countStates([["AZ", "TX"], ["TX"], [], null, ["tx"]]);
    expect(c.counts).toEqual([{ state: "TX", n: 3 }, { state: "AZ", n: 1 }]);
    expect(c.unknown).toBe(2);
    expect(c.total).toBe(5);
  });

  it("merges two lists onto one bar, most people first then alphabetical", () => {
    const m = mergeStateCounts(countStates([["AZ"], ["TX"]]), countStates([["TX"], ["CA"], []]));
    expect(m.counts).toEqual([{ state: "TX", n: 2 }, { state: "AZ", n: 1 }, { state: "CA", n: 1 }]);
    expect(m.unknown).toBe(1);
    expect(m.total).toBe(5);
  });
});

describe("teamRecovery: grouping people by state", () => {
  const people: RecoveryPerson[] = [
    person({ key: "cs:1", name: "Zed", states: ["AZ", "TX"] }),
    person({ key: "rq:2", name: "Amy", states: ["TX"], source: "recovery", detail: "15 days quiet" }),
    person({ key: "rq:3", name: "Bo", states: [], source: "recovery" }),
  ];

  it("puts a multi-state person under each state, biggest state first, no-state bucket last", () => {
    const g = groupPeopleByState(people);
    expect(g.map((x) => x.state)).toEqual(["TX", "AZ", NO_STATE]);
    expect(g[0].people.map((p) => p.name)).toEqual(["Zed", "Amy"]);
    expect(g[2].label).toBe(NO_STATE_LABEL);
    expect(g[2].people.map((p) => p.name)).toEqual(["Bo"]);
  });

  it("orders call sheet before recovery queue inside a state, then by name", () => {
    const g = groupPeopleByState([
      person({ key: "rq:a", name: "Aaron", states: ["TX"], source: "recovery" }),
      person({ key: "cs:z", name: "Zoe", states: ["TX"], source: "call_sheet" }),
    ]);
    expect(g[0].people.map((p) => p.name)).toEqual(["Zoe", "Aaron"]);
  });

  it("honours the state filter and only shows the picked states", () => {
    const g = groupPeopleByState(people, toggleState(EMPTY_STATE_FILTER, "AZ"));
    expect(g.map((x) => x.state)).toEqual(["AZ"]);
    expect(g[0].people.map((p) => p.name)).toEqual(["Zed"]);
  });
});
