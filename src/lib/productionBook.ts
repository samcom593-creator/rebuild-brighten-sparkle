/**
 * Helpers for the Production page (src/pages/MyDeals.tsx), 2026-10-15
 * Galaxy OS map findings F08, F09 and F11.
 *
 * Almost everything here is plain data in, plain data out, so the page's
 * contracts can be proven in vitest without a browser or a database:
 *
 *   - status buckets: the exact mirror of v_book_status_tiles' CASE, turned
 *     into a PostgREST filter so a tile click lists the rows the tile counted;
 *   - keyset cursors: the "next server range in the same order" for the
 *     unified book, keyed on (posted_date desc, row_key asc);
 *   - agency periods: one measure per period for Production by Agency, so the
 *     amount, bar, sort, total and range label can never disagree.
 *
 * The one read, countStatusBucketsInScope, takes the client as an argument so
 * a test drives it with a stub.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { monthStartKey, shiftDateKey } from "@/lib/businessClock";

/**
 * Rows requested per server page from v_production_unified. The page writes the
 * literal `.limit(3000)` because scripts/check-native-deals.mjs pins it as the
 * "full book" contract; a test pins the two numbers to each other.
 *
 * The request is not what comes back: PostgREST on this project answers at most
 * 1,000 rows per request whatever .limit() asks for. So the size of a page says
 * nothing about whether more rows exist; see dealsPageMayContinue.
 */
export const DEALS_PAGE_SIZE = 3000;

/** The order every page of the book is read in. posted_date has ties (about 220 dates on 2026-10-15), so row_key breaks them. */
export type DealsCursor = { posted_date: string | null; row_key: string };

/**
 * Quote a value for a PostgREST logic-tree filter. Reserved characters
 * (comma, dot, colon, parentheses) and spaces must sit inside double quotes;
 * a backslash escapes a quote or a backslash inside them.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function dealsCursorAfter(row: DealsCursor): DealsCursor {
  return { posted_date: row.posted_date, row_key: row.row_key };
}

/**
 * The `.or()` expression that selects every row strictly after `cursor` in
 * (posted_date desc nulls last, row_key asc) order. Rows with no posted_date
 * sort last, so a cursor with a date still has to admit them.
 */
export function dealsPageCursorFilter(cursor: DealsCursor): string {
  const key = quoteFilterValue(cursor.row_key);
  if (cursor.posted_date === null) return `and(posted_date.is.null,row_key.gt.${key})`;
  const day = quoteFilterValue(cursor.posted_date);
  return `posted_date.lt.${day},and(posted_date.eq.${day},row_key.gt.${key}),posted_date.is.null`;
}

/**
 * True when rows remain after this page (F09).
 *
 * `matching` is the server's exact count of rows that satisfied this page's
 * filters, cursor included, returned with the page through count: "exact". It
 * ignores the row cap, so a page that holds fewer rows than matched was cut
 * short and the next range exists. The rule this replaces compared the page
 * length to the 3,000 rows requested; the server caps a response at 1,000, so
 * no page ever reached 3,000 and the list stopped at 1,000 of 1,373 deals.
 *
 * With no count (the server sent none), a non-empty page may continue and an
 * empty page ends the list: the list can ask once too often but never stops
 * early.
 */
export function dealsPageMayContinue(pageLength: number, matching: number | null): boolean {
  if (pageLength <= 0) return false;
  if (matching === null) return true;
  return pageLength < matching;
}

export type StatusBucket =
  | "active"
  | "issued_not_paid"
  | "in_review"
  | "lapse_pending"
  | "lapsed"
  | "cancelled"
  | "withdrawn"
  | "not_taken"
  | "postponed"
  | "carrier_na";

/**
 * Mirror of the CASE in public.v_book_status_tiles as read from pg_get_viewdef
 * on 2026-10-15. The view compares lower(status), so the list filter uses a
 * case-insensitive equality (ILIKE with no wildcard) on the same literals.
 * carrier_na is the view's ELSE branch: a null status, or any value the other
 * nine do not claim. The view is the authority; if its CASE changes, this map
 * and the tile counts drift apart and a tile click stops listing what it counted.
 */
