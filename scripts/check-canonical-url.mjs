#!/usr/bin/env node
/**
 * Canonical-URL / sitemap-parity guard.
 *
 * WHY THIS EXISTS (2026-11-10, Website Integrity Bot, Check #3/SEO)
 * This is a client-rendered SPA. The Vercel rewrite serves ONE static
 * index.html <head> for every non-asset path, and index.html carries a single
 * hardcoded <link rel="canonical" href="https://apex-financial.org">. So a
 * crawler fetching /apply, /vsl, /get-licensed, ... saw EVERY route declare the
 * HOMEPAGE as its canonical URL (verified live 2026-11-10 across 5 routes).
 * Meanwhile public/sitemap.xml lists 11 of those routes as indexable. The two
 * signals contradict, Google honors the canonical, and the whole recruiting
 * funnel deduped onto "/" — the landing pages that should rank were dropped
 * from the index.
 *
 * The fix is src/components/seo/RouteCanonical.tsx: an app-level component
 * mounted once inside <BrowserRouter> that rewrites <link rel="canonical"> to a
 * self-referencing URL on every route. Googlebot renders JS and honors the
 * rendered canonical. This guard stops that fix from silently rotting and stops
 * the sitemap from pointing at pages that do not exist.
 *
 * THREE RULES (all static, no build; prove both directions with --selftest):
 *
 *   A  index.html carries EXACTLY ONE <link rel="canonical">, and its host
 *      equals RouteCanonical's PROD_ORIGIN. Zero canonicals, two canonicals, or
 *      a host that disagrees with the runtime manager = fail. (Ties the static
 *      snapshot and the rendered DOM to one origin so a rename can't split them.)
 *
 *   B  RouteCanonical is mounted inside the router in App.tsx AND is
 *      non-degenerate: its source reads useLocation, sets rel="canonical", and
 *      builds the href from a hardcoded https PROD_ORIGIN literal — never from
 *      window.location.origin (a preview *.vercel.app render must not inject a
 *      preview-host canonical into the production index).
 *
 *   C  sitemap <-> route parity: every <loc> in sitemap.xml is on PROD_ORIGIN's
 *      host AND its path is a declared <Route path> in App.tsx. The SPA fallback
 *      returns HTTP 200 for any URL, so a bogus sitemap entry is a soft-404 that
 *      wastes crawl budget and reads as broken — invisible to a status-code
 *      probe, caught here.
 *
 * FAIL-LOUD: any operand file missing/unparseable, or an anchor (the canonical
 * tag, PROD_ORIGIN, the <Route> table, any <loc>) not found, exits non-zero. A
 * guard that cannot find its operand must never report green (the 465
 * fake-success rows).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const INDEX = join(ROOT, "index.html");
const APP = join(ROOT, "src/App.tsx");
const RC = join(ROOT, "src/components/seo/RouteCanonical.tsx");
const SITEMAP = join(ROOT, "public/sitemap.xml");

// ── pure extractors ─────────────────────────────────────────────────────────

/** All href values of <link rel="canonical"> tags (attr order agnostic). */
export function canonicalLinks(html) {
  const out = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/\brel\s*=\s*["']canonical["']/i.test(tag)) continue;
    const href = (tag.match(/\bhref\s*=\s*["']([^"']*)["']/i) || [])[1];
    out.push(href ?? null);
  }
  return out;
}

/** The PROD_ORIGIN string literal from RouteCanonical.tsx, or null. */
export function prodOrigin(rcSrc) {
  const m = rcSrc.match(/PROD_ORIGIN\s*=\s*["']([^"']+)["']/);
  return m ? m[1] : null;
}

/** <loc> inner text values from a sitemap. */
export function sitemapLocs(xml) {
  return (xml.match(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi) || []).map(
    (t) => t.replace(/<\/?loc>/gi, "").trim(),
  );
}

/** Set of declared <Route path="..."> literals from App.tsx. */
export function routePaths(appSrc) {
  const out = new Set();
  for (const m of appSrc.matchAll(/<Route\b[^>]*\bpath\s*=\s*["']([^"']*)["']/gi)) {
    out.add(m[1]);
  }
  return out;
}

