/**
 * Book of Business standing (OVERHAUL-book, 2026-10-29).
 *
 * Sam: "For the Book of Business tab, remove the advanced financial flow. It should be breakdown of
 * people who are here and not people who aren't here. Just use logic."
 *
 * Every policy on public.v_book_of_business carries a `standing` and a normalised `status_key`, both
 * computed in the database (supabase/migrations/20261029180000_book_of_business_standing.sql):
 *
 *   active   on the books: in force, approved, issued, paid
 *   pending  on its way: in review, pending, submitted, issued but not paid yet
 *   lapsing  slipping off: lapse pending or lapsed (a missed payment that can still be saved)
 *   gone     off the books: declined, not taken, withdrawn, cancelled, or marked dead by AgentLink
 *   unknown  the carrier sent no status, or the row is production reported as a total (no client)
 *
 * The groups are Book Flips' own (v_book_flip_worklist.status_group), so a client reads the same on
 * both pages. The database is the authority for every count and every filter: the page counts with
 * book_of_business_counts() and lists with the same `standing` / `status_key` filters, so a tile's
 * number is the length of the list it opens. This module holds the words, the tones and the pure
 * arithmetic, and a test pins STANDING_STATUS_KEYS to the migration's CASE so the two cannot drift.
 */
import { bookStandingTone, type Tone } from "@/lib/tones";

export type BookStanding = "active" | "pending" | "lapsing" | "gone" | "unknown";
export type KnownStanding = Exclude<BookStanding, "unknown">;

/** The four the page leads with, in reading order: on the books, on its way, slipping, off. */
export const BOOK_STANDINGS: readonly KnownStanding[] = ["active", "pending", "lapsing", "gone"];
export const ALL_STANDINGS: readonly BookStanding[] = [...BOOK_STANDINGS, "unknown"];

/** The status keys the view puts in each standing, exactly as its CASE lists them. */
export const STANDING_STATUS_KEYS: Readonly<Record<KnownStanding, readonly string[]>> = {
  active: ["active", "approved", "issued", "in_force", "paid"],
  pending: ["pending", "in_review", "submitted", "underwriting", "issued_not_paid", "approved_not_issued", "needs_review"],
  lapsing: ["lapse_pending", "lapsed", "grace_period"],
  gone: [
    "declined", "withdrawn", "not_taken", "cancelled", "terminated", "postponed", "rescinded",
    "surrendered", "deceased", "closed", "incomplete", "charged_back", "not_in_force",
  ],
};

export interface StandingMeta {
  label: string;
  /** One short line under the number: what it counts, in plain words. */
  hint: string;
  /** The full rule, for the tile's title and the list heading. */
  definition: string;
  /** What the list says when nothing in this standing is in view. */
  emptyTitle: string;
  tone: Tone;
}

export const STANDING_META: Readonly<Record<BookStanding, StandingMeta>> = {
  active: {
    label: "Active",
    hint: "On the books and in force",
    definition: "Policies the carrier lists as Active, Approved, Issued, In force or Paid.",
    emptyTitle: "No active policies",
    tone: bookStandingTone("active"),
  },
  pending: {
    label: "Pending",
    hint: "Waiting on the carrier or a first payment",
    definition: "Policies In review, Pending, Submitted, or Issued but not paid yet.",
    emptyTitle: "No pending policies",
    tone: bookStandingTone("pending"),
  },
  lapsing: {
    label: "Lapsing",
    hint: "Missed a payment. Call to save them",
    definition: "Policies in Lapse pending or Lapsed. A lapsed policy can often still be reinstated.",
    emptyTitle: "Nobody is lapsing",
    tone: bookStandingTone("lapsing"),
  },
  gone: {
    label: "Gone",
    hint: "No longer on the books",
    definition: "Policies Declined, Not taken, Withdrawn, Cancelled or Charged back, or marked dead by AgentLink.",
    emptyTitle: "Nobody has left the books",
    tone: bookStandingTone("gone"),
  },
  unknown: {
    label: "No status yet",
    hint: "The carrier has not reported a status",
    definition: "Policies the carrier feed sent no status for, and production an agency reported as a total with no client.",
    emptyTitle: "Every policy has a status",
    tone: bookStandingTone("unknown"),
  },
};

