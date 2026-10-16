/**
 * recruitingShortLink.ts: what apex-financial.org/r/<code> carries to /apply.
 *
 * The path code is the recruiter, so a ?ref= the visitor's URL already held
 * is dropped (the short link wins). Every other key (utm_*, source, fbclid,
 * campaign tags) and the #hash ride along so campaign attribution survives
 * the hop. Before 2026-10-15 the forward kept only the code.
 */
const DROPPED_KEYS: readonly string[] = ["ref"];

/** Extra query to append after `/apply?ref=<code>`: "" or "&k=v&k2=v2". */
export function carriedQuery(search: string | null | undefined, drop: readonly string[] = DROPPED_KEYS): string {
  const params = new URLSearchParams(search ?? "");
  for (const key of drop) params.delete(key);
  const query = params.toString();
  return query ? `&${query}` : "";
}

/** Destination when the short link has no usable code: /apply plus whatever the visitor brought. */
export function shortLinkFallbackTarget(search: string | null | undefined, hash: string | null | undefined): string {
  const params = new URLSearchParams(search ?? "");
  const query = params.toString();
  const anchor = hash && hash.length > 1 ? hash : "";
  return `/apply${query ? `?${query}` : ""}${anchor}`;
}
