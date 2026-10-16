/**
 * Pure logic behind ProductionMetricsCard (F33 in the 2026-10-14 Galaxy OS improvement map).
 *
 * The strip depends on three independent reads:
 *   crm_roster_segments   the team summary (Producing this month, Month-to-date ALP)
 *   crm_agent_roster      the rows Team size and the new-hire activation queue are counted from; the page assembles
 *                         it from four RPCs (ROSTER_PARTS), so any one of them failing fails the roster, and the
 *                         failure carries the name of the part that failed (partRows, sourceError)
 *   crm_today_production  today's line
 *
 * Each read carries its own availability into the strip, so a figure is a number only when the read it comes from
 * completed. A read that failed renders Unavailable under its own name and is never replaced by a zero or by a
 * neighbouring read's figure. crm_roster_segments.total in particular is not Team size: total counts every row
 * crm_agent_roster() returns, inactive and sync-only placeholder seats included, while Team size counts the active
 * rows whose is_sync_only is not true. Measured read-only on 2026-10-15 under admin scope (the roster's own filters):
 * total 95, active 68, Team size 67. Four of those 67 are merged-away twins, because crm_agent_roster() has no
 * canonical_agent_id filter and RosterRow does not carry the column, so the client cannot drop them.
 */
import { errorMessage, formatAsOf, queryStale, queryStatus, type QueryStatusInput } from "@/lib/queryState";
import { ensureCompleteRead, type RosterRow } from "@/lib/teamRoster";

export const SOURCE_SEGMENTS = "crm_roster_segments";
export const SOURCE_ROSTER = "crm_agent_roster";
export const SOURCE_TODAY = "crm_today_production";

/** The four RPCs the roster read is assembled from. Any one failing fails the roster. */
export const ROSTER_PARTS = {
  roster: SOURCE_ROSTER,
  salesPulse: "crm_agent_sales_pulse",
  contacts: "crm_agent_contacts",
  freeLeads: "crm_agent_free_leads_status",
} as const;

/** Plain-English names for every read the strip can report on. Copy prints these, with the RPC name in parentheses. */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  [SOURCE_SEGMENTS]: "the team summary",
  [SOURCE_ROSTER]: "the team roster",
  [SOURCE_TODAY]: "today's production",
  [ROSTER_PARTS.salesPulse]: "today's sales by agent",
  [ROSTER_PARTS.contacts]: "agent contact details",
  [ROSTER_PARTS.freeLeads]: "free-lead status",
};

/** The plain-English name of a read; an unknown read keeps its RPC name. */
export function sourceLabel(name: string): string {
  return SOURCE_LABELS[name] ?? name;
}

/** A failure tagged with the read that produced it. */
export type SourceError = Error & { source: string; code?: string };

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Tag a failure with the read that produced it, so a source assembled from several reads can say which one failed.
 * The message and code are kept, so errorMessage() still turns a known code (42501, 57014) or a network failure into
 * plain English.
 */
export function sourceError(source: string, err: unknown): SourceError {
  const o = err !== null && typeof err === "object" ? (err as Record<string, unknown>) : {};
  const message = typeof err === "string" ? err.trim() : text(o.message) || text(o.details);
  const tagged = new Error(message) as SourceError;
  tagged.source = source;
  const code = typeof o.code === "number" ? String(o.code) : text(o.code);
  if (code) tagged.code = code;
  return tagged;
}

/** The read a failure was tagged with by sourceError, or null when it carries no tag. */
export function failedReadOf(err: unknown): string | null {
  if (err === null || typeof err !== "object") return null;
  return text((err as { source?: unknown }).source) || null;
}

/**
 * One part of a composite read: its rows, or a failure tagged with the part's own name. A part that stops exactly at
 * the platform page limit fails too (ensureCompleteRead), so the roster never quietly ends at row 1,000, and a result
 * that is not a list fails rather than being counted as nobody.
 */
export function partRows<T>(name: string, result: { data: unknown; error: unknown }): T[] {
  if (result.error) throw sourceError(name, result.error);
  if (result.data === null || result.data === undefined) return [];
  if (!Array.isArray(result.data)) throw sourceError(name, `${name} did not return a list`);
  try {
    ensureCompleteRead(name, result.data);
  } catch (err) {
    throw sourceError(name, err);
  }
  return result.data as T[];
}

export interface ProductionMetricSnapshot {
  total: number;
  active: number;
  inactive: number;
  terminated: number;
  producing_mtd: number;
  mtd_alp: number | string;
  book_last_posted: string | null;
}

export interface TodayProductionSnapshot {
  today_alp: number | string;
  today_policies: number;
  selling_streak_days: number;
  business_date: string;
}

