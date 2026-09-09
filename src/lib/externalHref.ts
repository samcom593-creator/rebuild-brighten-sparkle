// externalHref.ts — MP-495
//
// A URL that arrives from the database is free text, and an <a href> given free
// text is not a link to that site. `aflac.com` has no scheme, so the browser
// resolves it RELATIVE to the current page: on /dashboard/contracting the
// "Website" button navigates to /dashboard/contracting/aflac.com, which matches
// no route, which vercel.json serves 200 (MP-295) and react-router renders as
// the catch-all. Nothing could see it — HTTP monitoring gets a 200,
// check-dead-internal-links only reads literal hrefs in source, and tsc sees a
// string. Found 2026-09-09 by the link crawler's untraversed-tail report and
// corroborated against prod: 3 of 16 carrier rows with a website value.
//
// Returns null for anything that is not a usable http(s) destination, so the
// caller renders its "no URL" state instead of a link that goes nowhere. A
// scheme other than http/https is refused rather than passed through: a
// javascript: value reaching an href from a database column is an XSS sink.

export function externalHref(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Protocol-relative: the page's own scheme, which is https in production.
  const candidate = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;

  // A bare domain has no scheme. Anything with one must be http(s) to be a
  // destination this helper will hand to an href.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(candidate);
  const withScheme = hasScheme ? candidate : `https://${candidate}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // `https://` alone parses, and a host-less URL is not a destination.
  if (!parsed.hostname || !parsed.hostname.includes(".")) return null;
  return parsed.href;
}
