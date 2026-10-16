/**
 * Recruiting worklist: which list renders where (F28) and whether the loaded
 * rows cover every eligible record (F29). Pure rules, no React and no network,
 * so the page and the tests read the same decision.
 */

export const WORKLIST_VIEWS = ["list", "table", "board"] as const;
export type WorklistView = (typeof WORKLIST_VIEWS)[number];

/** `?view=` from the URL. Anything unknown is the default compact list. */
export function worklistViewFromParam(value: string | null | undefined): WorklistView {
  return value === "table" || value === "board" ? value : "list";
}

/**
 * split: the compact queue list beside the person panel (wide screens, default view).
 * stack: the same compact rows as cards with the person in a sheet: every screen under
 *        1024px whatever the URL asks for, so the 980px table never renders where it
 *        cannot fit (a landscape phone at 852px included).
 * table: the full-width table, columns chosen per viewer, person in a sheet. Wide only.
 * board: stage columns; the panel sits beside it when wide, in a sheet when narrow.
 */
export type WorklistLayout = "split" | "stack" | "table" | "board";

export interface WorklistLayoutInput {
  view: WorklistView;
  /** (min-width: 1024px): room for a list and the 400px person panel side by side, and the only width the table fits. */
  isWide: boolean;
}

export function resolveWorklistLayout({ view, isWide }: WorklistLayoutInput): WorklistLayout {
  if (view === "board") return "board";
  if (view === "table") return isWide ? "table" : "stack";
  return isWide ? "split" : "stack";
}

export type PanelPlacement = "inline" | "sheet";

/**
 * Where the selected person renders. Inline means the page keeps someone open
 * beside the list; a sheet is opened only by a tap, never by the page itself.
 */
export function panelPlacement(layout: WorklistLayout, isWide: boolean): PanelPlacement {
  if (layout === "split") return "inline";
  if (layout === "board") return isWide ? "inline" : "sheet";
  return "sheet";
}

/** The three head counts useRecruitingWorklist fetches beside the rows; null when a count query failed. */
export interface CoverageCounts {
  live: number | null;
  duplicates: number | null;
  nonApplication: number | null;
}

export type CoverageVerdict =
  | { kind: "complete"; loaded: number; eligible: number }
  | { kind: "incomplete"; loaded: number; eligible: number; missing: number }
  | { kind: "disagree"; loaded: number; eligible: number; extra: number }
  | { kind: "unknown"; loaded: number; unavailable: Array<keyof CoverageCounts> };

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Eligible = live records minus the ones the worklist deliberately leaves out
 * (marked duplicate, interview bookings and tests). Loaded must equal eligible.
 * A count the server could not give makes the verdict unknown; it is never
 * treated as zero, because zero would read as "nothing left out".
 */
export function assessCoverage(loaded: number, coverage: CoverageCounts | null | undefined): CoverageVerdict {
  const live = coverage?.live;
  const duplicates = coverage?.duplicates;
  const nonApplication = coverage?.nonApplication;
  if (!isCount(live) || !isCount(duplicates) || !isCount(nonApplication)) {
    const unavailable: Array<keyof CoverageCounts> = [];
    if (!isCount(live)) unavailable.push("live");
    if (!isCount(duplicates)) unavailable.push("duplicates");
    if (!isCount(nonApplication)) unavailable.push("nonApplication");
    return { kind: "unknown", loaded, unavailable };
  }
  const eligible = live - duplicates - nonApplication;
  if (eligible === loaded) return { kind: "complete", loaded, eligible };
  if (eligible > loaded) return { kind: "incomplete", loaded, eligible, missing: eligible - loaded };
  return { kind: "disagree", loaded, eligible, extra: loaded - eligible };
}

const n = (value: number): string => value.toLocaleString();

/** One short phrase for the always-visible Data status summary line. */
export function coverageSummary(verdict: CoverageVerdict): string {
  switch (verdict.kind) {
    case "complete":
      return `complete, ${n(verdict.loaded)} of ${n(verdict.eligible)} eligible records loaded`;
    case "incomplete":
      return `incomplete, ${n(verdict.missing)} of ${n(verdict.eligible)} eligible records not loaded`;
    case "disagree":
      return `counts disagree, ${n(verdict.loaded)} loaded but ${n(verdict.eligible)} expected`;
    case "unknown":
      return `coverage unknown, ${n(verdict.loaded)} loaded and the eligible count is unavailable`;
  }
}

/** The prominent warning sentence. Null only when the counts reconcile; unknown is reported, not alarmed. */
export function coverageWarning(verdict: CoverageVerdict): string | null {
  if (verdict.kind === "incomplete") {
    const noun = verdict.missing === 1 ? "record is" : "records are";
    return `${n(verdict.missing)} eligible ${noun} not in this list. Queue counts may be low until it reloads.`;
  }
  if (verdict.kind === "disagree") {
    return `The list and the record counts disagree: ${n(verdict.loaded)} loaded, ${n(verdict.eligible)} expected. Reload before trusting the queue counts.`;
  }
  return null;
}

export interface CoverageFact {
  label: string;
  /** A formatted number, or "Unavailable" when that count failed. Never a stand-in zero. */
  value: string;
}

/** The provenance lines inside the Data status disclosure. */
export function coverageFacts(loaded: number, coverage: CoverageCounts | null | undefined): CoverageFact[] {
  const show = (value: number | null | undefined): string => (isCount(value) ? n(value) : "Unavailable");
  return [
    { label: "Worklist records loaded", value: n(loaded) },
    { label: "Live records you can see", value: show(coverage?.live) },
    { label: "Marked duplicate, not shown", value: show(coverage?.duplicates) },
    { label: "Interview bookings or tests, not shown", value: show(coverage?.nonApplication) },
  ];
}
