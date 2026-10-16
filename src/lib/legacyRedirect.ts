/**
 * legacyRedirect.ts: the one-hop destination for a retired URL.
 *
 * Every alias in src/App.tsx points straight at the page that now owns the
 * work (never at another alias), and the visitor's own ?query and #hash ride
 * along so a bookmarked filter, a selected record or an anchor survives the
 * move. When the canonical target carries its own query (for example
 * /dashboard/team?view=contracting), the target's keys win, because the alias
 * exists to open that specific view; every other key the visitor brought is
 * appended. The result never holds two '?' characters.
 *
 * Measured at HEAD on 2026-10-15 before this helper: 16 of 49 redirect routes
 * were chains of two or three hops and 32 were plain <Navigate> elements that
 * dropped the query string.
 */
export interface RedirectLocationLike {
  search?: string | null;
  hash?: string | null;
}

export function legacyRedirectTarget(to: string, location: RedirectLocationLike): string {
  const hashAt = to.indexOf("#");
  const targetHash = hashAt >= 0 ? to.slice(hashAt) : "";
  const targetNoHash = hashAt >= 0 ? to.slice(0, hashAt) : to;
  const queryAt = targetNoHash.indexOf("?");
  const pathname = queryAt >= 0 ? targetNoHash.slice(0, queryAt) : targetNoHash;
  const fixed = new URLSearchParams(queryAt >= 0 ? targetNoHash.slice(queryAt + 1) : "");

  const params = new URLSearchParams(location.search ?? "");
  fixed.forEach((value, key) => params.set(key, value));
  const query = params.toString();

  const incomingHash = location.hash ?? "";
  const hash = incomingHash.length > 1 ? incomingHash : targetHash;

  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}