export const STATUS_BUCKET_LITERALS: Readonly<Record<Exclude<StatusBucket, "carrier_na">, readonly string[]>> = {
  active: ["active"],
  issued_not_paid: ["issued", "approved"],
  in_review: ["in review", "pending", "submitted"],
  lapse_pending: ["lapse pending"],
  lapsed: ["lapsed"],
  cancelled: ["cancelled"],
  withdrawn: ["withdrawn"],
  not_taken: ["not taken", "declined"],
  postponed: ["postponed"],
};

export const STATUS_BUCKETS: readonly StatusBucket[] = [
  "active",
  "issued_not_paid",
  "in_review",
  "lapse_pending",
  "lapsed",
  "cancelled",
  "withdrawn",
  "not_taken",
  "postponed",
  "carrier_na",
];

/** Whitelist an untrusted value (URL param) down to a known bucket, or null. */
export function parseStatusBucket(raw: string | null | undefined): StatusBucket | null {
  if (!raw) return null;
  return (STATUS_BUCKETS as readonly string[]).includes(raw) ? (raw as StatusBucket) : null;
}

/** Every literal the nine named buckets claim; the ELSE bucket is everything else. */
function claimedStatusLiterals(): string[] {
  return Object.values(STATUS_BUCKET_LITERALS).flat();
}

/**
 * The `.or()` expression that selects exactly the rows v_book_status_tiles
 * counts under `bucket`. Literals come from this module, never from user input.
 */
export function statusBucketFilter(bucket: StatusBucket): string {
  if (bucket === "carrier_na") {
    const excluded = claimedStatusLiterals()
      .map((value) => `status.not.ilike.${quoteFilterValue(value)}`)
      .join(",");
    return `status.is.null,and(${excluded})`;
  }
  return STATUS_BUCKET_LITERALS[bucket].map((value) => `status.ilike.${quoteFilterValue(value)}`).join(",");
}

export type ProductionBookClient = Pick<SupabaseClient<Database>, "from">;

export type StatusBucketCount = { bucket: StatusBucket; n: number };

/**
 * Exact deal count per status bucket for the rows whose agent is in
 * `agentIds`: the team-scoped tiles a manager sees (F11). Each count applies
 * the same scope and the same statusBucketFilter the deal list applies, so a
 * tile click lists exactly the rows its tile counted. v_book_status_tiles is
 * agency-wide (v_production_unified has no caller filter), which is why it only
 * serves the admin view.
 *
 * A failed read, or a response without a count, throws: an unread bucket is
 * never shown as zero. An empty scope has no rows, so every bucket is 0
 * without a read.
 */
export async function countStatusBucketsInScope(
  client: ProductionBookClient,
  agentIds: readonly string[],
): Promise<StatusBucketCount[]> {
  if (agentIds.length === 0) return STATUS_BUCKETS.map((bucket) => ({ bucket, n: 0 }));
  const ids = [...agentIds];
  return Promise.all(
    STATUS_BUCKETS.map(async (bucket) => {
      const { count, error } = await client
        .from("v_production_unified")
        .select("row_key", { count: "exact", head: true })
        .in("agent_id", ids)
        .or(statusBucketFilter(bucket));
      if (error) throw error;
      if (typeof count !== "number") throw new Error("The server did not return a count for a policy status.");
      return { bucket, n: count };
    }),
  );
}

/**
 * Which tiles to show at once. Buckets with rows always show; empty buckets
 * fold behind a "More statuses" control, except the one currently filtering
 * (a deep link can name an empty bucket and must stay visible). If every
 * bucket is empty, nothing folds, so the grid is never blank.
 */
export function splitStatusTiles<T extends { key: StatusBucket }>(
  tiles: readonly T[],
  countOf: (key: StatusBucket) => number,
  active: StatusBucket | null,
): { shown: T[]; folded: T[] } {
  const shown = tiles.filter((tile) => countOf(tile.key) > 0 || tile.key === active);
  if (shown.length === 0) return { shown: [...tiles], folded: [] };
  const shownKeys = new Set(shown.map((tile) => tile.key));
  return { shown, folded: tiles.filter((tile) => !shownKeys.has(tile.key)) };
}

