#!/usr/bin/env node
// mobile-overflow.mjs — iPhone-14 horizontal-overflow smoke of the public funnel.
//
// Catches the bug class Check #7 (Website Integrity Bot mobile audit) has never
// had a guard for: a public route that renders a horizontal scrollbar on a
// phone. A single `w-[500px]`, an un-wrapped table, a `min-w` on a flex child,
// a `100vw` element inside a padded container, or a grid that doesn't collapse
// at the phone breakpoint all ship green through tsc, route-smoke (pure fetch,
// no layout) and Lighthouse (scores perf, not layout width). The recruit opens
// the apply funnel on their phone, the page slides sideways, and the form field
// they need is off-screen. That is a conversion leak invisible to every other
// gate in the repo.
//
// THE SIGNAL IS DELIBERATELY NARROW. The pass/fail verdict is ONLY:
//     document.documentElement.scrollWidth > window.innerWidth + TOLERANCE
// i.e. "does the page itself scroll sideways". It does NOT flag individual
// elements whose box extends past the viewport, because content inside a
// marquee/ticker (translateX animation) or any `overflow:hidden`/`overflow-x:clip`
// ancestor legitimately has a right edge far past the viewport while the PAGE
// does not scroll — those are false positives (observed live on `/`: a stats
// ticker sits at x=16000 inside a clipped track, page scrollWidth stays 390).
// The single worst offending element is captured DIAGNOSTICALLY to make a real
// failure actionable, but it never votes on the verdict.
//
// Post-deploy, against the live promoted commit, mirroring route-smoke.mjs and
// lighthouse-prod.mjs. It alerts on the GitHub run (+ notification hooks); it is
// NOT a paging daemon (that class has a long history of false pages in this
// system — a deterministic DOM width measured on the exact shipped commit is the
// right tool, a timer-fired live prober is not).
//
// Usage:
//   BASE=https://apex-financial.org node scripts/mobile-overflow.mjs
//   BASE=http://localhost:8080      node scripts/mobile-overflow.mjs
//   node scripts/mobile-overflow.mjs --selftest   # prove the detector both ways, no network
//   PW_CHANNEL=chrome node scripts/mobile-overflow.mjs   # use system Chrome (CI, no browser download)
//
// Exit non-zero on any route with real horizontal overflow (or on the selftest
// failing to behave both directions), so CI can block/alert.

import { chromium, devices } from "playwright";

const BASE = process.env.BASE || "https://apex-financial.org";
const TOLERANCE = 3; // px — sub-pixel layout rounding is not a sideways-scrolling page.
const SETTLE_MS = 900; // let fonts + hydration + the first animation frame land.
const NAV_TIMEOUT = 35000;

// The public funnel a recruit/lead actually walks on a phone. Keep this to
// real conversion surfaces — the point is the money path, not every route.
const FUNNEL_ROUTES = [
  "/",
  "/apply",
  "/vsl",
  "/get-licensed",
  "/start-contracting",
  "/unlicensed-overview",
  "/seminar",
  "/leads",
  "/get-leads",
  "/contact",
];

const IPHONE = devices["iPhone 14"];

function launchOpts() {
  // CI can set PW_CHANNEL=chrome to use the runner's preinstalled Google Chrome
  // (same browser Lighthouse uses here) instead of downloading Playwright's build.
  return process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {};
}

// The exact DOM measurement, as a string so the selftest and the live run use
// byte-for-byte the same detector (a guard that measures differently in its own
// test than in production proves nothing).
const MEASURE = `(() => {
  const innerW = window.innerWidth;
  const docW = document.documentElement.scrollWidth;
  const overflow = docW - innerW;
  // Diagnostic only: the worst element whose right edge is past the viewport AND
  // which is not clipped away by an ancestor (so it plausibly explains a real
  // page overflow). Never used for the verdict.
  let worst = null;
  if (overflow > 0) {
    const clipped = (el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const ox = cs.overflowX;
        if (ox === "hidden" || ox === "clip" || ox === "scroll" || ox === "auto") return true;
      }
      return false;
    };
    let worstOver = 0;
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.visibility === "hidden" || cs.opacity === "0") continue;
      const over = Math.round(r.right - innerW);
      if (over <= worstOver) continue;
      if (clipped(el)) continue;
      worstOver = over;
      const tag = el.tagName.toLowerCase();
      const id = el.id ? "#" + el.id : "";
      const cls = (el.className && typeof el.className === "string")
        ? "." + el.className.trim().split(/\\s+/).slice(0, 3).join(".") : "";
      worst = { sel: tag + id + cls, over, left: Math.round(r.left), width: Math.round(r.width) };
    }
  }
  return { innerW, docW, overflow, worst };
})()`;

