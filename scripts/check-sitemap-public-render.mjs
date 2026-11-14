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
// THE VERDICT IS low-false-positive and render-visible — facts that together mean
// "an anonymous crawler sees THIS public page, with real content, not a login wall,
// a blank shell, or the wrong index target":
//   A. the final pathname is the one we requested (no client redirect to /login
//      or a legacy LegacyWorkspaceRedirect that slipped into the sitemap)
//   B. the body is not the login wall rendered in place (the <Navigate> case is
//      caught by A; a render-in-place login is caught here)
//   C. <link rel=canonical> is this route's OWN prod URL (a page that canonicals
//      to /login or / is telling Google to drop it or merge it away — the dedup
//      leak RouteCanonical fixed, re-verified on each sitemap route's own path)
//   D. the page rendered real content, not a blank/errored/stubbed shell (content
//      floor, measured not guessed — see MIN_CONTENT_CHARS). A/B/C can all pass on
//      an empty render; this is the net under them.
//   E. no placeholder copy (coming-soon/lorem/TBD) reached a public, indexable URL.
//   F. /data-deletion (+ /delete-my-data alias) still carries its two Meta-required
//      signals — deletion instructions + a contact method. A stub there passes A-C
//      and silently fails FB/IG app review, killing the IG/FB lead channel.
// It still does NOT grade title/meta/brand/marketing copy — those are owned by
// forbidden-language, landing-marketing-claims, brand-* and (for /careers)
// careers-jobposting-render. This probe owns "does a logged-out crawler get the
// real public page?" — now including "is there real content on it?". That split is
// intentional, not a silent cap.
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

// A page can pass A/B/C (own path, no login wall, self-canonical) and still serve
// Google a BLANK or errored shell — a lazy import that 404s into a tiny error
// boundary, a component that returns null when its data fetch fails, a page stubbed
// down to nothing in a refactor. The URL and canonical survive; the content does
// not, and Google indexes thin/empty content at a funnel or compliance URL.
// CONTENT FLOOR, measured not guessed: the thinnest real non-/careers sitemap page
// is /vsl at 230 chars of rendered innerText (video-heavy, minimal copy), then
// /schedule-call 548, /contact 666, /data-deletion 673; everything else is >2000.
// A blank render is ~0, an error-boundary stub ~30-60, a "coming soon" tile ~15-40.
// 120 sits 1.9x under /vsl and well above every realistic empty-render — catches
// the blank class with zero false positive on the thinnest legitimate page. The
// guard's own SETTLE_MS (1600ms) is longer than the probe these numbers came from
// (1200ms), so the live-measured length is a lower bound — more margin, not less.
const MIN_CONTENT_CHARS = 120;

// Placeholder copy that must never ship to a public, indexable page (Check #5,
// real-data). Length-independent, so it catches a short "Coming soon" tile the
// content floor would pass. Deliberately phrase-anchored (no bare "placeholder")
// so real legal/marketing prose can never trip it; innerText excludes input
// placeholder="" attrs, so form fields are not a false-positive source.
const PLACEHOLDER_RE = /coming soon|lorem ipsum|\blipsum\b|under construction|\bTBD\b|sample text/i;

