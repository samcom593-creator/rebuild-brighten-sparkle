#!/usr/bin/env node
// live-render-integrity.mjs — render the LIVE public site and prove the
// numbers on it are real. Owned by the Website Integrity Bot.
//
// Why this exists, and why it is NOT a CI gate:
//   The ~40 checks in verify:core read SOURCE or query the DATABASE. None of
//   them render the page. So a landing RPC that returns null, an undefined
//   producer, or a $0/NaN ALP renders a broken number to the public while
//   every source/data guard stays green — the exact blind spot the deal-
//   ingestion churn (MP-424/425) rides on, since those numbers are computed
//   client-side from live RPCs.
//
//   route-smoke.mjs (post-deploy) is pure fetch and CANNOT see rendered
//   tokens. lighthouse-prod.mjs measures speed, not correctness. This one
//   opens a real browser, renders desktop + mobile, and asserts the visible
//   text carries no broken token and mobile does not scroll sideways.
//
//   This header's wiring claim was fiction twice over. It first said "run by
//   the BOT each fire" (run by nothing). On 2026-10-06 it was rewritten to
//   claim launchd com.samjames.apex.live-render + apex-doctor "Check #92" —
//   but that launchd job had no plist, business-ops/scripts/apex-live-render-cron.sh
//   did not exist, and the doctor's highest check is #50, so #92 never existed.
//   Still run by nothing, graded by nothing: the ONE guard that catches a
//   broken number rendering to the public funnel. MP-WIB-LIVE-RENDER-RUN
//   (2026-11-11) made it REAL and PROVEN: it now runs every 6h on Sam's Mac
//   via launchd com.samjames.apex.live-render -> business-ops/scripts/apex-live-render-cron.sh,
//   which points RESULT_FILE at business-ops/session-state/site-health/live-render-latest.json
//   and pages ntfy (transition-de-stormed) only on a genuine DEFECT/SITE_DOWN.
//   The job's LIVENESS is graded by apex-doctor Check #5 (EXPECTED_LABELS): if
//   the plist is present+enabled but the job is unloaded it goes CRITICAL; a
//   deliberate retirement (remove/disable the plist) is a NOTE, never a
//   permanent red. One-time setup the runner assumes: `node_modules/.bin/playwright
//   install webkit` so the mobile-webkit leg runs on the real Apple engine (it
//   was never installed, so that leg had silently never run -> CLEAN_PARTIAL).
//   It is deliberately NOT wired as a blocking CI gate: a browser render in CI is
//   flaky, and a flaky gate that blocks the deploy is worse than the bug it
//   guards (the lesson from every "permanently-red guard" wave). So this
//   fails LOUD locally and NEVER blocks a push.
//
// Anti-flake contract:
//   - waitUntil:'load' + a fixed settle wait. networkidle is unreliable here
//     because the landing holds a Supabase realtime websocket open, so the
//     network never idles (proven: desktop timed out on networkidle while
//     mobile did not, same site, same minute).
//   - 2 attempts per viewport.
//   - A control probe (204 endpoint). If the site AND the control both fail,
//     the verdict is UNKNOWN (laptop offline / network down) and exit is 0 —
//     an outage of Sam's wifi must never read as a broken site.
//   - Exit non-zero ONLY on a genuine rendered defect (broken token, 404
//     white-screen, mobile horizontal overflow, or a hard page error).
//
// Usage:
//   node scripts/live-render-integrity.mjs
//   BASE=https://apex-financial.org node scripts/live-render-integrity.mjs

import { chromium, webkit, devices } from "playwright";
import { FORBIDDEN, RENDER_SAFE_TERMS } from "./check-forbidden-language.mjs";

const BASE = (process.env.BASE || "https://apex-financial.org").replace(/\/$/, "");
const CONTROL = "https://www.google.com/generate_204";
const SETTLE_MS = 3500;
const OVERFLOW_TOLERANCE_PX = 2; // sub-pixel rounding is not a defect

