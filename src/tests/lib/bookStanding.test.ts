/**
 * bookStanding (OVERHAUL-book, 2026-10-29): the words, tones and arithmetic behind the Book of
 * Business tiles. The database decides every standing (v_book_of_business); these tests pin the
 * page's copy of the vocabulary to the migration so the two cannot drift, and prove the totals the
 * tiles print are exact sums of what the database counted.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_STANDINGS,
  BOOK_STANDINGS,
  KNOWN_STANDINGS_IN_LIST,
  STANDING_META,
  STANDING_STATUS_KEYS,
  parseStanding,
  parseStatusKey,
  readStandingParams,
  standingOfStatusKey,
  statusKeyLabel,
  summarizeStanding,
  type StandingCountRow,
} from "@/lib/bookStanding";
import { bookStandingTone } from "@/lib/tones";

const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/20261029180000_book_of_business_standing.sql"),
  "utf8",
);

/** The status keys the migration's CASE gives one standing. */
function caseKeys(standing: string): string[] {
  const re = new RegExp(`when k\\.status_key = any \\(array\\[([^\\]]+)\\]\\)(?:\\s*or book\\.is_dead)? then '${standing}'`);
  const m = migration.replace(/\s+/g, " ").match(re);
  if (!m) throw new Error(`no CASE branch for ${standing}`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}

// Sam's book as v_book_of_business counted it in a rolled-back transaction on 2026-10-29.
const SAM: StandingCountRow[] = [
  { standing: "active", status_key: "active", n: 138 },
  { standing: "active", status_key: "approved", n: 11 },
  { standing: "active", status_key: "issued", n: 1 },
  { standing: "gone", status_key: "declined", n: 51 },
  { standing: "gone", status_key: "withdrawn", n: 30 },
  { standing: "gone", status_key: "not_taken", n: 24 },
  { standing: "gone", status_key: "cancelled", n: 1 },
  { standing: "lapsing", status_key: "lapse_pending", n: 57 },
  { standing: "lapsing", status_key: "lapsed", n: 42 },
  { standing: "pending", status_key: "issued_not_paid", n: 166 },
  { standing: "pending", status_key: "in_review", n: 19 },
  { standing: "pending", status_key: "pending", n: 16 },
  { standing: "unknown", status_key: "unknown", n: 969 },
  { standing: "unknown", status_key: "reported_external", n: 104 },
];

describe("the page's vocabulary is the migration's", () => {
  it("lists exactly the status keys the view's CASE puts in each standing", () => {
    for (const standing of BOOK_STANDINGS) {
      expect({ standing, keys: [...STANDING_STATUS_KEYS[standing]].sort() }).toEqual({ standing, keys: caseKeys(standing) });
    }
  });

  it("puts every policy AgentLink marks dead in Gone unless it is lapsing", () => {
    expect(migration.replace(/\s+/g, " ")).toMatch(/'not_in_force'\]\) or book\.is_dead then 'gone'/);
  });

  it("gives no status key to two standings", () => {
    const all = BOOK_STANDINGS.flatMap((s) => STANDING_STATUS_KEYS[s]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("has words for every key it knows, and for the two unknown markers", () => {
    for (const key of [...BOOK_STANDINGS.flatMap((s) => STANDING_STATUS_KEYS[s]), "unknown", "reported_external"]) {
      const label = statusKeyLabel(key);
      expect({ key, readsAsCode: label.includes("_") }).toEqual({ key, readsAsCode: false });
    }
    expect(statusKeyLabel("issued_not_paid")).toBe("Issued, not paid");
    expect(statusKeyLabel("lapse_pending")).toBe("Lapse pending");
    expect(statusKeyLabel("reported_external")).toBe("Reported as a total");
  });

  it("reads a key it has no words for as plain words, and a blank as no status", () => {
    expect(statusKeyLabel("some_new_status")).toBe("Some new status");
    expect(statusKeyLabel(null)).toBe("No status yet");
    expect(statusKeyLabel("  ")).toBe("No status yet");
  });

  it("gives a key the standing the view gives it, and anything else is unknown", () => {
    expect(standingOfStatusKey("approved")).toBe("active");
    expect(standingOfStatusKey("issued_not_paid")).toBe("pending");
    expect(standingOfStatusKey("lapsed")).toBe("lapsing");
    expect(standingOfStatusKey("postponed")).toBe("gone");
    expect(standingOfStatusKey("unknown")).toBe("unknown");
    expect(standingOfStatusKey("reported_external")).toBe("unknown");
    expect(standingOfStatusKey(null)).toBe("unknown");
  });
});

describe("summarizeStanding", () => {
  it("adds Sam's book up to the four tiles and the no-status line, every row counted once", () => {
    const s = summarizeStanding(SAM);
    expect(s.byStanding).toEqual({ active: 150, pending: 201, lapsing: 99, gone: 106, unknown: 1073 });
    expect(s.total).toBe(1629);
    expect(Object.values(s.byStanding).reduce((a, b) => a + b, 0)).toBe(s.total);
  });

  it("breaks each standing into its statuses, largest first, and each breakdown sums to its tile", () => {
    const s = summarizeStanding(SAM);
    expect(s.statuses.lapsing).toEqual([
      { key: "lapse_pending", label: "Lapse pending", n: 57 },
      { key: "lapsed", label: "Lapsed", n: 42 },
    ]);
    expect(s.statuses.gone.map((x) => x.label)).toEqual(["Declined", "Withdrawn", "Not taken", "Cancelled"]);
    for (const standing of ALL_STANDINGS) {
      expect(s.statuses[standing].reduce((a, x) => a + x.n, 0)).toBe(s.byStanding[standing]);
    }
  });

  it("puts a standing the page does not know with No status yet, the same rows that list shows", () => {
    const s = summarizeStanding([{ standing: "archived", status_key: "archived", n: 3 }, { standing: null, status_key: null, n: 2 }]);
    expect(s.byStanding.unknown).toBe(5);
    expect(s.total).toBe(5);
    expect(s.statuses.unknown.map((x) => x.key).sort()).toEqual(["archived", "unknown"]);
  });

  it("an empty book is a true zero in every tile", () => {
    const s = summarizeStanding([]);
    expect(s.total).toBe(0);
    expect(s.byStanding).toEqual({ active: 0, pending: 0, lapsing: 0, gone: 0, unknown: 0 });
  });

  it("refuses a count that is not a whole number, so the tiles say the read failed instead of guessing", () => {
    for (const n of [null, -1, 1.5, Number.NaN]) {
      expect(() => summarizeStanding([{ standing: "active", status_key: "active", n }])).toThrow(/without a number/);
    }
  });
});

describe("the filter in the URL", () => {
  const read = (q: string) => readStandingParams(new URLSearchParams(q));

  it("reads a tile and a status inside it", () => {
    expect(read("standing=lapsing")).toEqual({ standing: "lapsing", statusKey: null });
    expect(read("standing=gone&status=declined")).toEqual({ standing: "gone", statusKey: "declined" });
    expect(read("")).toEqual({ standing: null, statusKey: null });
  });

  it("keeps the page's older links working", () => {
    // The 2026-10-28 chips: Inactive is now Gone.
    expect(read("group=inactive")).toEqual({ standing: "gone", statusKey: null });
    expect(read("group=pending")).toEqual({ standing: "pending", statusKey: null });
    // The old ten tiles: their keys are status keys, and a status names its own standing.
    expect(read("status=lapse_pending")).toEqual({ standing: "lapsing", statusKey: "lapse_pending" });
    expect(read("status=issued_not_paid")).toEqual({ standing: "pending", statusKey: "issued_not_paid" });
    expect(read("status=carrier_na")).toEqual({ standing: "unknown", statusKey: null });
  });

  it("ignores anything that is not a known tile or a plain status key", () => {
    expect(read("standing=everything")).toEqual({ standing: null, statusKey: null });
    expect(read("status=active,standing.eq.gone")).toEqual({ standing: null, statusKey: null });
    expect(parseStanding("Active")).toBeNull();
    expect(parseStatusKey("DROP TABLE")).toBeNull();
    expect(parseStatusKey("lapsed")).toBe("lapsed");
  });

  it("names the four the No status yet list leaves out", () => {
    expect(KNOWN_STANDINGS_IN_LIST).toBe("(active,pending,lapsing,gone)");
  });
});

describe("colour with meaning", () => {
  it("gives each standing its tone through the shared mapping, and the words always come with it", () => {
    expect(ALL_STANDINGS.map((s) => bookStandingTone(s))).toEqual(["good", "cool", "warm", "hot", "slate"]);
    for (const standing of ALL_STANDINGS) {
      const meta = STANDING_META[standing];
      expect(meta.tone).toBe(bookStandingTone(standing));
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.hint.length).toBeGreaterThan(0);
      expect(meta.definition.length).toBeGreaterThan(0);
    }
    expect(bookStandingTone(null)).toBe("slate");
  });
});
