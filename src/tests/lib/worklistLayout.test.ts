import { describe, expect, it } from "vitest";

import {
  WORKLIST_VIEWS,
  assessCoverage,
  coverageFacts,
  coverageSummary,
  coverageWarning,
  panelPlacement,
  resolveWorklistLayout,
  worklistViewFromParam,
} from "@/lib/worklistLayout";

// Measured read-only on 2026-10-15: 838 live rows = 702 eligible + 101 duplicate
// applications + 35 interview bookings and tests. Kept under 1,000 so the
// toLocaleString output is locale-independent.
const MEASURED = { live: 838, duplicates: 101, nonApplication: 35 };

describe("worklistViewFromParam", () => {
  it("accepts the three views and falls back to the compact list", () => {
    expect(WORKLIST_VIEWS).toEqual(["list", "table", "board"]);
    expect(worklistViewFromParam("table")).toBe("table");
    expect(worklistViewFromParam("board")).toBe("board");
    expect(worklistViewFromParam("list")).toBe("list");
    expect(worklistViewFromParam(null)).toBe("list");
    expect(worklistViewFromParam(undefined)).toBe("list");
    expect(worklistViewFromParam("classic")).toBe("list");
  });
});

describe("resolveWorklistLayout (F28)", () => {
  it("default view: the compact list beside the panel when wide, cards when narrow", () => {
    expect(resolveWorklistLayout({ view: "list", isWide: true })).toBe("split");
    expect(resolveWorklistLayout({ view: "list", isWide: false })).toBe("stack");
  });

  it("the table is its own full-width view and only resolves at 1024px and up", () => {
    expect(resolveWorklistLayout({ view: "table", isWide: true })).toBe("table");
    // Every narrower screen: a portrait phone, a landscape phone at 852px, a tablet.
    // A shared ?view=table link lands on the compact cards there, never the table.
    expect(resolveWorklistLayout({ view: "table", isWide: false })).toBe("stack");
  });

  it("the board is unchanged by width", () => {
    expect(resolveWorklistLayout({ view: "board", isWide: true })).toBe("board");
    expect(resolveWorklistLayout({ view: "board", isWide: false })).toBe("board");
  });
});

describe("panelPlacement", () => {
  it("only the split layout and a wide board keep the person inline; everything else is a sheet", () => {
    expect(panelPlacement("split", true)).toBe("inline");
    expect(panelPlacement("board", true)).toBe("inline");
    expect(panelPlacement("board", false)).toBe("sheet");
    expect(panelPlacement("table", true)).toBe("sheet");
    expect(panelPlacement("table", false)).toBe("sheet");
    expect(panelPlacement("stack", false)).toBe("sheet");
  });
});

describe("assessCoverage (F29)", () => {
  it("complete when loaded equals live minus the records deliberately left out", () => {
    expect(assessCoverage(702, MEASURED)).toEqual({ kind: "complete", loaded: 702, eligible: 702 });
  });

  it("incomplete when eligible records did not load, naming how many", () => {
    expect(assessCoverage(700, MEASURED)).toEqual({ kind: "incomplete", loaded: 700, eligible: 702, missing: 2 });
  });

  it("disagree when more loaded than the counts allow, including a negative eligible count", () => {
    expect(assessCoverage(705, MEASURED)).toEqual({ kind: "disagree", loaded: 705, eligible: 702, extra: 3 });
    expect(assessCoverage(2, { live: 2, duplicates: 2, nonApplication: 2 })).toEqual({ kind: "disagree", loaded: 2, eligible: -2, extra: 4 });
  });

  it("a failed count is unknown, never a zero, and names which count failed", () => {
    expect(assessCoverage(702, { live: 838, duplicates: null, nonApplication: 35 }))
      .toEqual({ kind: "unknown", loaded: 702, unavailable: ["duplicates"] });
    expect(assessCoverage(702, undefined))
      .toEqual({ kind: "unknown", loaded: 702, unavailable: ["live", "duplicates", "nonApplication"] });
    expect(assessCoverage(702, null).kind).toBe("unknown");
    expect(assessCoverage(702, { live: Number.NaN, duplicates: 1, nonApplication: 1 }))
      .toEqual({ kind: "unknown", loaded: 702, unavailable: ["live"] });
  });
});

describe("coverage copy", () => {
  it("summary: one phrase per verdict, always carrying the loaded count", () => {
    expect(coverageSummary(assessCoverage(702, MEASURED))).toBe("complete, 702 of 702 eligible records loaded");
    expect(coverageSummary(assessCoverage(700, MEASURED))).toBe("incomplete, 2 of 702 eligible records not loaded");
    expect(coverageSummary(assessCoverage(705, MEASURED))).toBe("counts disagree, 705 loaded but 702 expected");
    expect(coverageSummary(assessCoverage(702, null))).toBe("coverage unknown, 702 loaded and the eligible count is unavailable");
  });

  it("warning: only incomplete and disagree warn; unknown is reported, not alarmed", () => {
    expect(coverageWarning(assessCoverage(702, MEASURED))).toBeNull();
    expect(coverageWarning(assessCoverage(702, null))).toBeNull();
    expect(coverageWarning(assessCoverage(701, MEASURED)))
      .toBe("1 eligible record is not in this list. Queue counts may be low until it reloads.");
    expect(coverageWarning(assessCoverage(700, MEASURED))).toMatch(/^2 eligible records are not in this list/);
    expect(coverageWarning(assessCoverage(705, MEASURED))).toMatch(/705 loaded, 702 expected/);
  });

  it("facts: a failed count prints Unavailable, never 0", () => {
    const facts = coverageFacts(702, { live: 838, duplicates: null, nonApplication: 35 });
    expect(facts.map((f) => f.label)).toEqual([
      "Worklist records loaded",
      "Live records you can see",
      "Marked duplicate, not shown",
      "Interview bookings or tests, not shown",
    ]);
    expect(facts.map((f) => f.value)).toEqual(["702", "838", "Unavailable", "35"]);
    expect(coverageFacts(0, undefined).map((f) => f.value)).toEqual(["0", "Unavailable", "Unavailable", "Unavailable"]);
  });
});