const STATUS_LABEL: Readonly<Record<string, string>> = {
  active: "Active",
  approved: "Approved",
  issued: "Issued",
  in_force: "In force",
  paid: "Paid",
  pending: "Pending",
  in_review: "In review",
  submitted: "Submitted",
  underwriting: "Underwriting",
  issued_not_paid: "Issued, not paid",
  approved_not_issued: "Approved, not issued",
  needs_review: "Needs review",
  lapse_pending: "Lapse pending",
  lapsed: "Lapsed",
  grace_period: "Grace period",
  declined: "Declined",
  withdrawn: "Withdrawn",
  not_taken: "Not taken",
  cancelled: "Cancelled",
  terminated: "Terminated",
  postponed: "Postponed",
  rescinded: "Rescinded",
  surrendered: "Surrendered",
  deceased: "Deceased",
  closed: "Closed",
  incomplete: "Incomplete",
  charged_back: "Charged back",
  not_in_force: "Not in force",
  unknown: "No status yet",
  reported_external: "Reported as a total",
};

/** "issued_not_paid" -> "Issued, not paid"; a key the page has no words for reads as itself. */
export function statusKeyLabel(key: string | null | undefined): string {
  const k = (key ?? "").trim();
  if (!k) return STATUS_LABEL.unknown;
  const known = STATUS_LABEL[k];
  if (known) return known;
  const words = k.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The standing the view gives a status key: one of the four, or unknown for anything else. */
export function standingOfStatusKey(key: string | null | undefined): BookStanding {
  const k = (key ?? "").trim();
  for (const standing of BOOK_STANDINGS) {
    if (STANDING_STATUS_KEYS[standing].includes(k)) return standing;
  }
  return "unknown";
}

/** Whitelist a standing from the URL; anything else is no filter. */
export function parseStanding(value: string | null | undefined): BookStanding | null {
  return value && (ALL_STANDINGS as readonly string[]).includes(value) ? (value as BookStanding) : null;
}

/** A status key from the URL: lower-case words joined by underscores, or no filter. */
export function parseStatusKey(value: string | null | undefined): string | null {
  return value && /^[a-z][a-z_]{0,39}$/.test(value) ? value : null;
}

/**
 * The filter in the URL, reading the page's older links too: `?group=` (the 2026-10-28 chips, where
 * "inactive" is now "gone") and `?status=` (the old ten tiles, whose keys are status keys, except
 * carrier_na, which is "no status yet"). A status key names its own standing.
 */
export function readStandingParams(params: URLSearchParams): { standing: BookStanding | null; statusKey: string | null } {
  const rawStatus = params.get("status");
  if (rawStatus === "carrier_na") return { standing: "unknown", statusKey: null };
  const statusKey = parseStatusKey(rawStatus);
  const group = params.get("group");
  const standing = parseStanding(params.get("standing")) ?? (group === "inactive" ? "gone" : parseStanding(group));
  if (statusKey) return { standing: standing ?? standingOfStatusKey(statusKey), statusKey };
  return { standing, statusKey: null };
}

/** One row of book_of_business_counts(). */
export interface StandingCountRow {
  standing: string | null;
  status_key: string | null;
  n: number | null;
}

export interface StatusCount {
  key: string;
  label: string;
  n: number;
}

export interface StandingSummary {
  /** Every policy counted, which is every row of the list with no filter. */
  total: number;
  byStanding: Record<BookStanding, number>;
  /** Each standing's statuses, largest first: the breakdown under a selected tile. */
  statuses: Record<BookStanding, StatusCount[]>;
}

/**
 * Totals from book_of_business_counts() rows. A standing the page does not know lands in "unknown",
 * the same rows the No status yet list shows (its filter is "none of the four"). A count that is not
 * a whole number at or above zero is a malformed answer and throws, so the tiles say the read failed
 * instead of showing a number nobody can trust.
 */
export function summarizeStanding(rows: readonly StandingCountRow[]): StandingSummary {
  const byStanding: Record<BookStanding, number> = { active: 0, pending: 0, lapsing: 0, gone: 0, unknown: 0 };
  const perStatus = new Map<BookStanding, Map<string, number>>();
  let total = 0;
  for (const row of rows) {
    const n = row.n;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      throw new Error("The book count came back without a number.");
    }
    const standing = parseStanding(row.standing) ?? "unknown";
    const key = (row.status_key ?? "").trim() || "unknown";
    byStanding[standing] += n;
    total += n;
    const keys = perStatus.get(standing) ?? new Map<string, number>();
    keys.set(key, (keys.get(key) ?? 0) + n);
    perStatus.set(standing, keys);
  }
  const statuses = {} as Record<BookStanding, StatusCount[]>;
  for (const standing of ALL_STANDINGS) {
    statuses[standing] = [...(perStatus.get(standing) ?? new Map<string, number>()).entries()]
      .filter(([, n]) => n > 0)
      .map(([key, n]) => ({ key, label: statusKeyLabel(key), n }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  }
  return { total, byStanding, statuses };
}

/** The four standings the "No status yet" list excludes, as a PostgREST `in` list. */
export const KNOWN_STANDINGS_IN_LIST = `(${BOOK_STANDINGS.join(",")})`;
