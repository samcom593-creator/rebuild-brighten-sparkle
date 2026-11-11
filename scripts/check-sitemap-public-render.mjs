#!/usr/bin/env node
// check-sitemap-public-render.mjs — proves every URL in the sitemap still renders
// PUBLIC content to an anonymous crawler, AFTER the browser runs the JS.
//
// THE BLIND SPOT THIS CLOSES. The sitemap tells Google exactly which pages to
// crawl and index — the public recruiting funnel (/apply, /vsl, /get-licensed,
// /schedule-call, /leads, /contact) plus the legal pages. Google's crawler is an
// ANONYMOUS visitor. A route can return HTTP 200 for the SPA shell and then, once
// the JS runs, client-side redirect an anonymous visitor to /login or render the
// login wall in place — exactly how /hall-of-fame behaves today (200 at the
// shell, then "Sign in · Galaxy Financial" with canonical → /login). If /apply or
// /vsl ever picks up an auth wrapper or a runtime auth redirect, Google would
// start indexing a LOGIN PAGE at the recruiting funnel's URLs and the funnel would
// silently deindex — the single highest-$ SEO failure on this site, and nothing
// in CI would go red. Every other gate is blind to it:
//   - route-smoke.mjs         — pure fetch of raw HTML, never runs the JS, so the
//                               shell 200 reads as "healthy" while JS login-walls
//   - check-canonical-url.mjs — static analysis of index.html + sitemap<->route
//                               parity, not a live anonymous render
//   - careers-jobposting-render.mjs — owns /careers/* only (JobPosting payload)
//   - mobile-overflow.mjs / lighthouse — layout width / perf score, not publicness
//
// THE VERDICT IS DELIBERATELY NARROW — three render-visible, low-false-positive
// facts that together mean "an anonymous crawler sees THIS public page, not a
// login wall or the wrong index target":
//   A. the final pathname is the one we requested (no client redirect to /login
//      or a legacy LegacyWorkspaceRedirect that slipped into the sitemap)
//   B. the body is not the login wall rendered in place (the <Navigate> case is
//      caught by A; a render-in-place login is caught here)
//   C. <link rel=canonical> is this route's OWN prod URL (a page that canonicals
//      to /login or / is telling Google to drop it or merge it away — the dedup
//      leak RouteCanonical fixed, re-verified on each sitemap route's own path)
// It does NOT grade title/meta/copy — those are owned by forbidden-language,
// landing-marketing-claims, and (for /careers) careers-jobposting-render. This
// probe owns exactly one question: "does a logged-out crawler get the public
// page?" That split is intentional, not a silent cap.
//
// ROUTES ARE READ FROM public/sitemap.xml, not hardcoded — so when a new <loc> is
// added, it is automatically render-verified public on the next deploy, and an
// orphaned/login-walled addition turns CI red by itself. /careers/* is excluded
// here because careers-jobposting-render.mjs already renders it with a stricter
// (JobPosting) contract; grading it twice would double the render cost for no
// added coverage.
//
// Post-deploy, against the live promoted commit, mirroring careers-jobposting-
// render.mjs / mobile-overflow.mjs / route-smoke.mjs. Alerts on the GitHub run;
// NOT a timer-fired paging daemon (that class has a long false-page history in
// this system — a deterministic render asserted on the exact shipped commit is
// the right tool).
//
// Usage:
//   BASE=https://apex-financial.org node scripts/check-sitemap-public-render.mjs
//   node scripts/check-sitemap-public-render.mjs --selftest   # prove the checks both ways, no network
//   PW_CHANNEL=chrome node scripts/check-sitemap-public-render.mjs   # system Chrome (CI, no download)

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const BASE = (process.env.BASE || "https://apex-financial.org").replace(/\/$/, "");
const PROD_ORIGIN = "https://apex-financial.org"; // canonical is a FIXED prod origin, never window.location (no preview leak)
const SETTLE_MS = 1600; // let hydration + any auth redirect + RouteCanonical mount land
const NAV_TIMEOUT = 40000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITEMAP_PATH = resolve(__dirname, "../public/sitemap.xml");

// Distinctive copy from Login.tsx — present only when the login wall renders in
// place (the <Navigate to="/login"> case is already caught by the final-path
// check, this catches a render-in-place auth gate that keeps the URL).
const LOGIN_WALL_RE = /sign in to access|contact your admin for account access|email me a sign-in link/i;

// Read the sitemap and return the concrete, same-origin paths to render — minus
// /careers/* (owned by careers-jobposting-render.mjs). Dynamic by design: a new
// <loc> is auto-covered next deploy.
function sitemapRoutes() {
  const xml = readFileSync(SITEMAP_PATH, "utf8");
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const paths = [];
  for (const loc of locs) {
    let u;
    try {
      u = new URL(loc);
    } catch {
      continue;
    }
    if (u.origin !== PROD_ORIGIN) continue; // only grade our own origin
    const path = u.pathname;
    if (path.startsWith("/careers/")) continue; // owned by careers-jobposting-render.mjs
    paths.push(path);
  }
  return [...new Set(paths)];
}

