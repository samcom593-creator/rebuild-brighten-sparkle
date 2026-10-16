/**
 * Recruiting worklist Table view: which of its columns show (F28, "a
 * configurable full-width table"). Pure rules plus a small storage adapter,
 * so the page and the tests read the same decision.
 *
 * The choice is a per-viewer preference, so it lives in localStorage keyed by
 * viewer: it has to outlive the tab (the draft store's sessionStorage is the
 * right lifetime for an unsent note and the wrong one for a layout choice),
 * and two people sharing a browser keep their own. Storage access can throw
 * (private mode, blocked site data, quota); every access is wrapped and
 * degrades to the default set, never to a crash.
 */

export const WORKLIST_COLUMN_KEYS = [
  "name",
  "phone",
  "state",
  "license",
  "stage",
  "owner",
  "last_contact",
  "next_action",
  "due",
  "blocker",
] as const;

export type WorklistColumnKey = (typeof WORKLIST_COLUMN_KEYS)[number];

export interface WorklistColumn {
  key: WorklistColumnKey;
  label: string;
  /** Always shown: a row without it has no identity. */
  locked: boolean;
  /** Rough floor in px before this column's cells start to wrap or clip. */
  minWidth: number;
}

/**
 * Canonical order. The chooser lists these and the table header and body both
 * consult the same set, so they cannot drift. The ten floors add up to the
 * 980px the table has always needed with every column shown.
 */
export const WORKLIST_TABLE_COLUMNS: readonly WorklistColumn[] = [
  { key: "name", label: "Name", locked: true, minWidth: 160 },
  { key: "phone", label: "Phone", locked: false, minWidth: 104 },
  { key: "state", label: "State", locked: false, minWidth: 56 },
  { key: "license", label: "License", locked: false, minWidth: 80 },
  { key: "stage", label: "Stage", locked: false, minWidth: 96 },
  { key: "owner", label: "Owner", locked: false, minWidth: 96 },
  { key: "last_contact", label: "Last contact", locked: false, minWidth: 128 },
  { key: "next_action", label: "Next action", locked: false, minWidth: 120 },
  { key: "due", label: "Due", locked: false, minWidth: 64 },
  { key: "blocker", label: "Blocker", locked: false, minWidth: 76 },
];

export const DEFAULT_WORKLIST_COLUMNS: readonly WorklistColumnKey[] = WORKLIST_COLUMN_KEYS;

export function isWorklistColumnKey(value: unknown): value is WorklistColumnKey {
  return typeof value === "string" && (WORKLIST_COLUMN_KEYS as readonly string[]).includes(value);
}

/**
 * Known keys only, in canonical order, no repeats, locked columns always present.
 * Unknown keys (a renamed column, a hand-edited value) are dropped, not kept.
 */
export function normaliseColumns(keys: Iterable<unknown>): WorklistColumnKey[] {
  const wanted = new Set<WorklistColumnKey>();
  for (const key of keys) if (isWorklistColumnKey(key)) wanted.add(key);
  return WORKLIST_TABLE_COLUMNS.filter((c) => c.locked || wanted.has(c.key)).map((c) => c.key);
}

/** Show or hide one column. A locked column stays shown whatever is asked. */
export function toggleColumn(current: readonly WorklistColumnKey[], key: WorklistColumnKey, shown: boolean): WorklistColumnKey[] {
  const next = new Set(current);
  if (shown) next.add(key);
  else next.delete(key);
  return normaliseColumns(next);
}

/** How many columns the viewer has hidden. Counted on the normalised set, so a stray or repeated key cannot skew it. */
export function hiddenColumnCount(columns: readonly WorklistColumnKey[]): number {
  return WORKLIST_TABLE_COLUMNS.length - normaliseColumns(columns).length;
}

/**
 * The table's minimum width for the columns shown. With all ten it is the 980px
 * floor the table always had; hiding columns lowers it, so on a screen narrower
 * than that the table can fit without panning sideways once enough are hidden.
 */
export function tableMinWidth(columns: readonly WorklistColumnKey[]): number {
  const shown = new Set(normaliseColumns(columns));
  return WORKLIST_TABLE_COLUMNS.reduce((sum, col) => (shown.has(col.key) ? sum + col.minWidth : sum), 0);
}

type MinimalStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): MinimalStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (error) {
    // empty-catch-allow: storage access throws when site data is blocked; the default set still works
    void error;
    return null;
  }
}

/** Same namespace as the draft store's keys, so one person's worklist state is easy to find and clear together. */
export function columnsStorageKey(userId: string | null): string {
  return `recruiting-worklist:v1:columns:${userId ?? "anon"}`;
}

/** The saved choice, or every column when nothing usable is saved. Never throws. */
export function loadColumns(userId: string | null, storage = defaultStorage()): WorklistColumnKey[] {
  if (!storage) return [...DEFAULT_WORKLIST_COLUMNS];
  try {
    const raw = storage.getItem(columnsStorageKey(userId));
    if (raw === null) return [...DEFAULT_WORKLIST_COLUMNS];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? normaliseColumns(parsed) : [...DEFAULT_WORKLIST_COLUMNS];
  } catch (error) {
    // empty-catch-allow: a corrupt or unreadable value is treated as no saved choice
    void error;
    return [...DEFAULT_WORKLIST_COLUMNS];
  }
}

/** True when the choice was written. False means it will not survive a reload; the in-memory choice is unaffected. */
export function saveColumns(userId: string | null, columns: readonly WorklistColumnKey[], storage = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(columnsStorageKey(userId), JSON.stringify(normaliseColumns(columns)));
    return true;
  } catch (error) {
    // empty-catch-allow: quota or blocked storage; the choice still applies for this visit
    void error;
    return false;
  }
}