export type MetricSourceStatus = "loading" | "error" | "ready";

/** One read the strip depends on, carried with its own availability. */
export interface MetricSource<T> {
  status: MetricSourceStatus;
  /**
   * The last completed result. null while loading, after a failure with nothing cached, and for a completed read
   * that returned no row.
   */
  value: T | null;
  /** The latest refresh failed but an earlier result is still on hand; value is that earlier result. */
  stale: boolean;
  error: unknown;
  /** Epoch ms of the last completed read (TanStack dataUpdatedAt), for the stale notice. */
  asOf: number | null;
}

export interface MetricSourceQuery<T> extends QueryStatusInput {
  data?: T | null;
  error?: unknown;
  dataUpdatedAt?: number;
}

/**
 * Map a TanStack query result to a source. A completed read that returned null or no rows is ready, not empty: for a
 * roster that is a true count of zero, for a one-row summary it is "no row", which teamFigures reports as unavailable
 * under the source's name rather than as zeros.
 */
export function metricSource<T>(q: MetricSourceQuery<T>): MetricSource<T> {
  const status = queryStatus({ isPending: q.isPending, isLoading: q.isLoading, isError: q.isError, data: q.data, isEmpty: false });
  const ready = status !== "loading" && status !== "error";
  return {
    status: ready ? "ready" : status,
    value: ready ? (q.data ?? null) : null,
    stale: queryStale({ isError: q.isError, data: q.data }),
    error: q.error ?? null,
    asOf: typeof q.dataUpdatedAt === "number" && q.dataUpdatedAt > 0 ? q.dataUpdatedAt : null,
  };
}

export interface RosterDerived {
  /** Active agents actually working the business: no inactive, terminated or sync-only placeholder seats. */
  teamSize: number;
  /** Joined 30 days ago or less with zero lifetime deals: the activation queue. */
  newHires30dNoSale: number;
}

/** The two roster-derived figures. A null is_sync_only is a person; only an explicit true is a placeholder seat. */
export function rosterDerived(rows: readonly RosterRow[]): RosterDerived {
  const working = rows.filter((r) => r.status === "active" && r.is_sync_only !== true);
  return {
    teamSize: working.length,
    newHires30dNoSale: working.filter((r) => (r.tenure_days ?? 9999) <= 30 && (r.lifetime_deals ?? 0) === 0).length,
  };
}

