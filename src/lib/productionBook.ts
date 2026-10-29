/**
 * Helpers for the Book of Business page (src/pages/MyDeals.tsx), 2026-10-15
 * Galaxy OS map finding F09.
 *
 * Plain data in, plain data out, so the page's paging contract can be proven in
 * vitest without a browser or a database: the "next server range in the same
 * order" for the book, keyed on (posted_date desc, row_key asc).
 *
 * OVERHAUL-book (2026-10-29): the ten status-tile buckets and the Production by
 * Agency periods that lived here went with the sections they drew. Where a
 * policy stands is src/lib/bookStanding.ts, counted by the database.
 */

/**
 * Rows requested per server page from the book. The page writes the literal
 * `.limit(3000)` because scripts/check-native-deals.mjs pins it as the "full
 * book" contract; a test pins the two numbers to each other.
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