// MP-WIB-LIVE-RENDER-FUNNEL (2026-11-11): this probe rendered ONLY "/" for its
// whole life, yet its own header warns about "a landing RPC that returns null,
// an undefined producer, or a $0/NaN ALP" — and the page MOST likely to render
// such a token is /apply (the application form reads the applicant's licensing
// path + status from live RPCs), not the homepage. /apply and /vsl got
// overflow-only coverage from mobile-overflow.mjs and fetch-only coverage from
// route-smoke.mjs (which sees the SPA shell 200, blind to rendered tokens), so
// the broken-token / hard-page-error / 404-white-screen assertions were applied
// to the homepage ALONE. Now every (leg, route) pair is measured. Kept tight to
// the public funnel money pages a recruit/lead actually walks — the ones
// where a broken number or a React crash directly costs a conversion — so the
// render stays fast and non-flaky. Override with ROUTES="/,/apply,/vsl,...".
//
// MP-WIB-LIVE-RENDER-CTA (2026-11-13): widened to the two HOMEPAGE-PRIMARY
// conversion CTAs that were still render-blind. The homepage serves "Schedule a
// Call" -> /schedule-call (a client-rendered license-status gate that routes to
// booking) and "Licensed?/Not licensed yet" -> /get-licensed (the first step for
// the LARGER unlicensed-recruit population). Both had only route-smoke's fetch-200
// (SPA shell, blind to a client-render white-screen) + sitemap/external-CTA
// coverage — the exact blind spot this probe exists to close, and the one /careers
// proved real the same day (a homepage-reachable conversion surface can silently
// collapse to the shell while every fetch/source guard stays green). Proven CLEAN
// on live prod across all 3 legs (desktop-blink + mobile-blink + real Apple WebKit:
// 200 / 0 overflow / 0 broken tokens / no soft-404) BEFORE widening, so the guard
// is not born red; /get-licensed's benign video-embed console noise is recorded,
// not graded (ok stays true), so adding it does not make the probe flaky-red.
//
// MP-WIB-STOREFRONT-RENDER (2026-11-13): widened to /storefront, the ONE
// recurring-revenue money page ($250/wk Gold Leads + $500/wk Platinum Vet Leads,
// each a live Stripe subscribe). 3460973f gave its buy LINKS a liveness watchdog
// the same day, but the PAGE itself was render-blind: the package names and the
// weekly prices are the copy a lead reads before subscribing, and a null/NaN
// price or a client-render white-screen there kills a $250–500/wk conversion
// while route-smoke's fetch-200 (SPA shell) and every source/data guard stay
// green — the identical blind spot /careers proved real and the CTA widening
// closed hours earlier. Proven CLEAN on live prod across all 3 legs (desktop-blink
// + mobile-blink + real Apple WebKit: 200 / 0 overflow / 0 broken tokens / 0
// console errors / no soft-404) BEFORE widening, so the guard is not born red.
//
// MP-WIB-LINKS-RENDER (2026-11-16): widened to /links, the link-in-bio page
// where 100% of Sam's social-bio traffic converges — IG @sell4daddy, TikTok
// @sellfordaddy (~84K), YouTube @sell4daddy, Snap samueljameshq all point here,
// and it fans out to the three money paths (/apply, Elite Circle waitlist,
// /schedule-call). It is a lazy-loaded SPA route, so a bad route-config change
// or a broken import white-screens it while route-smoke's fetch-200 (SPA shell)
// and every source/data guard stay green — the exact client-render-collapse
// class /careers and /storefront proved real. Its mobile WIDTH was guarded by
// mobile-overflow.mjs hours earlier (commit 14b767c3), but rendered CORRECTNESS
// (white-screen / broken token / soft-404) on the single highest-traffic public
// conversion surface Sam owns was covered by NOTHING. The copy is static (no RPC
// prices), so the live risk is a crash/white-screen, not a NaN. Proven CLEAN on
// live prod across all 3 legs (desktop-blink + mobile-blink + real Apple WebKit:
// 200 / 0 overflow / 0 broken tokens / 0 console errors / no soft-404) BEFORE
// widening, so the guard is not born red.
//
// MP-WIB-FUNNEL-DELTA-RENDER (2026-11-16): reconciled this probe's route set
// against the mobile-overflow WIDTH guard (18 routes) and widened to the public,
// un-gated conversion surfaces that had width coverage but ZERO rendered-
// correctness coverage. Added: /unlicensed-overview (the larger unlicensed-
// recruit population's overview page), /leads + /get-leads (the lead-BUY money
// pages, both <LeadsLanding/> — kept as two entries because a route-config edit
// can white-screen one URL's mount while the other renders, the exact client-
// render-collapse class this probe exists to catch), and /contact. All four are
// static copy (0 RPC/data deps) so the live risk is a crash/white-screen, not a
// NaN. Proven CLEAN on live prod across all 3 legs (desktop-blink + mobile-blink
// + real Apple WebKit: 200 / 0 overflow / 0 broken tokens / 0 console errors /
// no soft-404) BEFORE widening, so the guard is not born red. DELIBERATELY
// EXCLUDED: /start-contracting (LegacyWorkspaceRedirect -> /dashboard/
// contracting-profile, a ProtectedRoute; a logged-out probe renders the login
// shell = false coverage, the /purchase-leads pattern) and /seminar
// (LegacyWorkspaceRedirect -> /apply, already guarded, covered transitively).
//
// MP-WIB-CAREERS-RENDER (2026-11-16): closed the final public-route delta between
// this render probe and the mobile-overflow WIDTH guard — the Google-for-Jobs
// recruiting SEO cluster. Added /careers (the CareersIndex HUB) + /careers/florida
// + /careers/texas (the StateCareerLanding component — a DIFFERENT component from
// the hub, so a route-config or import break can white-screen one while the other
// renders; both the hub and at least one state page must be covered). These pages
// client-INJECT their JobPosting/ItemList JSON-LD + canonical, so route-smoke's
// fetch-200 (SPA shell) stays green through a mount crash — the exact client-
// render-collapse class /careers itself proved real when it was a soft-404. They
// have check-careers-hub (soft-404) + careers-jobposting-render (JSON-LD payload)
// guards, but NO general white-screen / broken-token render guard until now. Proven
// CLEAN on live prod across all 3 legs (desktop-blink + mobile-blink + real Apple
// WebKit: 200 / 0 overflow / 0 broken tokens / 0 console errors / no soft-404, real
// content textLen ~1300+ not a login/404 shell) BEFORE widening, so the guard is
// not born red. After this, the two funnel guards' public-route coverage is fully
// reconciled (mobile-overflow WIDTH set is a superset only by the /schedule-call
// redirect asymmetry, which is intentional).
const ROUTES = (process.env.ROUTES || "/,/apply,/vsl,/schedule-call,/get-licensed,/storefront,/links,/unlicensed-overview,/leads,/get-leads,/contact,/careers,/careers/florida,/careers/texas")
  .split(",").map((r) => r.trim()).filter(Boolean)
  .map((r) => (r === "/" ? "/" : "/" + r.replace(/^\/+|\/+$/g, "")));