/** Compact USD for the strip. "Nothing posted yet" when the amount is zero or not a number. */
export function compactUsd(value: number | string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "Nothing posted yet";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

export type FigureState = "loading" | "unavailable" | "ready";

export interface TeamFigure {
  key: "team_size" | "producing_mtd" | "new_hires_no_sale" | "mtd_alp";
  label: string;
  /** The read this figure comes from. */
  source: string;
  state: FigureState;
  /** The formatted figure; present only when ready. */
  value: string | null;
  note: string | null;
  tone: string;
}

export const REASON_FAILED = "could not be read";
export const REASON_EMPTY = "came back empty";

/** Why a source has no figure to show, or null when it has one (or is still loading). */
export function unavailableReason(source: MetricSource<unknown>): string | null {
  if (source.status === "error") return REASON_FAILED;
  if (source.status === "ready" && source.value === null) return REASON_EMPTY;
  return null;
}

/**
 * True when the strip names this source under the figures: it has nothing to show (failed, or came back empty) or it
 * shows an earlier result because the latest refresh failed. sourceReport lists exactly these sources and the page's
 * Retry refetches exactly these, so the Retry button can never be shown for a source it will not refetch.
 */
export function sourceNeedsRetry(source: MetricSource<unknown>): boolean {
  return unavailableReason(source) !== null || source.stale;
}

function figureState(source: MetricSource<unknown>): FigureState {
  if (source.status === "loading") return "loading";
  return source.value === null ? "unavailable" : "ready";
}

const BLANK = { value: null, note: null, tone: "text-muted-foreground" } as const;

/**
 * The four team figures, each graded by its own source. With the roster failed and the summary ready, Team size and
 * New hires, no sale are unavailable (never 0) while Producing this month and Month-to-date ALP keep their numbers;
 * the reverse holds when the summary fails and the roster is ready.
 */
export function teamFigures(segments: MetricSource<ProductionMetricSnapshot>, roster: MetricSource<RosterDerived>): TeamFigure[] {
  const rosterState = figureState(roster);
  const segmentsState = figureState(segments);
  const r = roster.value;
  const s = segments.value;
  return [
    {
      key: "team_size", label: "Team size", source: SOURCE_ROSTER, state: rosterState,
      ...(rosterState === "ready" && r ? { value: r.teamSize.toLocaleString(), note: null, tone: "text-foreground" } : BLANK),
    },
    {
      key: "producing_mtd", label: "Producing this month", source: SOURCE_SEGMENTS, state: segmentsState,
      ...(segmentsState === "ready" && s ? { value: s.producing_mtd.toLocaleString(), note: null, tone: "text-success" } : BLANK),
    },
    {
      key: "new_hires_no_sale", label: "New hires, no sale", source: SOURCE_ROSTER, state: rosterState,
      ...(rosterState === "ready" && r
        ? { value: r.newHires30dNoSale.toLocaleString(), note: null, tone: r.newHires30dNoSale > 0 ? "text-amber-700 dark:text-amber-400" : "text-foreground" }
        : BLANK),
    },
    {
      key: "mtd_alp", label: "Month-to-date ALP", source: SOURCE_SEGMENTS, state: segmentsState,
      ...(segmentsState === "ready" && s
        ? { value: compactUsd(s.mtd_alp), note: s.book_last_posted ? `through ${s.book_last_posted}` : null, tone: "text-foreground" }
        : BLANK),
    },
  ];
}

export interface TodayLine {
  state: FigureState;
  /** "$0" when nothing is posted yet on a completed read; null unless ready. */
  amount: string | null;
  policies: number | null;
  streakDays: number | null;
}

/** Today's line. A failed read gives no policy count and no streak, so "(0 policies)" cannot stand in for a failure. */
export function todayLine(today: MetricSource<TodayProductionSnapshot>): TodayLine {
  const state = figureState(today);
  const v = today.value;
  if (state !== "ready" || !v) return { state, amount: null, policies: null, streakDays: null };
  return {
    state,
    amount: compactUsd(v.today_alp).replace("Nothing posted yet", "$0"),
    policies: Number(v.today_policies ?? 0),
    streakDays: Number(v.selling_streak_days ?? 0),
  };
}

export interface NamedSource { name: string; source: MetricSource<unknown> }
export interface MissingSource {
  /** The strip source with nothing to show (one of the SOURCE_ names). */
  source: string;
  /** The read that failed: the source itself, or the part of a composite source that failed (see partRows). */
  name: string;
  reason: string;
  message: string | null;
}
export interface StaleSource {
  /** The strip source showing an earlier result. */
  source: string;
  /** The read whose refresh failed: the source itself, or the part of a composite source that failed. */
  name: string;
  asOf: number | null;
  message: string;
}
export interface SourceReport { missing: MissingSource[]; stale: StaleSource[] }

/**
 * Sources with nothing to show (failed, or came back empty) and sources showing an earlier result because the latest
 * refresh failed: exactly the sources sourceNeedsRetry() selects. Each entry names the read that failed, so a partial
 * failure of the roster identifies the RPC that did not load rather than the composite.
 */
export function sourceReport(sources: readonly NamedSource[]): SourceReport {
  const missing: MissingSource[] = [];
  const stale: StaleSource[] = [];
  for (const { name, source } of sources) {
    if (!sourceNeedsRetry(source)) continue;
    const failed = failedReadOf(source.error) ?? name;
    const reason = unavailableReason(source);
    if (reason) {
      const hasError = source.status === "error" || source.stale;
      missing.push({ source: name, name: reason === REASON_EMPTY ? name : failed, reason, message: hasError ? errorMessage(source.error) : null });
    } else {
      stale.push({ source: name, name: failed, asOf: source.asOf, message: errorMessage(source.error) });
    }
  }
  return { missing, stale };
}

/** "Not loaded: the team roster, because agent contact details (crm_agent_contacts) could not be read. <why>" */
export function missingSentence(missing: MissingSource): string {
  const what = missing.name === missing.source
    ? `${sourceLabel(missing.source)} (${missing.source}) ${missing.reason}`
    : `${sourceLabel(missing.source)}, because ${sourceLabel(missing.name)} (${missing.name}) ${missing.reason}`;
  return `Not loaded: ${what}.${missing.message ? ` ${missing.message}` : ""}`;
}

/** "Showing the team roster (crm_agent_roster) as of 12:30 PM MST. The latest refresh failed. <why>" */
export function staleSentence(stale: StaleSource, formatTime: (epochMs: number) => string = formatAsOf): string {
  const when = stale.asOf !== null ? `as of ${formatTime(stale.asOf)}` : "from an earlier read";
  const why = stale.name === stale.source
    ? "The latest refresh failed."
    : `The latest refresh failed because ${sourceLabel(stale.name)} (${stale.name}) ${REASON_FAILED}.`;
  return `Showing ${sourceLabel(stale.source)} (${stale.source}) ${when}. ${why} ${stale.message}`;
}