export type AgencyPeriod = "mtd" | "30d" | "all";

export const AGENCY_PERIODS: readonly { key: AgencyPeriod; label: string }[] = [
  { key: "mtd", label: "This month" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All time" },
];

/** One row of v_imo_by_agency as the page reads it. Null means the view had no premium to sum, not zero. */
export interface AgencyPeriodRow {
  agency: string;
  is_primary: boolean | null;
  policies: number | null;
  alp: number | null;
  alp_mtd: number | null;
  policies_mtd: number | null;
  policies_30d: number | null;
  alp_30d: number | null;
}

export interface AgencyMeasure {
  alp: number | null;
  policies: number | null;
}

/** The one (alp, policies) pair the chosen period reads from a view row. */
export function agencyPeriodMeasure(row: AgencyPeriodRow, period: AgencyPeriod): AgencyMeasure {
  switch (period) {
    case "mtd":
      return { alp: row.alp_mtd, policies: row.policies_mtd };
    case "30d":
      return { alp: row.alp_30d, policies: row.policies_30d };
    default:
      return { alp: row.alp, policies: row.policies };
  }
}

export interface AgencyPeriodSummary {
  rows: Array<{ agency: string; is_primary: boolean; alp: number | null; policies: number | null; share: number }>;
  /** Sum of the displayed amounts (nulls contribute nothing). */
  total: number;
  policies: number;
  max: number;
}

/**
 * Amount, bar share, sort order and total for one period, all from the same
 * measure. Rows sort by that measure descending; a null amount sorts last and
 * draws no bar.
 */
export function summarizeAgencyPeriod(rows: readonly AgencyPeriodRow[], period: AgencyPeriod): AgencyPeriodSummary {
  const measured = rows.map((row) => {
    const m = agencyPeriodMeasure(row, period);
    return { agency: row.agency, is_primary: row.is_primary === true, alp: m.alp, policies: m.policies };
  });
  const amounts = measured.map((row) => row.alp).filter((value): value is number => typeof value === "number");
  const max = amounts.length ? Math.max(...amounts) : 0;
  const total = amounts.reduce((sum, value) => sum + value, 0);
  const policies = measured.reduce((sum, row) => sum + (row.policies ?? 0), 0);
  const sorted = [...measured].sort((a, b) => (b.alp ?? -1) - (a.alp ?? -1) || a.agency.localeCompare(b.agency));
  return {
    rows: sorted.map((row) => ({ ...row, share: max > 0 && row.alp !== null ? row.alp / max : 0 })),
    total,
    policies,
    max,
  };
}

/**
 * The inclusive posted_date bounds each period covers, exactly as
 * v_imo_by_agency computes them from the Phoenix calendar day:
 *   mtd  = first of the month .. today
 *   30d  = today minus 30 days .. today
 *   all  = no bounds
 */
export function agencyPeriodRange(period: AgencyPeriod, todayKey: string): { start: string; end: string } | null {
  if (period === "mtd") return { start: monthStartKey(todayKey), end: todayKey };
  if (period === "30d") return { start: shiftDateKey(todayKey, -30), end: todayKey };
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-01" -> "Oct 1" (or "Oct 1, 2026" with the year). Pure string work, no Date, no zone. */
export function formatDateKey(key: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return key;
  const day = Number(m[3]);
  return withYear ? `${month} ${day}, ${m[1]}` : `${month} ${day}`;
}

/**
 * The explicit range a period covers, for the section heading. All time has no
 * bounds, so it has no range to show (null), and the heading does not repeat
 * "All time" twice.
 */
export function agencyPeriodRangeLabel(period: AgencyPeriod, todayKey: string): string | null {
  const range = agencyPeriodRange(period, todayKey);
  if (!range) return null;
  const crossesYear = range.start.slice(0, 4) !== range.end.slice(0, 4);
  return `${formatDateKey(range.start, crossesYear)} to ${formatDateKey(range.end, crossesYear)}`;
}