async function selftest() {
  // No network: a 9999px-wide element MUST register overflow; a clean page MUST NOT.
  const browser = await chromium.launch(launchOpts());
  const ctx = await browser.newContext({ ...IPHONE });
  const page = await ctx.newPage();
  let ok = true;

  await page.setContent(
    `<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0"><div style="width:9999px;height:40px;background:#c00">wide</div></body></html>`
  );
  await page.waitForTimeout(100);
  const bad = await page.evaluate(MEASURE);
  if (bad.overflow <= TOLERANCE) {
    console.error(`SELFTEST FAIL: a 9999px element produced overflow=${bad.overflow} (expected > ${TOLERANCE})`);
    ok = false;
  } else {
    console.log(`selftest[overflow] OK: detected overflow=${bad.overflow}px, worst=${bad.worst?.sel}`);
  }

  await page.setContent(
    `<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0"><div style="width:100%;height:40px;background:#0c0">clean</div>` +
    // a clipped wide child — the marquee false-positive class — must NOT trip the verdict
    `<div style="overflow-x:hidden;width:100%"><div style="width:5000px;height:10px"></div></div></body></html>`
  );
  await page.waitForTimeout(100);
  const good = await page.evaluate(MEASURE);
  if (good.overflow > TOLERANCE) {
    console.error(`SELFTEST FAIL: a clean+clipped page produced overflow=${good.overflow} (expected <= ${TOLERANCE})`);
    ok = false;
  } else {
    console.log(`selftest[clean] OK: overflow=${good.overflow}px (clipped wide child correctly ignored)`);
  }

  await browser.close();
  return ok;
}

async function run() {
  const browser = await chromium.launch(launchOpts());
  const ctx = await browser.newContext({ ...IPHONE });
  let failed = 0;
  const rows = [];

  for (const route of FUNNEL_ROUTES) {
    const url = BASE + route;
    const page = await ctx.newPage();
    const row = { route, status: null, overflow: null, worst: null, err: null };
    try {
      const resp = await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT });
      row.status = resp ? resp.status() : null;
      await page.waitForTimeout(SETTLE_MS);
      const m = await page.evaluate(MEASURE);
      row.overflow = m.overflow;
      row.worst = m.worst;
      if (m.overflow > TOLERANCE) {
        failed++;
        row.fail = true;
      }
    } catch (e) {
      // A navigation/load error is NOT a layout verdict — report it, don't
      // launder it into a pass. CI treats an errored route as a failure so a
      // route that cannot be reached is never silently green.
      row.err = String(e).split("\n")[0].slice(0, 160);
      failed++;
      row.fail = true;
    }
    rows.push(row);
    await page.close();
  }
  await browser.close();

  console.log(`\nMobile horizontal-overflow — iPhone 14 (${IPHONE.viewport.width}x${IPHONE.viewport.height}) — BASE=${BASE}\n`);
  for (const r of rows) {
    if (r.err) {
      console.log(`  ✗ ${r.route}  ERROR: ${r.err}`);
      continue;
    }
    const mark = r.fail ? "✗" : "✓";
    let line = `  ${mark} ${r.route}  [${r.status}]  overflow=${r.overflow}px`;
    if (r.fail && r.worst) {
      line += `  worst: ${r.worst.sel} (right +${r.worst.over}px past edge, x=${r.worst.left}, w=${r.worst.width})`;
    } else if (r.fail) {
      line += `  (page scrolls sideways; no single element isolated — likely a wide flex/grid child)`;
    }
    console.log(line);
  }
  console.log("");

  if (failed > 0) {
    console.error(`FAIL: ${failed} funnel route(s) with horizontal overflow or load error on ${BASE}.`);
    process.exit(1);
  }
  console.log(`OK: ${rows.length} funnel routes, no horizontal overflow on iPhone 14.`);
}

if (process.argv.includes("--selftest")) {
  const ok = await selftest();
  if (!ok) process.exit(1);
  console.log("selftest OK (both directions).");
} else {
  await run();
}