// Pure, no-browser verdict over one route's rendered reality. Returns a list of
// failure strings (empty = pass). Shared by the live probe and the selftest so
// the selftest exercises the REAL predicate, not a copy of it.
function gradeRoute(path, { finalPath, loginWall, canonical }) {
  const fails = [];
  const selfUrl = `${PROD_ORIGIN}${path}`;

  // A. no client redirect away from the requested path (login redirect / stale
  //    LegacyWorkspaceRedirect that leaked into the sitemap)
  if (finalPath !== path) {
    fails.push(`anonymous visitor was redirected ${path} -> ${finalPath} (a logged-out crawler does not reach this page; Google would index the destination, not this URL)`);
  }

  // B. the login wall did not render in place
  if (loginWall) {
    fails.push(`login wall rendered to an anonymous visitor (Google would index a sign-in page at ${path} — the funnel URL would deindex)`);
  }

  // C. self-referencing canonical on the fixed prod origin. Trailing slashes are
  //    normalized on BOTH sides: Google treats the root canonical bare-origin
  //    "https://apex-financial.org" (what RouteCanonical emits for "/") and the
  //    sitemap's "https://apex-financial.org/" as the SAME URL, and sub-paths emit
  //    no trailing slash. This is a canonical-URL equivalence fact, not a leniency
  //    hole — a canonical pointing at a DIFFERENT path (/login, another page, or
  //    null) still fails, proven by the selftest.
  if (canonicalKey(canonical) !== canonicalKey(selfUrl)) {
    fails.push(`canonical is ${JSON.stringify(canonical)}, expected ${selfUrl} (this page points Google at a different URL — dedup/deindex leak)`);
  }

  return fails;
}

// Collapse a run of trailing slashes so origin and origin+"/" (the root) and /x
// and /x/ compare equal; null/"" stay distinct from any real URL.
function canonicalKey(u) {
  if (!u) return null;
  return u.replace(/\/+$/, "");
}

async function readRouteFromPage(page) {
  const finalPath = new URL(page.url()).pathname;
  const canonical = await page.getAttribute('link[rel="canonical"]', "href").catch(() => null);
  const loginWall = await page
    .evaluate((reSrc) => new RegExp(reSrc.source, reSrc.flags).test(document.body?.innerText || ""), {
      source: LOGIN_WALL_RE.source,
      flags: LOGIN_WALL_RE.flags,
    })
    .catch(() => false);
  return { finalPath, loginWall, canonical };
}

// ---- selftest: exercise gradeRoute both directions with zero network ----
async function selftest() {
  const path = "/apply";
  const good = { finalPath: "/apply", loginWall: false, canonical: `${PROD_ORIGIN}/apply` };

  const cases = [
    ["public page passes", path, good, true],
    ["redirect to /login fails", path, { ...good, finalPath: "/login" }, false],
    ["login wall rendered in place fails", path, { ...good, loginWall: true }, false],
    ["canonical to /login fails", path, { ...good, canonical: `${PROD_ORIGIN}/login` }, false],
    ["canonical to homepage fails", path, { ...good, canonical: `${PROD_ORIGIN}/` }, false],
    ["missing canonical fails", path, { ...good, canonical: null }, false],
    ["homepage self-canonical passes", "/", { finalPath: "/", loginWall: false, canonical: `${PROD_ORIGIN}/` }, true],
    // Prod reality: RouteCanonical emits the BARE origin for "/", the sitemap lists
    // it with a trailing slash — equivalent, must pass (this was a day-one false
    // positive before trailing-slash normalization; lock it so it can't come back).
    ["homepage bare-origin canonical passes", "/", { finalPath: "/", loginWall: false, canonical: PROD_ORIGIN }, true],
    // A sub-path canonical with a trailing slash is still the same page — must pass.
    ["sub-path trailing-slash canonical passes", path, { ...good, canonical: `${PROD_ORIGIN}/apply/` }, true],
  ];

  let ok = 0;
  for (const [label, p, rendered, shouldPass] of cases) {
    const fails = gradeRoute(p, rendered);
    const passed = fails.length === 0;
    const correct = passed === shouldPass;
    console.log(`  ${correct ? "✓" : "✗"} ${label} — ${passed ? "PASS" : "FAIL(" + fails.length + ")"}${correct ? "" : "  <<< SELFTEST WRONG"}`);
    if (correct) ok++;
  }
  const allOk = ok === cases.length;
  console.log(`selftest: ${ok}/${cases.length} ${allOk ? "OK" : "BROKEN"}`);
  process.exit(allOk ? 0 : 1);
}

async function main() {
  if (process.argv.includes("--selftest")) {
    await selftest();
    return;
  }

  const routes = sitemapRoutes();
  if (routes.length === 0) {
    console.error("FAIL: no gradeable routes parsed from public/sitemap.xml — the sitemap is empty, malformed, or all /careers/*. Not a pass.");
    process.exit(1);
  }

  const launchOpts = process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {};
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext(); // anonymous: no storage state, no cookies
  let anyFail = false;

  try {
    for (const path of routes) {
      const url = `${BASE}${path}`;
      const page = await ctx.newPage();
      let rendered;
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        rendered = await readRouteFromPage(page);
      } catch (e) {
        console.log(`✗ ${path} — navigation/read error: ${e.message}`);
        anyFail = true;
        await page.close();
        continue;
      }
      await page.close();

      // The live probe maps BASE back to PROD_ORIGIN for the canonical compare so
      // a preview BASE still grades the canonical against the fixed prod origin.
      const graded = {
        ...rendered,
        canonical: rendered.canonical ? rendered.canonical.replace(BASE, PROD_ORIGIN) : rendered.canonical,
      };
      const fails = gradeRoute(path, graded);
      if (fails.length === 0) {
        console.log(`✓ ${path} — public to an anonymous visitor (no redirect, no login wall, self-canonical)`);
      } else {
        anyFail = true;
        console.log(`✗ ${path} — ${fails.length} failure(s):`);
        for (const f of fails) console.log(`    - ${f}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(
    anyFail
      ? `\nFAIL: a sitemap URL does not render public to an anonymous crawler on ${BASE}. Google would index a login page / wrong URL at a funnel path.`
      : `\nOK: all ${routes.length} non-/careers sitemap URLs render public to an anonymous crawler on ${BASE} (/careers/* owned by careers-jobposting-render.mjs).`
  );
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error("check-sitemap-public-render crashed:", e);
  process.exit(1);
});
