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
const ROUTES = (process.env.ROUTES || "/,/apply,/vsl,/schedule-call,/get-licensed,/storefront")
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

// Single source of truth for token scanning. probe() and --selftest BOTH call
// this, so the selftest exercises the real detector (a guard that copies the
// code it guards is not a guard).
function scanForBadTokens(text) {
  const hits = [];
  for (const [re, why] of [...BAD_TOKENS, ...PLACEHOLDER_TOKENS]) {
    const m = text.match(re);
    if (m) hits.push({ token: m[0], why });
  }
  return hits;
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

  return { label, route, engineVendor: vendor, ok: defects.length === 0, status, overflowPx: overflow,
           defects, consoleErrCount: consoleErrs.length, textLen: bodyText.length };
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
  ];
  let fail = 0;
  for (const c of cases) {
    const hits = scanForBadTokens(c.text);
    const hit = hits.length > 0;
    const pass = hit === c.expectHit;
    if (!pass) fail++;
    console.log(`${pass ? "PASS" : "FAIL"}  expectHit=${String(c.expectHit).padEnd(5)} got=${String(hit).padEnd(5)}  ${c.name}${hit ? "  -> " + JSON.stringify(hits[0].token) : ""}`);
  }
  console.log(fail ? `\n❌ selftest FAILED: ${fail}/${cases.length} case(s)` : `\n✅ selftest PASSED: ${cases.length}/${cases.length} — placeholder + numeric token detector proven both directions`);
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
  const verdict = defective.length ? "DEFECT" : (unavailable.length ? "CLEAN_PARTIAL" : "CLEAN");
  const legsRun = [...new Set(measured.map((r) => r.label))].join(", ");
  const routesRun = [...new Set(measured.map((r) => r.route))].join(", ");
  record({ verdict, base: BASE, legsRun, routesRun, legsNotRun: unavailable,
    defects: defective.flatMap((r) => r.defects.map((d) => `[${r.label} ${r.route}] ${d}`)) });
  console.log(JSON.stringify({ verdict, base: BASE, legsRun, routesRun,
    legsNotRun: unavailable, results }, null, 2));
  if (defective.length) {
    console.error("\nRENDERED INTEGRITY DEFECTS:");
    for (const r of defective) for (const d of r.defects) console.error(`  [${r.label} ${r.route}] ${d}`);
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
  console.log(`\n✅ live render integrity CLEAN — ${BASE} on [${legsRun}] × [${routesRun}]: no broken tokens, no mobile overflow, every leg on the engine it is named for.`);
})();
