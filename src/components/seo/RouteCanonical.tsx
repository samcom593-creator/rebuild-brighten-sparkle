import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Keeps <link rel="canonical"> self-referencing on every route.
 *
 * WHY THIS EXISTS (Website Integrity Bot, 2026-11-10, Check #3/SEO):
 * index.html ships ONE static canonical pointing at the homepage
 * (https://apex-financial.org). This is a client-rendered SPA — the Vercel
 * rewrite serves that same static <head> for every non-asset path — so a
 * crawler saw EVERY route (/apply, /vsl, /get-licensed, ...) declare the
 * homepage as its canonical URL. Verified live 2026-11-10: /, /apply, /vsl,
 * /get-licensed and /contact all emitted the identical homepage canonical in
 * raw HTML. Meanwhile sitemap.xml lists those routes as indexable, so the two
 * signals contradicted. Google resolves that by treating the deep routes as
 * duplicates of "/" and dropping them from the index — the recruiting landing
 * pages that should rank for "insurance sales career", "get licensed", etc.
 * were self-excluded from search.
 *
 * Googlebot renders JS, and the canonical it honors is the one present in the
 * RENDERED DOM. Setting a self-referencing canonical per route here makes each
 * funnel page indexable on its own URL. This mirrors the react-helmet-free
 * head-management pattern already used in StateCareerLanding.tsx.
 *
 * Mounted ONCE inside <BrowserRouter> (next to RouteTelemetry), keyed on
 * location.pathname, so it fires on every route including lazy ones — there is
 * no page it can miss, so this is not a per-page opt-in that the 80/20 gap can
 * hide in.
 *
 * ORIGIN IS FIXED, not read from window.location.origin, on purpose: a preview
 * deploy rendered by a crawler (*.vercel.app) must never inject a preview-host
 * canonical into the production index. PROD_ORIGIN is asserted equal to the
 * index.html canonical/og:url host by scripts/check-canonical-url.mjs so the
 * two cannot silently drift (e.g. a future domain rename).
 *
 * Normalization: origin + pathname only — query string and hash are dropped
 * (?utm_source, #section are the same canonical page), and a trailing slash is
 * collapsed except on root. Root stays bare (no trailing slash) to match the
 * static index.html canonical and og:url byte-for-byte.
 */
export const PROD_ORIGIN = "https://apex-financial.org";

export function canonicalHref(pathname: string): string {
  let path = pathname || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path === "/" ? PROD_ORIGIN : `${PROD_ORIGIN}${path}`;
}

export function RouteCanonical() {
  const { pathname } = useLocation();

  useEffect(() => {
    const href = canonicalHref(pathname);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", href);
  }, [pathname]);

  return null;
}
