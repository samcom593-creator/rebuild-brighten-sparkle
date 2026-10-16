/**
 * The Calendar's "In view" number (F31 in the 2026-10-14 Galaxy OS map), and
 * every other count the page derives from the rows it paints: the selected
 * day's count line, the grid cells' accessible names, the empty-list wording
 * and the kind chips.
 *
 * calendar_window_counts(p_from, p_to) counts every event in the window by
 * kind and knows nothing about the "Show canceled" switch: it counts a
 * canceled interview and never counts a cancelled appointment, while the
 * merged rows apply the switch. So the tile is derived from the SAME merged
 * rows the grid paints, under the same filter (kind, canceled visibility,
 * scope, window). The server count stays where it is complete and labelled
 * as such: the truncation notice, and the kind chips whenever the rows on
 * screen are not a complete read.
 *
 * An array length is only a count when the read was complete. Both feeds are
 * paged past PostgREST's 1000-row cap (calendarApi.fetchAllPages) and report
 * truncation, so a cut-off read is reported as a floor, a feed that did not
 * answer as partial, and nothing readable as unavailable. Never as 0.
 */
export type FeedRead = {
  /**
   * No result yet and no final error (TanStack isPending): the first read is
   * running or waiting for the network. isLoading is not enough: a fetch
   * paused while offline has isLoading false and still no rows.
   */
  isPending: boolean;
  /** The latest read failed (TanStack isError). Rows from an earlier read may still be on screen. */
  isError: boolean;
  /** The paged read stopped at its page cap, so the rows are a prefix. */
  truncated: boolean;
  /** Rows from this feed are on screen: the latest read, or the last good one the page kept after a failed refresh. */
  painted: boolean;
};

export type FailedFeed = "dates" | "appointments" | "both";

export type InViewCount =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "exact"; n: number }
  | { status: "floor"; n: number }
  | { status: "partial"; n: number; failed: FailedFeed };

/**
 * `shown` is the length of the merged, filtered rows on screen. It is the
 * exact match count only when both feeds answered and neither was cut off.
 * When both feeds failed it is unavailable only if nothing is painted; rows
 * kept from an earlier read are reported as partial ("both"), not hidden.
 */
export function inViewCount(shown: number, dates: FeedRead, appointments: FeedRead): InViewCount {
  if (dates.isPending || appointments.isPending) return { status: "loading" };
  if (dates.isError && appointments.isError) {
    return dates.painted || appointments.painted
      ? { status: "partial", n: shown, failed: "both" }
      : { status: "unavailable" };
  }
  if (dates.isError) return { status: "partial", n: shown, failed: "dates" };
  if (appointments.isError) return { status: "partial", n: shown, failed: "appointments" };
  if (dates.truncated || appointments.truncated) return { status: "floor", n: shown };
  return { status: "exact", n: shown };
}

/** The number to print, or null when no number is true (loading, unavailable). */
export function inViewValue(count: InViewCount): string | null {
  switch (count.status) {
    case "exact":
    case "partial":
      return count.n.toLocaleString();
    case "floor":
      return `${count.n.toLocaleString()}+`;
    default:
      return null;
  }
}

const PARTIAL_NOTE: Record<FailedFeed, string> = {
  dates: "partial: the date feed did not answer",
  appointments: "partial: the appointments feed did not answer",
  both: "partial: neither feed answered; showing the last rows that loaded",
};

/** The caption under the number; the range label when the number is exact. */
export function inViewNote(count: InViewCount, rangeLabel: string): string {
  switch (count.status) {
    case "floor":
      return `at least; the list is cut off (${rangeLabel})`;
    case "partial":
      return PARTIAL_NOTE[count.failed];
    default:
      return rangeLabel;
  }
}

/**
 * The count line for one day (the selected-day header), under the tile's
 * rule: a number only when one was read. Null while loading and when nothing
 * is readable, so the caller renders the shared loading or error state
 * instead of "0 events".
 */
export function dayCountText(count: InViewCount, n: number): string | null {
  if (count.status === "loading" || count.status === "unavailable") return null;
  const line = `${n.toLocaleString()} event${n === 1 ? "" : "s"} in view`;
  if (count.status === "partial") return `${line} · ${PARTIAL_NOTE[count.failed]}`;
  if (count.status === "floor") return `${line} · at least; the range is cut off`;
  return line;
}

/** The same count for a grid cell's accessible name. */
export function dayCountAria(count: InViewCount, n: number): string {
  return dayCountText(count, n) ?? (count.status === "unavailable" ? "events unavailable" : "events loading");
}

/**
 * What an empty day or list was measured against, appended to "Nothing on
 * this day". Empty when both feeds answered in full; otherwise it says which
 * rows the "nothing" covers, so a feed that did not answer is never read as
 * an empty day.
 */
export function emptyQualifier(count: InViewCount): string {
  switch (count.status) {
    case "partial":
      return count.failed === "both" ? " in the last rows that loaded" : " in the feed that answered";
    case "floor":
      return " in the rows that loaded; the range is cut off";
    default:
      return "";
  }
}

/** How many of the given rows each kind has. */
export function tallyKinds(items: ReadonlyArray<{ kind: string }>): Record<string, number> {
  // No prototype, so a kind can never collide with an Object.prototype key.
  const tally = Object.create(null) as Record<string, number>;
  for (const item of items) tally[item.kind] = (tally[item.kind] ?? 0) + 1;
  return tally;
}

export type KindChipCount = { n: number; from: "rows" | "server" };

/**
 * The number on a kind chip. When both feeds answered in full it is the
 * tally of the rows painted for that kind with every kind on, so it follows
 * "Show canceled" exactly as In view does, and the chips of the active kinds
 * add up to In view. Otherwise it is the server's total for the window
 * (complete, but blind to the switch). Null while the rows are loading, and
 * when the server count was not read either.
 */
export function kindChipCount(
  kind: string,
  count: InViewCount,
  rowTally: Record<string, number> | null,
  serverCounts: Record<string, number> | null,
): KindChipCount | null {
  if (count.status === "loading") return null;
  if (count.status === "exact" && rowTally) return { n: rowTally[kind] ?? 0, from: "rows" };
  return serverCounts ? { n: serverCounts[kind] ?? 0, from: "server" } : null;
}
