/**
 * F28: the recruiting Table view is configurable. Which columns show is a
 * per-viewer choice that survives a reload, never loses the Name column, and
 * narrows the table's minimum width as columns are hidden. Storage failures
 * fall back to every column instead of crashing or dropping the table.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKLIST_COLUMNS,
  WORKLIST_COLUMN_KEYS,
  WORKLIST_TABLE_COLUMNS,
  columnsStorageKey,
  hiddenColumnCount,
  loadColumns,
  normaliseColumns,
  saveColumns,
  tableMinWidth,
  toggleColumn,
} from "@/lib/worklistColumns";

const USER = "00000000-0000-4000-8000-0000000000cc";
const OTHER = "00000000-0000-4000-8000-0000000000dd";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("SecurityError: site data is blocked");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("column table", () => {
  it("lists every key once, in the canonical order, with Name as the only locked column", () => {
    expect(WORKLIST_TABLE_COLUMNS.map((c) => c.key)).toEqual([...WORKLIST_COLUMN_KEYS]);
    expect(WORKLIST_TABLE_COLUMNS.filter((c) => c.locked).map((c) => c.key)).toEqual(["name"]);
    expect(DEFAULT_WORKLIST_COLUMNS).toEqual(WORKLIST_COLUMN_KEYS);
  });
});

describe("normaliseColumns", () => {
  it("keeps known keys in canonical order, drops unknown and repeated ones, and always keeps Name", () => {
    expect(normaliseColumns(["due", "phone", "due", "renamed_column", 7, null])).toEqual(["name", "phone", "due"]);
    expect(normaliseColumns([])).toEqual(["name"]);
  });
});

describe("toggleColumn", () => {
  it("hides and re-shows a column in its canonical place", () => {
    const hidden = toggleColumn(DEFAULT_WORKLIST_COLUMNS, "phone", false);
    expect(hidden).not.toContain("phone");
    expect(toggleColumn(hidden, "phone", true)).toEqual([...DEFAULT_WORKLIST_COLUMNS]);
  });

  it("never hides the locked Name column", () => {
    expect(toggleColumn(DEFAULT_WORKLIST_COLUMNS, "name", false)).toContain("name");
  });
});

describe("hiddenColumnCount", () => {
  it("counts hidden columns on the normalised set", () => {
    expect(hiddenColumnCount(DEFAULT_WORKLIST_COLUMNS)).toBe(0);
    expect(hiddenColumnCount(toggleColumn(toggleColumn(DEFAULT_WORKLIST_COLUMNS, "phone", false), "state", false))).toBe(2);
    // Name cannot be hidden, so an empty choice still shows one column.
    expect(hiddenColumnCount([])).toBe(WORKLIST_TABLE_COLUMNS.length - 1);
  });
});

describe("tableMinWidth", () => {
  it("is the table's long-standing 980px with every column shown", () => {
    expect(tableMinWidth(DEFAULT_WORKLIST_COLUMNS)).toBe(980);
  });

  it("shrinks by each hidden column's floor and never drops below Name's", () => {
    const phone = WORKLIST_TABLE_COLUMNS.find((c) => c.key === "phone");
    const name = WORKLIST_TABLE_COLUMNS.find((c) => c.key === "name");
    if (!phone || !name) throw new Error("column table is missing phone or name");
    expect(tableMinWidth(toggleColumn(DEFAULT_WORKLIST_COLUMNS, "phone", false))).toBe(980 - phone.minWidth);
    expect(tableMinWidth([])).toBe(name.minWidth);
    expect(tableMinWidth(["name", "next_action"])).toBeLessThan(980);
  });
});

describe("loadColumns / saveColumns", () => {
  it("shows every column when nothing is saved", () => {
    expect(loadColumns(USER, memoryStorage())).toEqual([...DEFAULT_WORKLIST_COLUMNS]);
  });

  it("round-trips a viewer's choice under that viewer's key only", () => {
    const storage = memoryStorage();
    const choice = toggleColumn(DEFAULT_WORKLIST_COLUMNS, "blocker", false);
    expect(saveColumns(USER, choice, storage)).toBe(true);
    expect(storage.map.has(columnsStorageKey(USER))).toBe(true);
    expect(loadColumns(USER, storage)).toEqual(choice);
    expect(loadColumns(OTHER, storage)).toEqual([...DEFAULT_WORKLIST_COLUMNS]);
  });

  it("normalises what it reads: unknown keys dropped, Name restored", () => {
    const storage = memoryStorage({ [columnsStorageKey(USER)]: JSON.stringify(["due", "gone_column"]) });
    expect(loadColumns(USER, storage)).toEqual(["name", "due"]);
  });

  it("treats a corrupt or non-list value as no saved choice", () => {
    expect(loadColumns(USER, memoryStorage({ [columnsStorageKey(USER)]: "{not json" }))).toEqual([...DEFAULT_WORKLIST_COLUMNS]);
    expect(loadColumns(USER, memoryStorage({ [columnsStorageKey(USER)]: JSON.stringify({ name: true }) }))).toEqual([...DEFAULT_WORKLIST_COLUMNS]);
  });

  it("degrades to every column, and reports the save as not kept, when storage throws or is missing", () => {
    expect(loadColumns(USER, throwingStorage)).toEqual([...DEFAULT_WORKLIST_COLUMNS]);
    expect(saveColumns(USER, ["name"], throwingStorage)).toBe(false);
    expect(loadColumns(USER, null)).toEqual([...DEFAULT_WORKLIST_COLUMNS]);
    expect(saveColumns(USER, ["name"], null)).toBe(false);
  });

  it("keys a signed-out viewer separately", () => {
    expect(columnsStorageKey(null)).toBe("recruiting-worklist:v1:columns:anon");
    expect(columnsStorageKey(USER)).toBe(`recruiting-worklist:v1:columns:${USER}`);
  });
});