// Broken-token patterns that must never appear in RENDERED public text.
// Word-boundaried and specific to avoid matching legitimate copy.
const BAD_TOKENS = [
  [/\bNaN\b/, "NaN — a number computed from a null/undefined RPC field"],
  [/\$\s*NaN/, "$NaN — a money value failed to compute"],
  [/\bundefined\b/, "undefined — a value leaked to the DOM"],
  [/\[object Object\]/, "[object Object] — an object stringified into copy"],
  [/\bInfinity\b/, "Infinity — a divide-by-zero leaked to the DOM"],
  [/\$NaN|\$undefined/, "broken money token"],
];

// MP-WIB-LIVE-RENDER-PLACEHOLDER (2026-11-11): Check #5 (real-data / no
// placeholder) had TWO guards and a hole between them. check:forbidden-language
// scans SOURCE (src/ + edge fns) and is structurally blind to anything that
// renders from the DATABASE — a testimonial seeded with lorem text, a roster
// row named "John Doe", a stat card whose DB column still reads "coming soon".
// This render probe was the only thing that sees the DB-driven DOM, but its
// BAD_TOKENS list caught only NUMERIC brokenness (NaN/undefined), never textual
// placeholder. So DB-sourced placeholder copy on the public recruiting funnel
// (the money path: /, /apply, /vsl) was caught by NOTHING. These patterns close
// that. They are word-boundaried / case-scoped so they cannot trip legitimate
// English copy, and — critically — they only ever run against the 3 PUBLIC
// FUNNEL routes, where "coming soon" is vaporware and "TBD" is an unfilled
// field, never a legitimate per-module recording-in-progress fallback (that
// lives on academy/admin surfaces this probe does not touch). Proven clean on
// live prod the moment this shipped (so the guard is not born red), and proven
// to catch each class via --selftest (both directions, incl. anti-false-
// positive cases for 'outbid' and 'replacement').
const PLACEHOLDER_TOKENS = [
  [/lorem ipsum|\blorem\b|\bipsum\b/i, "lorem/ipsum — placeholder filler text rendered from a DB field or seed"],
  [/\bcoming soon\b/i, "'coming soon' — vaporware placeholder on a conversion route; the funnel must not promise unshipped sections"],
  [/\bTBD\b/, "TBD — an unfilled 'to be determined' placeholder reached public copy"],
  [/\b(?:john|jane) doe\b/i, "John/Jane Doe — a fake-name placeholder rendered from a DB row"],
  [/\bexample\.com\b/i, "example.com — a placeholder domain in VISIBLE copy (input-attribute hints never appear in innerText, so this is real body text)"],
  [/\[placeholder\]/i, "[placeholder] — a literal bracketed placeholder annotation"],
  [/\bREPLACE_ME\b/, "REPLACE_ME — a developer placeholder marker reached production"],
];

// MP-WIB-RENDER-AITELL (2026-11-14): the AI-tell / fake-success-stat ban-list
// was applied to SOURCE ONLY (check:forbidden-language scans src/ + edge fns).
// Nothing ever scanned the RENDERED public pages for it, so a banned term that
// reaches the DOM from a DATABASE field — a testimonial seeded with "delve
// into", a stat card whose copy reads "thousands of agents" or "50+ carriers"
// (the real count is 22) — shipped to a recruit and was caught by NOTHING. This
// is the EXACT hole MP-WIB-LIVE-RENDER-PLACEHOLDER closed for placeholder text,
// left open for AI-tells + inflated stats — the fake-success-number class the
// whole charter is built around (the 465 InsuraCloud rows). We import the
// ban-list (single source — the two guards cannot drift) and apply ONLY the
// render-safe subset: inflation stats that are never the real number, and pure
// machine-filler tells. The real live counts ("95 active agents", "22 carriers
// ·") are DELIBERATELY NOT in that subset — on a rendered page those are the
// truth from landing_live_stats(), not a defect. Marketing superlatives a human
// might legitimately write stay source-only. Startup-asserted against FORBIDDEN
// so a rename in the source guard fails LOUD here instead of silently stopping.
{
  const known = new Set(FORBIDDEN.map(([t]) => t.toLowerCase()));
  for (const t of RENDER_SAFE_TERMS)
    if (!known.has(t.toLowerCase()))
      throw new Error(`RENDER_SAFE_TERMS drift: "${t}" is no longer verbatim in FORBIDDEN (check-forbidden-language.mjs) — the render AI-tell scan would silently stop covering it`);
}
const AI_TELL_TOKENS = FORBIDDEN
  .filter(([term]) => RENDER_SAFE_TERMS.has(term))
  .map(([term, reason]) => [
    // Escaped literal, case-insensitive, substring (NO \b) — mirrors the source
    // guard's lower.includes(term) exactly, so the two detectors agree.
    new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    `AI-tell / inflated-stat "${term}" rendered to public copy — ${reason}`,
  ]);

