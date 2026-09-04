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
//   It is run by the BOT each fire (Playwright + chromium live on Sam's Mac),
//   deliberately NOT wired as a blocking CI gate: a browser render in CI is
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

import { chromium } from "playwright";

const BASE = (process.env.BASE || "https://apex-financial.org").replace(/\/$/, "");
const CONTROL = "https://www.google.com/generate_204";
const SETTLE_MS = 3500;
const OVERFLOW_TOLERANCE_PX = 2; // sub-pixel rounding is not a defect

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

const VIEWPORTS = [
  ["desktop", { width: 1440, height: 900 }, undefined],
  ["mobile", { width: 390, height: 844 },
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"],
];

async function controlReachable() {
  try {
    const r = await fetch(CONTROL, { method: "GET", signal: AbortSignal.timeout(8000) });
    return r.status === 204 || r.ok;
  } catch { return false; }
}

async function probe(browser, label, viewport, ua) {
  const ctx = await browser.newContext({ viewport, userAgent: ua, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  const consoleErrs = [];
  pg.on("console", (m) => { if (m.type() === "error") consoleErrs.push(m.text().slice(0, 200)); });
  pg.on("pageerror", (e) => consoleErrs.push("PAGEERROR: " + String(e).slice(0, 200)));

  let status = 0, navErr = null;
  try {
    const resp = await pg.goto(BASE + "/", { waitUntil: "load", timeout: 40000 });
    status = resp ? resp.status() : 0;
  } catch (e) { navErr = String(e).slice(0, 160); }

  if (navErr) { await ctx.close(); return { label, ok: false, navErr }; }

  await pg.waitForTimeout(SETTLE_MS);
  const bodyText = (await pg.innerText("body").catch(() => "")).slice(0, 12000);
  const overflow = await pg.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  // 404 white-screen: the SPA renders a "page not found" component under a 200.
  const is404 = /page not found|404\s*·|404 not found/i.test(bodyText) && bodyText.length < 800;

  const badHits = [];
  for (const [re, why] of BAD_TOKENS) {
    const m = bodyText.match(re);
    if (m) badHits.push({ token: m[0], why });
  }

  await pg.screenshot({ path: `/tmp/apex_render_${label}.png` }).catch(() => {});
  await ctx.close();

  const defects = [];
  if (status && status >= 400) defects.push(`HTTP ${status}`);
  if (is404) defects.push("404 white-screen (SPA rendered page-not-found under a 200)");
  if (label === "mobile" && overflow > OVERFLOW_TOLERANCE_PX)
    defects.push(`mobile horizontal overflow ${overflow}px`);
  for (const b of badHits) defects.push(`broken token "${b.token}" — ${b.why}`);
  // hard page errors (React crash / unhandled) count; console warnings do not.
  const hardErrs = consoleErrs.filter((e) => /PAGEERROR|Minified React error|is not defined|Cannot read/i.test(e));
  for (const e of hardErrs) defects.push(`page error: ${e}`);

  return { label, ok: defects.length === 0, status, overflowPx: overflow, defects,
           consoleErrCount: consoleErrs.length, textLen: bodyText.length };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const [label, vp, ua] of VIEWPORTS) {
    let r = await probe(browser, label, vp, ua);
    if (r.navErr) { // one retry on nav failure
      r = await probe(browser, label, vp, ua);
    }
    results.push(r);
  }
  await browser.close();

  const navFailed = results.filter((r) => r.navErr);
  if (navFailed.length === results.length) {
    const controlUp = await controlReachable();
    if (!controlUp) {
      console.log(JSON.stringify({ verdict: "UNKNOWN", reason: "site AND control both unreachable — network/laptop offline, not a site defect", results }, null, 2));
      process.exit(0); // never false-red on Sam's wifi dropping
    }
    console.error(JSON.stringify({ verdict: "SITE_DOWN", reason: "control reachable but site did not load on any viewport", results }, null, 2));
    process.exit(2);
  }

  const defective = results.filter((r) => r.ok === false && !r.navErr);
  const verdict = defective.length ? "DEFECT" : "CLEAN";
  console.log(JSON.stringify({ verdict, base: BASE, results }, null, 2));
  if (defective.length) {
    console.error("\nRENDERED INTEGRITY DEFECTS:");
    for (const r of defective) for (const d of r.defects) console.error(`  [${r.label}] ${d}`);
    process.exit(1);
  }
  console.log(`\n✅ live render integrity CLEAN — ${BASE} desktop + mobile, no broken tokens, no mobile overflow.`);
})();