// /data-deletion (and its /delete-my-data alias) is the Meta app-review anchor:
// any app using Facebook Login or the Instagram Graph API — the ManyChat IG DM
// lead channel — must expose a public URL that (1) explains how to request data
// deletion and (2) gives a contact method to do it. If this page silently
// regresses to a stub, Meta can reject/disable the app and the IG/FB lead channel
// dies — and every other gate here (not a login wall, right canonical) still
// passes. These two signals are the page's entire reason to exist, so requiring
// them is low-false-positive; the content floor above is the second net.
const DELETION_INSTR_RE = /data deletion|delete (my|your) data|right to request deletion|request .{0,40}(deletion|removal)|delet(e|ion) of .{0,40}(data|personal|information)/i;
const CONTACT_RE = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|mailto:|contact (us|form|our team|the team)|\/contact/i;
function isDeletionPath(path) {
  return path === "/data-deletion" || path === "/delete-my-data";
}

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
function gradeRoute(path, { finalPath, loginWall, canonical, textLen, hasPlaceholder, hasDeletionInstr, hasContact }) {
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

  // D. the page rendered real content, not a blank/errored shell. A number below
  //    the floor means a lazy import 404'd, a data fetch failed into an empty
  //    render, or the page was stubbed — Google indexes thin/empty content here.
  //    Skipped when the login wall already explains the thinness (B owns that).
  if (!loginWall && typeof textLen === "number" && textLen < MIN_CONTENT_CHARS) {
    fails.push(`rendered only ${textLen} chars of text (floor ${MIN_CONTENT_CHARS}) — a blank/errored/stubbed page Google would index as thin content at a public URL`);
  }

  // E. no placeholder copy on a live, indexable page (real-data check).
  if (hasPlaceholder) {
    fails.push(`placeholder copy rendered to an anonymous crawler (coming-soon/lorem/TBD) — Google would index unfinished content at this URL`);
  }

  // F. the Meta data-deletion URL still carries its two load-bearing signals.
  if (isDeletionPath(path)) {
    if (!hasDeletionInstr) {
      fails.push(`data-deletion page is missing deletion instructions — Meta requires a public URL explaining how to request data deletion; a stub here fails FB/IG app review and silently breaks the IG/FB lead channel`);
    }
    if (!hasContact) {
      fails.push(`data-deletion page is missing a contact method (email / contact link) — Meta requires a way to actually request deletion; without it FB/IG app review fails`);
    }
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
  // One in-page pass: all text-derived signals share the same innerText the
  // login-wall check reads, so the verdict is computed over exactly what a
  // crawler sees after the JS runs.
  const signals = await page
    .evaluate(
      (res) => {
        const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const re = (r) => new RegExp(r.source, r.flags).test(text);
        return {
          textLen: text.length,
          loginWall: re(res.login),
          hasPlaceholder: re(res.placeholder),
          hasDeletionInstr: re(res.deletion),
          hasContact: re(res.contact),
        };
      },
      {
        login: { source: LOGIN_WALL_RE.source, flags: LOGIN_WALL_RE.flags },
        placeholder: { source: PLACEHOLDER_RE.source, flags: PLACEHOLDER_RE.flags },
        deletion: { source: DELETION_INSTR_RE.source, flags: DELETION_INSTR_RE.flags },
        contact: { source: CONTACT_RE.source, flags: CONTACT_RE.flags },
      }
    )
    .catch(() => ({ textLen: null, loginWall: false, hasPlaceholder: false, hasDeletionInstr: false, hasContact: false }));
  return { finalPath, canonical, ...signals };
}

// ---- selftest: exercise gradeRoute both directions with zero network ----
async function selftest() {
  const path = "/apply";
  // Real prod shape: /apply renders 1134 chars, no placeholder, not a deletion page.
  const good = { finalPath: "/apply", loginWall: false, canonical: `${PROD_ORIGIN}/apply`, textLen: 1134, hasPlaceholder: false, hasDeletionInstr: false, hasContact: false };
  // Real prod shape of the Meta data-deletion URL: 673 chars, both signals present.
  const delGood = { finalPath: "/data-deletion", loginWall: false, canonical: `${PROD_ORIGIN}/data-deletion`, textLen: 673, hasPlaceholder: false, hasDeletionInstr: true, hasContact: true };
  const homeGood = { finalPath: "/", loginWall: false, canonical: `${PROD_ORIGIN}/`, textLen: 13511, hasPlaceholder: false, hasDeletionInstr: false, hasContact: false };

  const cases = [
    ["public page passes", path, good, true],
    ["redirect to /login fails", path, { ...good, finalPath: "/login" }, false],
    ["login wall rendered in place fails", path, { ...good, loginWall: true }, false],
    ["canonical to /login fails", path, { ...good, canonical: `${PROD_ORIGIN}/login` }, false],
    ["canonical to homepage fails", path, { ...good, canonical: `${PROD_ORIGIN}/` }, false],
    ["missing canonical fails", path, { ...good, canonical: null }, false],
    ["homepage self-canonical passes", "/", homeGood, true],
    // Prod reality: RouteCanonical emits the BARE origin for "/", the sitemap lists
    // it with a trailing slash — equivalent, must pass (this was a day-one false
    // positive before trailing-slash normalization; lock it so it can't come back).
    ["homepage bare-origin canonical passes", "/", { ...homeGood, canonical: PROD_ORIGIN }, true],
    // A sub-path canonical with a trailing slash is still the same page — must pass.
    ["sub-path trailing-slash canonical passes", path, { ...good, canonical: `${PROD_ORIGIN}/apply/` }, true],
    // D — content floor (measured thinnest real page /vsl=230; floor 120).
    ["blank/errored shell below content floor fails", path, { ...good, textLen: 40 }, false],
    ["content exactly at the floor passes", path, { ...good, textLen: MIN_CONTENT_CHARS }, true],
    ["/vsl at its real 230 chars passes the floor", "/vsl", { ...good, finalPath: "/vsl", canonical: `${PROD_ORIGIN}/vsl`, textLen: 230 }, true],
    // E — placeholder scrub.
    ["placeholder copy on a public page fails", path, { ...good, hasPlaceholder: true }, false],
    // F — Meta data-deletion compliance.
    ["data-deletion with both signals passes", "/data-deletion", delGood, true],
    ["data-deletion missing instructions fails", "/data-deletion", { ...delGood, hasDeletionInstr: false }, false],
    ["data-deletion missing contact fails", "/data-deletion", { ...delGood, hasContact: false }, false],
    ["/delete-my-data alias enforced too", "/delete-my-data", { ...delGood, finalPath: "/delete-my-data", canonical: `${PROD_ORIGIN}/delete-my-data`, hasContact: false }, false],
    ["non-deletion path ignores the deletion signals", path, { ...good, hasDeletionInstr: false, hasContact: false }, true],
  ];

  let ok = 0;
  for (const [label, p, rendered, shouldPass] of cases) {
    const fails = gradeRoute(p, rendered);
    const passed = fails.length === 0;
    const correct = passed === shouldPass;
    console.log(`  ${correct ? "✓" : "✗"} ${label} — ${passed ? "PASS" : "FAIL(" + fails.length + ")"}${correct ? "" : "  <<< SELFTEST WRONG"}`);
    if (correct) ok++;
  }

  // Reason-level assertions: prove the RIGHT check fired (or did not), not just the
  // pass/fail boolean — a vacuous selftest passes every case for the wrong reason.
  const reasonCases = [
    // The content-floor message names the measured length.
    ["content-floor message fires on a blank render", gradeRoute(path, { ...good, textLen: 10 }), /only 10 chars/, true],
    // Under a login wall, B owns the thinness — D must NOT also fire (no double report).
    ["content floor is skipped when the login wall explains the thinness", gradeRoute(path, { ...good, loginWall: true, textLen: 10 }), /chars of text/, false],
    ["placeholder message fires", gradeRoute(path, { ...good, hasPlaceholder: true }), /placeholder copy/, true],
    ["deletion-instructions message fires on the deletion path", gradeRoute("/data-deletion", { ...delGood, hasDeletionInstr: false }), /missing deletion instructions/, true],
    ["contact message fires on the deletion path", gradeRoute("/data-deletion", { ...delGood, hasContact: false }), /missing a contact method/, true],
    // A non-deletion page with both flags false must emit NO deletion/contact failure.
    ["non-deletion path emits no deletion/contact failure", gradeRoute(path, { ...good, hasDeletionInstr: false, hasContact: false }), /deletion instructions|contact method/, false],
  ];
  let rok = 0;
  for (const [label, fails, re, shouldContain] of reasonCases) {
    const hit = fails.some((f) => re.test(f));
    const correct = hit === shouldContain;
    console.log(`  ${correct ? "✓" : "✗"} ${label} — ${hit ? "matched" : "absent"}${correct ? "" : "  <<< SELFTEST WRONG"}`);
    if (correct) rok++;
  }

  const total = cases.length + reasonCases.length;
  const okAll = ok + rok;
  const allOk = okAll === total;
  console.log(`selftest: ${okAll}/${total} ${allOk ? "OK" : "BROKEN"}`);
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