// Single source of truth for token scanning. probe() and --selftest BOTH call
// this, so the selftest exercises the real detector (a guard that copies the
// code it guards is not a guard).
function scanForBadTokens(text) {
  const hits = [];
  for (const [re, why] of [...BAD_TOKENS, ...PLACEHOLDER_TOKENS, ...AI_TELL_TOKENS]) {
    const m = text.match(re);
    if (m) hits.push({ token: m[0], why });
  }
  return hits;
}

// MP-WIB-HERO-FEED (2026-11-16): the homepage hero production ticker
// (DealsTicker.tsx — "🔥 NAME closed $X ALP", the "Numbers not slogans" bar)
// is the site's single most prominent trust / social-proof element, and it is
// DB-driven: a hand-rolled anon POST to the SECURITY DEFINER RPC
// landing_deal_highlights, which returns the top producers whose deals landed
// in public.deals in the LAST 30 DAYS (status submitted/active, ALP >= 500).
//
// Every assertion above catches a BROKEN number (NaN/undefined/$0) or a
// white-screen. NONE of them catches the window going EMPTY. If the deal feed
// freezes (the exact class that froze the YouTube sync 175d, the weekly
// scoreboard 176d, and that retired the AgentLink sync), the 30-day window
// drains to zero rows, the RPC returns [], and DealsTicker renders its
// carrier-only fallback — valid tokens, no broken money, no crash — so the
// render guard stays GREEN while the homepage silently loses all of its live
// social proof. The CFO production-freshness pulse watches a DIFFERENT operand
// (apex_native run-rate decline), not this public ALL-deals hero, so the two do
// not overlap. This asserts, at the surface a visitor actually sees, that the
// hero is NOT empty.
//
// Detector counts DISTINCT producer first-names (the RPC UPPERs + first-word-
// splits them, and the component renders the list TWICE for a seamless loop, so
// a distinct-name count is immune to that doubling). Proven both directions on
// live prod before shipping: carrier-only text -> 0, one deal -> 1, the live
// board -> 9 (EDWIN..CARI, exactly the RPC's rows). It is deliberately anchored
// on the full "NAME closed $X ALP" shape so ordinary prose containing the word
// "closed" (e.g. "our office is closed on Sundays") cannot trip it.
const HERO_DEAL_RE = /([A-Z][A-Za-z.'’-]{1,30})\s+closed\s+\$[\d,]+\s+ALP/g;
function countHeroProducers(text) {
  const names = new Set();
  let m;
  HERO_DEAL_RE.lastIndex = 0;
  while ((m = HERO_DEAL_RE.exec(text)) !== null) names.add(m[1].toUpperCase());
  return names.size;
}
// Default floor = 1, i.e. a DEFECT fires ONLY when the hero rendered ZERO
// producers on EVERY leg (total collapse — the feed drained / the RPC failed /
// the anon key rotated). A legitimately thin board (a slow sales week) is NOT a
// defect — that run-rate question is the CFO pulse's, not this guard's — so this
// never cries wolf; the live count is always reported so a thinning board is
// visible without paging. Raise MIN_HERO_PRODUCERS to tighten.
const MIN_HERO_PRODUCERS = Number(process.env.MIN_HERO_PRODUCERS || 1);

// MP-WIB-FUNNEL-CANONICAL (2026-11-16, Website Integrity Bot, Check #3/SEO).
// The per-route self-referencing canonical is injected CLIENT-SIDE by
// src/components/seo/RouteCanonical.tsx — Googlebot renders JS and honors the
// rendered <link rel="canonical">, so the raw-HTML homepage canonical that
// every SPA route serves is corrected only after hydration. Two guards already
// touch canonical, and both leave the money pages uncovered:
//   - check-canonical-url.mjs proves the fix is WIRED IN SOURCE (static, no DOM).
//   - careers-jobposting-render.mjs proves the RENDERED canonical, but only on
//     the /careers/* cluster (hub + 10 state pages).
// Nothing opened a browser to prove the rendered canonical on the funnel routes
// a visitor actually converts on (/apply, /vsl, /get-licensed, /storefront,
// /links, ...). If RouteCanonical silently regressed there — a refactor drops
// it, a lazy-route mount race, a second head-manager overwrites it — those pages
// declare the HOMEPAGE as their canonical again, Google dedups them onto "/",
// and the whole recruiting/lead funnel falls out of the index, while
// check-canonical-url stays green (the source is still wired) and the
// /careers guard stays green (its own subtree is fine). Verified live
// 2026-11-16: all 11 funnel routes rendered the correct self-canonical
// (count=1 each), so this LOCKS a currently-correct surface, it does not fix a
// live leak. The live count is always in the result so a change is visible.
//
// ORIGIN is the FIXED prod origin RouteCanonical emits (never window.location);
// check-canonical-url.mjs Rule A asserts it equals index.html's canonical host,
// so a preview render that (correctly) injects the prod-origin canonical grades
// as a pass, and a RouteCanonical that wrongly read window.location.origin and
// leaked a *.vercel.app canonical into a crawled preview grades as a defect.
const CANONICAL_ORIGIN = "https://apex-financial.org";
// /careers and /careers/<slug> rendered canonical is owned by
// careers-jobposting-render.mjs. This guard does NOT re-assert it — single
// ownership keeps the two from drifting into a he-said-she-said on one operand.
const canonicalOwnedElsewhere = (route) => route === "/careers" || route.startsWith("/careers/");

// Mirrors RouteCanonical.canonicalHref: origin + pathname only, a trailing slash
// collapsed except on root, root is the bare origin (no slash). The probe's
// ROUTES carry no query/hash, so this is the full normalization they need.
function expectedCanonical(route) {
  let path = route || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path === "/" ? CANONICAL_ORIGIN : `${CANONICAL_ORIGIN}${path}`;
}

// Pure grader — the SAME function probe() runs on the live rendered DOM and the
// --selftest exercises with zero network. Returns a (possibly empty) defect list.
function gradeCanonical(route, { canonical, canonicalCount }) {
  const defects = [];
  const want = expectedCanonical(route);
  if (canonicalCount === 0) {
    defects.push(
      `no <link rel="canonical"> in the rendered DOM — RouteCanonical did not mount on this route, so a crawler ` +
      `falls back to index.html's static HOMEPAGE canonical and this funnel page de-indexes onto "/"`);
    return defects; // canonical value is meaningless when none rendered
  }
  if (canonicalCount > 1) {
    defects.push(
      `${canonicalCount} <link rel="canonical"> tags rendered — crawlers ignore a page that declares multiple ` +
      `canonicals, dropping this route's self-canonical and re-opening the dedup leak`);
  }
  if (canonical !== want) {
    defects.push(
      `rendered canonical is ${JSON.stringify(canonical)}, expected self-URL ${JSON.stringify(want)} — ` +
      `RouteCanonical regressed and this funnel page points Google at a different URL (dedup/de-index leak)`);
  }
  return defects;
}

// MP-529: a leg is (engine, viewport), never (viewport, user-agent string).
//
// Until this wave the "mobile" leg was a CHROMIUM context handed an iPhone
// Safari UA string. That is a costume, and it was measured as one on
// 2026-09-14 against live prod: under the spoof navigator.vendor still read
// "Google Inc." and two Blink-only APIs (scheduler, requestIdleCallback)
// were present that real WebKit does not have. So an iOS-Safari-only fault —
// an unguarded Blink-only API, a WebKit layout or parser difference — renders
// a white screen on the traffic the charter calls primary ("Sam runs from his
// phone; broken on iPhone Safari = broken") while this probe reports the
// mobile leg CLEAN. Check #7 of the bot charter had never once been executed
// on a Safari engine on this machine: there was no webkit build in
// ~/Library/Caches/ms-playwright at all.
//
// The Blink phone-viewport leg is KEPT — it is still the right instrument for
// layout overflow and for matching what Chrome-on-Android users see — but it
// is named for the engine it actually runs, so the report can no longer be
// read as Safari coverage.
//
// engineVendor is the anti-costume assertion: navigator.vendor is NOT
// rewritten by the userAgent context option (proven — the spoofed leg still
// reported "Google Inc."), so it is the one field that catches a future
// Playwright change silently running the wrong engine under the right label.
const LEGS = [
  { label: "desktop-blink", type: chromium, engineVendor: "Google Inc.",
    ctx: { viewport: { width: 1440, height: 900 } } },
  { label: "mobile-blink", type: chromium, engineVendor: "Google Inc.", mobile: true,
    ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } },
  { label: "mobile-webkit", type: webkit, engineVendor: "Apple Computer, Inc.", mobile: true,
    ctx: { ...devices["iPhone 14"] } },
];

async function controlReachable() {
  try {
    const r = await fetch(CONTROL, { method: "GET", signal: AbortSignal.timeout(8000) });
    return r.status === 204 || r.ok;
  } catch { return false; }
}

async function probe(browser, leg, route) {
  const { label } = leg;
  const ctx = await browser.newContext(leg.ctx);
  const pg = await ctx.newPage();
  const consoleErrs = [];
  pg.on("console", (m) => { if (m.type() === "error") consoleErrs.push(m.text().slice(0, 200)); });
  pg.on("pageerror", (e) => consoleErrs.push("PAGEERROR: " + String(e).slice(0, 200)));

  let status = 0, navErr = null;
  try {
    const resp = await pg.goto(BASE + route, { waitUntil: "load", timeout: 40000 });
    status = resp ? resp.status() : 0;
  } catch (e) { navErr = String(e).slice(0, 160); }

  if (navErr) { await ctx.close(); return { label, route, ok: false, navErr }; }

  await pg.waitForTimeout(SETTLE_MS);

  // Anti-costume: prove the engine is the one this leg is named for. A label
  // that says webkit over a Blink context is exactly the defect MP-529 fixed,
  // and it would be silent without this read.
  const vendor = await pg.evaluate(() => navigator.vendor).catch(() => "<unreadable>");

  // The WHOLE body is scanned. Until 2026-10-07 this was .slice(0, 12000), and
  // the homepage had grown to 14,502 chars, so the last 17% (closing CTA with
  // the live "{active_agents}+ agents" number, the FAQ, the footer and the
  // income disclaimer) was scanned by nothing. textLen below read the SLICED
  // length, so this probe's own output capped at 12000 and could not show it
  // was truncating. Latent when found: that one live number floors at 40
  // (CTASection.tsx), so a null RPC could not have printed NaN there.
  const bodyText = await pg.innerText("body").catch(() => "");
  const overflow = await pg.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  // 404 white-screen: the SPA renders a "page not found" component under a 200.
  const is404 = /page not found|404\s*·|404 not found/i.test(bodyText) && bodyText.length < 800;

  const badHits = scanForBadTokens(bodyText);

  // MP-WIB-HERO-FEED: only the homepage carries the production ticker. On every
  // other route heroProducers is undefined and the cross-leg check below skips
  // it, so this never mistakes a page that simply has no ticker for a collapse.
  const heroProducers = route === "/" ? countHeroProducers(bodyText) : undefined;

  // MP-WIB-FUNNEL-CANONICAL: read the client-injected self-canonical from the
  // RENDERED DOM (not raw HTML — the fix is JS). Must happen before ctx.close().
  // /careers/* is owned by careers-jobposting-render.mjs, so it is skipped here.
  let canonicalDefects = [];
  if (!canonicalOwnedElsewhere(route)) {
    const canonical = await pg.getAttribute('link[rel="canonical"]', "href").catch(() => null);
    const canonicalCount = await pg.$$eval('link[rel="canonical"]', (els) => els.length).catch(() => 0);
    canonicalDefects = gradeCanonical(route, { canonical, canonicalCount });
  }

  const routeSlug = route === "/" ? "home" : route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
  await pg.screenshot({ path: `/tmp/apex_render_${label}_${routeSlug}.png` }).catch(() => {});
  await ctx.close();

  const defects = [];
  if (status && status >= 400) defects.push(`HTTP ${status}`);
  if (is404) defects.push("404 white-screen (SPA rendered page-not-found under a 200)");
  if (leg.mobile && overflow > OVERFLOW_TOLERANCE_PX)
    defects.push(`mobile horizontal overflow ${overflow}px`);
  if (vendor !== leg.engineVendor)
    defects.push(`engine mismatch: leg "${label}" expects navigator.vendor "${leg.engineVendor}" and got "${vendor}" — this leg is not running the engine it is named for`);
  for (const b of badHits) defects.push(`broken token "${b.token}" — ${b.why}`);
  // hard page errors (React crash / unhandled) count; console warnings do not.
  const hardErrs = consoleErrs.filter((e) => /PAGEERROR|Minified React error|is not defined|Cannot read/i.test(e));
  for (const e of hardErrs) defects.push(`page error: ${e}`);
  for (const d of canonicalDefects) defects.push(d);

  return { label, route, engineVendor: vendor, ok: defects.length === 0, status, overflowPx: overflow,
           defects, consoleErrCount: consoleErrs.length, textLen: bodyText.length, heroProducers };
}

// RESULT_FILE: the scheduled runner (business-ops/scripts/apex-live-render-cron.sh)
// reads the verdict from here rather than scraping stdout, which also carries prose.
import { writeFileSync } from "node:fs";
const RESULT_FILE = process.env.RESULT_FILE || "";
const _err = console.error;
function record(obj) { if (RESULT_FILE) { try { writeFileSync(RESULT_FILE, JSON.stringify(obj)); } catch (e) { _err("RESULT_FILE write failed: " + e); } } }

// --selftest: prove the token detector in BOTH directions with zero rendering
// (no browser, no network), so it can run anywhere and never flakes. It calls
// the SAME scanForBadTokens() that probe() uses on live DOM text.
if (process.argv.includes("--selftest")) {
  const cases = [
    { name: "clean funnel copy", text: "Start your career in insurance sales. 95 active agents. Apply now.", expectHit: false },
    { name: "lorem ipsum leak (DB seed)", text: "About us: Lorem ipsum dolor sit amet, consectetur.", expectHit: true },
    { name: "'coming soon' vaporware", text: "Our Sales Academy is coming soon!", expectHit: true },
    { name: "John Doe fake name (DB row)", text: "Top producer this week: John Doe — $50,000 ALP.", expectHit: true },
    { name: "TBD unfilled placeholder", text: "Next seminar: TBD", expectHit: true },
    { name: "example.com placeholder domain", text: "Email us at team@example.com today.", expectHit: true },
    { name: "[placeholder] annotation", text: "Headline: [placeholder]", expectHit: true },
    { name: "REPLACE_ME dev marker", text: "Contact: REPLACE_ME", expectHit: true },
    { name: "NaN numeric (pre-existing class)", text: "Agents: NaN+", expectHit: true },
    { name: "anti-FP: 'outbid' must not trip TBD", text: "No competitor has ever outbid us.", expectHit: false },
    { name: "anti-FP: 'replacement' must not trip REPLACE_ME", text: "We build a complete income-replacement plan.", expectHit: false },
    { name: "anti-FP: 'become soon' must not trip coming-soon", text: "You could become a top earner soon.", expectHit: false },
    // MP-WIB-RENDER-AITELL: the AI-tell / inflated-stat class, both directions.
    { name: "inflated 'thousands of agents' (DB/stale stat card)", text: "Join thousands of agents building generational wealth.", expectHit: true },
    { name: "inflated '50+ carriers' (real count is 22)", text: "We partner with 50+ carriers nationwide.", expectHit: true },
    { name: "AI-tell 'delve into' (DB testimonial seed)", text: "Let's delve into exactly why Apex works.", expectHit: true },
    { name: "AI-tell 'in the realm of'", text: "In the realm of insurance sales, speed wins.", expectHit: true },
    { name: "anti-FP: real live '95 active agents' + '22 carriers ·' are the TRUTH, not banned on render", text: "95 active agents. 22 carriers · nationwide coverage.", expectHit: false },
    { name: "anti-FP: 'transform your career' is source-only (a real agent might say it)", text: "Apex can transform your career in 90 days.", expectHit: false },
  ];
  let fail = 0;
  for (const c of cases) {
    const hits = scanForBadTokens(c.text);
    const hit = hits.length > 0;
    const pass = hit === c.expectHit;
    if (!pass) fail++;
    console.log(`${pass ? "PASS" : "FAIL"}  expectHit=${String(c.expectHit).padEnd(5)} got=${String(hit).padEnd(5)}  ${c.name}${hit ? "  -> " + JSON.stringify(hits[0].token) : ""}`);
  }
  // MP-WIB-HERO-FEED: prove countHeroProducers both directions, no browser — the
  // SAME function probe() runs on live DOM. Collapse -> 0 is the state that must
  // page; a legitimate board counts its distinct producers through the component's
  // seamless-loop doubling; ordinary prose with "closed" must not trip.
  const heroCases = [
    { name: "hero collapsed to carrier-only (feed drained -> DEFECT)", text: "Our agents write with\nAmerican National\n|\nOur agents write with\nMutual of Omaha", expect: 0 },
    { name: "one live producer rendered", text: "🔥\nEDWIN\nclosed\n$39,867\nALP", expect: 1 },
    { name: "full board (2 distinct, ticker-doubled -> still 2)", text: "🔥\nEDWIN\nclosed\n$39,867\nALP\n🔥\nJONTAY\nclosed\n$13,751\nALP\n".repeat(2), expect: 2 },
    { name: "anti-FP: prose 'closed' + a '$' figure is NOT a deal item", text: "Our office is closed on Sundays. We invest $5,000 in every new agent.", expect: 0 },
  ];
  for (const c of heroCases) {
    const got = countHeroProducers(c.text);
    const pass = got === c.expect;
    if (!pass) fail++;
    console.log(`${pass ? "PASS" : "FAIL"}  hero expect=${c.expect} got=${got}  ${c.name}`);
  }
  // MP-WIB-FUNNEL-CANONICAL: prove gradeCanonical both directions, no browser —
  // the SAME grader probe() runs on the live rendered DOM. A funnel page still
  // pointing at the homepage (or carrying zero/duplicate canonicals, or a
  // preview-host origin) is the de-index state that must page; a self-referencing
  // canonical on the fixed prod origin must pass.
  const canonicalCases = [
    { name: "self-canonical on /apply (correct)", route: "/apply", dom: { canonical: "https://apex-financial.org/apply", canonicalCount: 1 }, expectDefect: false },
    { name: "root is the bare prod origin (correct)", route: "/", dom: { canonical: "https://apex-financial.org", canonicalCount: 1 }, expectDefect: false },
    { name: "deep self-canonical /get-licensed (correct)", route: "/get-licensed", dom: { canonical: "https://apex-financial.org/get-licensed", canonicalCount: 1 }, expectDefect: false },
    { name: "REGRESSION: /vsl still declares the homepage (de-index leak)", route: "/vsl", dom: { canonical: "https://apex-financial.org", canonicalCount: 1 }, expectDefect: true },
    { name: "REGRESSION: RouteCanonical never mounted — 0 canonical tags", route: "/storefront", dom: { canonical: null, canonicalCount: 0 }, expectDefect: true },
    { name: "REGRESSION: two canonicals rendered (crawler ignores both)", route: "/links", dom: { canonical: "https://apex-financial.org/links", canonicalCount: 2 }, expectDefect: true },
    { name: "REGRESSION: preview-host leak — canonical on a *.vercel.app origin", route: "/apply", dom: { canonical: "https://preview-abc123.vercel.app/apply", canonicalCount: 1 }, expectDefect: true },
    { name: "anti-FP: trailing slash collapses /apply/ -> /apply (correct)", route: "/apply/", dom: { canonical: "https://apex-financial.org/apply", canonicalCount: 1 }, expectDefect: false },
  ];
  for (const c of canonicalCases) {
    const defs = gradeCanonical(c.route, c.dom);
    const got = defs.length > 0;
    const pass = got === c.expectDefect;
    if (!pass) fail++;
    console.log(`${pass ? "PASS" : "FAIL"}  canon expectDefect=${String(c.expectDefect).padEnd(5)} got=${String(got).padEnd(5)}  ${c.name}${got ? "  -> " + JSON.stringify(defs[0].slice(0, 54)) : ""}`);
  }
  const total = cases.length + heroCases.length + canonicalCases.length;
  console.log(fail ? `\n❌ selftest FAILED: ${fail}/${total} case(s)` : `\n✅ selftest PASSED: ${total}/${total} — placeholder + numeric token + hero-feed + funnel-canonical detectors proven both directions`);
  process.exit(fail ? 1 : 0);
}

(async () => {
  const results = [];
  const unavailable = [];

  for (const leg of LEGS) {
    let browser;
    try {
      browser = await leg.type.launch({ headless: true });
    } catch (e) {
      // The browser binary is missing (or failed to start). This is an
      // INSTRUMENT fault, never a site verdict, and it must never be laundered
      // into the CLEAN line — a leg that could not run has not passed. This is
      // the state webkit was in on this machine until 2026-09-14: absent, and
      // therefore silently uncovered. One unavailable entry per (leg, route) so
      // the "CLEAN over a leg that never ran is a lie" accounting stays honest
      // once the funnel is more than one page.
      for (const route of ROUTES)
        unavailable.push({ label: leg.label, route, reason: String(e).split("\n")[0].slice(0, 200) });
      continue;
    }
    for (const route of ROUTES) {
      let r = await probe(browser, leg, route);
      if (r.navErr) r = await probe(browser, leg, route); // one retry on nav failure
      results.push(r);
    }
    await browser.close();
  }

  if (!results.length) {
    record({ verdict: "INSTRUMENT_UNAVAILABLE", unavailable });
    console.error(JSON.stringify({ verdict: "INSTRUMENT_UNAVAILABLE",
      reason: "no browser engine could be launched — nothing about the site was measured",
      remedy: "npx playwright install chromium webkit", unavailable }, null, 2));
    process.exit(4);
  }

  const navFailed = results.filter((r) => r.navErr);
  if (navFailed.length === results.length) {
    const controlUp = await controlReachable();
    if (!controlUp) {
      record({ verdict: "UNKNOWN", results });
      console.log(JSON.stringify({ verdict: "UNKNOWN", reason: "site AND control both unreachable — network/laptop offline, not a site defect", results }, null, 2));
      process.exit(0); // never false-red on Sam's wifi dropping
    }
    record({ verdict: "SITE_DOWN", results });
    console.error(JSON.stringify({ verdict: "SITE_DOWN", reason: "control reachable but site did not load on any viewport", results }, null, 2));
    process.exit(2);
  }

  const defective = results.filter((r) => r.ok === false && !r.navErr);
  // A (leg, route) whose navigation failed twice while another leg loaded the
  // same URL was NOT measured. Until 2026-10-06 it fell through both filters and
  // the run printed CLEAN naming it in legsRun — so a WebKit-only load failure
  // (the one fault class this file's mobile-webkit leg exists to catch) read as
  // a pass. It is reported with the never-ran measurements, which is what it is.
  for (const r of navFailed) unavailable.push({ label: r.label, route: r.route, reason: "navigation failed twice: " + r.navErr });
  const measured = results.filter((r) => !r.navErr);

  // MP-WIB-HERO-FEED cross-leg assertion: the homepage hero must render at least
  // MIN_HERO_PRODUCERS live producers on at LEAST ONE measured leg. Taking the
  // max across legs (not every leg) is the anti-flake guarantee — a single slow
  // RPC on one engine cannot false-red while the other legs show the board; only
  // a genuine feed-wide collapse (empty on all 3) trips it. If the homepage was
  // not measured on any leg (all home legs nav-failed), homeLegs is empty and
  // this is skipped — that state is already carried by legsNotRun / UNKNOWN, not
  // laundered into a hero defect.
  const crossLegDefects = [];
  const homeLegs = measured.filter((r) => r.route === "/" && typeof r.heroProducers === "number");
  const bestHero = homeLegs.length ? Math.max(...homeLegs.map((r) => r.heroProducers)) : null;
  if (homeLegs.length && bestHero < MIN_HERO_PRODUCERS) {
    crossLegDefects.push(
      `[all legs /] homepage hero production ticker rendered ${bestHero} live producer(s) ` +
      `(need >= ${MIN_HERO_PRODUCERS}) — the landing_deal_highlights 30-day window has drained, ` +
      `the public RPC failed, or the anon key is dead; the site's primary "Numbers not slogans" ` +
      `social proof collapsed to a carrier-only bar while every broken-token / white-screen assertion stayed green`);
  }

  const verdict = (defective.length || crossLegDefects.length) ? "DEFECT" : (unavailable.length ? "CLEAN_PARTIAL" : "CLEAN");
  const legsRun = [...new Set(measured.map((r) => r.label))].join(", ");
  const routesRun = [...new Set(measured.map((r) => r.route))].join(", ");
  record({ verdict, base: BASE, legsRun, routesRun, legsNotRun: unavailable, heroProducers: bestHero,
    defects: [...defective.flatMap((r) => r.defects.map((d) => `[${r.label} ${r.route}] ${d}`)), ...crossLegDefects] });
  console.log(JSON.stringify({ verdict, base: BASE, legsRun, routesRun, heroProducers: bestHero,
    legsNotRun: unavailable, results }, null, 2));
  if (defective.length || crossLegDefects.length) {
    console.error("\nRENDERED INTEGRITY DEFECTS:");
    for (const r of defective) for (const d of r.defects) console.error(`  [${r.label} ${r.route}] ${d}`);
    for (const d of crossLegDefects) console.error(`  ${d}`);
    process.exit(1);
  }
  if (unavailable.length) {
    // Says exactly which engine/route went unmeasured. "CLEAN" over a leg that
    // never ran is the same lie as a green build over a suite that never ran.
    const engines = [...new Set(unavailable.map((u) => u.label.split("-").pop()))];
    console.error(`\n⚠️  live render integrity CLEAN on [${legsRun}] × [${routesRun}] — but ${unavailable.length} measurement(s) never ran: ` +
      unavailable.map((u) => `${u.label} ${u.route}`).join(", ") + `. Those were NOT measured.`);
    console.error(`   remedy: npx playwright install ${engines.join(" ")}`);
    process.exit(3);
  }
  console.log(`\n✅ live render integrity CLEAN — ${BASE} on [${legsRun}] × [${routesRun}]: no broken tokens, no mobile overflow, every leg on the engine it is named for` +
    (bestHero !== null ? `, hero production ticker shows ${bestHero} live producer(s)` : ``) + `.`);
})();
