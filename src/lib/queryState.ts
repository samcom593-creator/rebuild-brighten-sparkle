/**
 * Query presentation helpers shared by every page that renders a TanStack
 * query result (F10, F15, F19 and F33 in the 2026-10-14 Galaxy OS map).
 *
 * The rule these encode: a failed read is never an empty list or a zero.
 * "empty" is reserved for a read that completed and returned nothing. A
 * refresh that fails while an earlier result is still cached keeps that
 * result on screen as "ready" plus a stale flag, so a page never flips from
 * real numbers to a plausible fake zero.
 *
 * The component that renders these states lives in
 * src/components/ui/query-state.tsx and re-exports this module.
 */
import { dateKeyInZone, formatClock, formatDay, isValidTimeZone, viewerTimeZone, zoneAbbreviation } from "@/lib/calendarTime";

export type QueryStatus = "loading" | "error" | "empty" | "ready";

export interface QueryStatusInput {
  /** TanStack v5: no data has ever loaded for this key. */
  isPending?: boolean;
  /** TanStack v4 name (or v5 isPending && isFetching). Treated like isPending. */
  isLoading?: boolean;
  isError?: boolean;
  data?: unknown;
  /**
   * The caller's own emptiness test for object-shaped data. When omitted, an
   * array with no rows or a null result counts as empty; objects never do.
   */
  isEmpty?: boolean;
}

/** An array with no rows, or a null result, is an empty successful read. Objects are not. */
export function isEmptyResult(data: unknown): boolean {
  if (data === null) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

/**
 * Map a query result to the state the page should show.
 *
 * Order matters:
 *   1. nothing loaded yet            -> loading
 *   2. error with no earlier result   -> error
 *      error with an earlier result   -> ready (the caller shows it as stale)
 *   3. a successful read with no rows -> empty
 *   4. otherwise                      -> ready
 *
 * A result with no data and no flags at all is reported as loading, never as
 * empty: the only path to "empty" is a completed read.
 */
export function queryStatus(q: QueryStatusInput): QueryStatus {
  const hasData = q.data !== undefined;
  if (!hasData && (q.isPending || q.isLoading)) return "loading";
  if (q.isError) return hasData ? "ready" : "error";
  if (!hasData) return "loading";
  if (q.isEmpty !== undefined) return q.isEmpty ? "empty" : "ready";
  return isEmptyResult(q.data) ? "empty" : "ready";
}

/** True when the latest refresh failed but an earlier result is still on hand. */
export function queryStale(q: QueryStatusInput): boolean {
  return Boolean(q.isError) && q.data !== undefined;
}

export interface QueryPresentation {
  status: QueryStatus;
  stale: boolean;
  error: unknown;
}

/**
 * One call that returns exactly the props QueryState reads:
 *   <QueryState {...describeQuery(q)} onRetry={() => void q.refetch()} asOf={q.dataUpdatedAt}>
 */
export function describeQuery(q: QueryStatusInput & { error?: unknown }): QueryPresentation {
  return { status: queryStatus(q), stale: queryStale(q), error: q.error ?? null };
}

export const DEFAULT_ERROR_MESSAGE = "Something went wrong while loading.";

/** Plain-English replacements for the Postgres and PostgREST codes people hit most. */
const KNOWN_CODES: Record<string, string> = {
  "42501": "You do not have permission to view this.",
  PGRST301: "Your session has expired. Sign in again to continue.",
  PGRST116: "More than one record matched this request, so the result is ambiguous.",
  "57014": "The server took too long to answer. Retry in a moment.",
  "23505": "A record with these details already exists.",
  "08006": "The database connection was lost. Retry in a moment.",
  "08001": "The database could not be reached. Retry in a moment.",
};

const NETWORK_RX = /failed to fetch|networkerror|network request failed|load failed|err_network|econnrefused|etimedout/i;
const SESSION_RX = /jwt expired|token has expired|invalid jwt/i;

function humanize(message: string, code: string | undefined): string {
  const trimmed = message.trim();
  if (code && KNOWN_CODES[code]) return KNOWN_CODES[code];
  if (NETWORK_RX.test(trimmed)) return "Network error. Check your connection and retry.";
  if (SESSION_RX.test(trimmed)) return KNOWN_CODES.PGRST301;
  return trimmed;
}

/**
 * The message to show for any thrown or returned error: Error instances,
 * strings, Supabase PostgrestError / AuthError / FunctionsError shapes
 * ({ message, code, details, hint }), and the nested { error: { message } }
 * shape functions.invoke contexts carry. Never returns an empty string.
 */
export function errorMessage(err: unknown, fallback: string = DEFAULT_ERROR_MESSAGE): string {
  if (err === null || err === undefined) return fallback;
  if (typeof err === "string") return humanize(err, undefined) || fallback;
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return humanize(err.message, typeof code === "string" ? code : undefined) || fallback;
  }
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (o.error && typeof o.error === "object" && o.error !== err) {
      const nested = errorMessage(o.error, "");
      if (nested) return nested;
    }
    const message = typeof o.message === "string" ? o.message : typeof o.msg === "string" ? o.msg : "";
    const code = typeof o.code === "string" ? o.code : typeof o.code === "number" ? String(o.code) : undefined;
    const human = humanize(message, code);
    if (human) return human;
    if (typeof o.details === "string" && o.details.trim()) return o.details.trim();
    if (code) return `Request failed (${code}).`;
  }
  return fallback;
}

/**
 * Label for "showing data as of ...". Accepts an ISO string, epoch ms, a Date,
 * or an already formatted string (returned untouched). Rendered in the
 * viewer's zone with its abbreviation; the day is added only when it is not
 * the viewer's today. Empty input gives an empty string.
 */
export function formatAsOf(value: string | number | Date | null | undefined, tz?: string, nowMs: number = Date.now()): string {
  if (value === null || value === undefined || value === "") return "";
  const zone = tz && isValidTimeZone(tz) ? tz : viewerTimeZone();
  let d: Date;
  if (value instanceof Date) d = value;
  else if (typeof value === "number") d = new Date(value);
  else if (/^\d{4}-\d{2}-\d{2}T/.test(value)) d = new Date(value);
  else return value;
  if (Number.isNaN(d.getTime())) return typeof value === "string" ? value : "";
  const clock = `${formatClock(d, zone)} ${zoneAbbreviation(d, zone)}`;
  return dateKeyInZone(d, zone) === dateKeyInZone(new Date(nowMs), zone) ? clock : `${formatDay(d, zone)}, ${clock}`;
}