function host(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

const noSlash = (p) => (p && p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);

// ── the audit (pure: strings in, failures out) ──────────────────────────────

export function audit({ indexHtml, appTsx, rcTsx, sitemapXml }) {
  const fail = [];

  // Scan CODE, not prose: a "must-not-contain" check (window.location.origin)
  // trips on its own explanatory comment otherwise — the footnote trap MP-277
  // recorded. stripComments blanks comments and preserves byte offsets, so the
  // indexOf()-based mount-position check below stays true.
  const appCode = stripComments(appTsx);
  const rcCode = stripComments(rcTsx);

  // Operand anchors — missing anchor is fail-loud, never green.
  const origin = prodOrigin(rcCode);
  if (!origin) {
    fail.push("RouteCanonical.tsx: PROD_ORIGIN string literal not found — cannot anchor the canonical host.");
    return fail; // everything downstream depends on it
  }
  const originHost = host(origin);
  if (!originHost) fail.push(`RouteCanonical.tsx: PROD_ORIGIN="${origin}" is not a valid URL.`);

  // ── Rule A: index.html canonical present, single, host matches origin ──
  const links = canonicalLinks(indexHtml);
  if (links.length === 0) {
    fail.push('index.html: no <link rel="canonical"> found — the runtime manager updates an existing tag, so one must ship statically.');
  } else if (links.length > 1) {
    fail.push(`index.html: ${links.length} <link rel="canonical"> tags — exactly one is allowed (duplicate canonicals are ignored by crawlers).`);
  } else {
    const h = host(links[0]);
    if (!h) fail.push(`index.html: canonical href="${links[0]}" is not a valid URL.`);
    else if (originHost && h !== originHost) {
      fail.push(`index.html canonical host "${h}" != RouteCanonical PROD_ORIGIN host "${originHost}" — static snapshot and rendered canonical would disagree. Rename both together.`);
    }
  }

  // ── Rule B: RouteCanonical mounted inside the router + non-degenerate ──
  if (!/import\s*\{[^}]*\bRouteCanonical\b[^}]*\}\s*from/.test(appCode)) {
    fail.push("App.tsx: RouteCanonical is not imported.");
  }
  const open = appCode.indexOf("<BrowserRouter");
  const close = appCode.indexOf("</BrowserRouter>");
  const mount = appCode.indexOf("<RouteCanonical");
  if (mount === -1) {
    fail.push("App.tsx: <RouteCanonical /> is not rendered.");
  } else if (open === -1 || close === -1) {
    fail.push("App.tsx: <BrowserRouter> open/close not found — cannot confirm the canonical manager is inside the router (useLocation throws outside it).");
  } else if (!(mount > open && mount < close)) {
    fail.push("App.tsx: <RouteCanonical /> is not inside <BrowserRouter> — useLocation() throws outside the router, so the canonical would never update.");
  }
  // non-degenerate source
  if (!/useLocation\b/.test(rcCode)) fail.push("RouteCanonical.tsx: does not read useLocation — it cannot be per-route.");
  if (!/rel["'\s,)]/.test(rcCode) || !/canonical/i.test(rcCode)) fail.push('RouteCanonical.tsx: does not set rel="canonical".');
  if (/window\.location\.origin/.test(rcCode)) {
    fail.push("RouteCanonical.tsx: builds the canonical from window.location.origin — a preview *.vercel.app render would inject a preview-host canonical into the production index. Use the fixed PROD_ORIGIN.");
  }

  // ── Rule C: sitemap <-> route parity ──
  const locs = sitemapLocs(sitemapXml);
  if (locs.length === 0) {
    fail.push("sitemap.xml: no <loc> entries found — cannot verify parity (empty or unparseable sitemap).");
  } else {
    const routes = routePaths(appCode);
    if (routes.size === 0) fail.push("App.tsx: no <Route path=...> declarations found — cannot verify sitemap parity.");
    const normRoutes = new Set([...routes].map(noSlash));
    for (const loc of locs) {
      const h = host(loc);
      if (originHost && h && h !== originHost) {
        fail.push(`sitemap.xml: <loc>${loc}</loc> host "${h}" != canonical host "${originHost}" — sitemap points off the canonical domain.`);
      }
      const p = noSlash(pathOf(loc));
      if (p == null) {
        fail.push(`sitemap.xml: <loc>${loc}</loc> is not a valid URL.`);
      } else if (routes.size > 0 && !normRoutes.has(p)) {
        fail.push(`sitemap.xml: <loc>${loc}</loc> path "${p}" is not a declared <Route> — the SPA fallback returns 200 for it, so a crawler indexes a soft-404.`);
      }
    }
  }

  return fail;
}

// ── selftest: prove the detector fires on each tampering ─────────────────────

function selftest() {
  const GOOD = {
    indexHtml: '<head><link rel="canonical" href="https://apex-financial.org" /></head>',
    appTsx:
      'import { RouteCanonical } from "@/components/seo/RouteCanonical";\n' +
      "<BrowserRouter>\n  <RouteCanonical />\n" +
      '  <Route path="/" />\n  <Route path="/apply" />\n  <Route path="/vsl" />\n' +
      "</BrowserRouter>",
    rcTsx:
      'export const PROD_ORIGIN = "https://apex-financial.org";\n' +
      'useLocation(); link.setAttribute("rel", "canonical");',
    sitemapXml: "<loc>https://apex-financial.org/</loc><loc>https://apex-financial.org/apply</loc>",
  };

  const cases = [
    ["GOOD passes", GOOD, 0],
    ["missing canonical tag", { ...GOOD, indexHtml: "<head></head>" }, 1],
    ["duplicate canonical tags", {
      ...GOOD,
      indexHtml: GOOD.indexHtml.replace("</head>", '<link rel="canonical" href="https://apex-financial.org/x" /></head>'),
    }, 1],
    ["canonical host != PROD_ORIGIN", {
      ...GOOD,
      indexHtml: '<link rel="canonical" href="https://preview.vercel.app" />',
    }, 1],
    ["RouteCanonical not mounted", { ...GOOD, appTsx: GOOD.appTsx.replace("<RouteCanonical />", "") }, 1],
    ["RouteCanonical outside router", {
      ...GOOD,
      appTsx: "<RouteCanonical />\n<BrowserRouter>\n<Route path=\"/\" />\n<Route path=\"/apply\" />\n<Route path=\"/vsl\" />\n</BrowserRouter>",
    }, 1],
    ["origin from window.location", {
      ...GOOD,
      rcTsx: GOOD.rcTsx + "\nconst o = window.location.origin;",
    }, 1],
    ["sitemap lists a non-route", {
      ...GOOD,
      sitemapXml: GOOD.sitemapXml + "<loc>https://apex-financial.org/ghost-page</loc>",
    }, 1],
    ["sitemap off-domain loc", {
      ...GOOD,
      sitemapXml: "<loc>https://evil.example.com/apply</loc>",
    }, 1],
  ];

  let ok = true;
  for (const [name, input, wantAtLeast] of cases) {
    const got = audit(input);
    const pass = wantAtLeast === 0 ? got.length === 0 : got.length >= wantAtLeast;
    if (!pass) {
      ok = false;
      console.error(`  ✗ selftest "${name}": expected ${wantAtLeast === 0 ? "no" : ">=1"} failures, got ${got.length}: ${JSON.stringify(got)}`);
    } else {
      console.log(`  ✓ selftest "${name}" (${got.length} failures)`);
    }
  }
  if (!ok) {
    console.error("❌ check:canonical-url --selftest FAILED");
    process.exit(1);
  }
  console.log("✅ check:canonical-url --selftest OK (detector fires in both directions)");
}

// ── main ─────────────────────────────────────────────────────────────────────

function read(path, label) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.error(`❌ check:canonical-url FAIL\n   cannot read ${label} (${path}). A guard that can't find its operand is not green.`);
    process.exit(1);
  }
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const failures = audit({
    indexHtml: read(INDEX, "index.html"),
    appTsx: read(APP, "src/App.tsx"),
    rcTsx: read(RC, "src/components/seo/RouteCanonical.tsx"),
    sitemapXml: read(SITEMAP, "public/sitemap.xml"),
  });
  if (failures.length) {
    console.error(`❌ check:canonical-url FAIL (${failures.length})`);
    for (const f of failures) console.error(`   • ${f}`);
    process.exit(1);
  }
  console.log("✅ check:canonical-url OK — index.html has one canonical on the prod origin; RouteCanonical is mounted inside the router and self-referencing; every sitemap <loc> is a real route on the canonical domain.");
}
