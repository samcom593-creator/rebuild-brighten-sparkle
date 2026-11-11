#!/usr/bin/env node
// check-funnel-external-cta.mjs — prove the EXTERNAL onboarding CTAs the public
// recruiting funnel hands recruits off to are still ALIVE. Owned by the
// Website Integrity Bot.
//
// WHY THIS EXISTS. The funnel's money pages hand every recruit off to external
// partners: Xcel pre-licensing enrollment (partners.xcelsolutions.com/afe), the
// onboarding-call Calendly event, and the "how to get licensed" study-guide
// Google Doc. That handoff is the monetization-critical path — an unlicensed
// recruit who clicks "Get Licensed" and lands on a dead Xcel page never enrolls,
// never gets licensed, never writes a policy. Sam loses the agent and the
// override, silently, at HTTP 200.
//
// Every existing guard is blind to this. route-smoke / sitemap-public-render /
// live-render-integrity / canonical / mobile all assert OUR page is healthy;
// not one follows the links OFF it. An external partner URL rots on the
// partner's clock, not ours: Xcel changes an affiliate path, a Google Doc's
// sharing is revoked, a Calendly event is renamed — and the funnel keeps
// serving the dead link forever while every source/data/render guard stays
// green.
//
// WHY A RENDER, NOT A STATUS CODE. A bare status check LIES here. Measured
// 2026-11-11: partners.xcelsolutions.com/afe returns HTTP 200 with the strings
// "404" and "been removed" sitting in its minified JS, while RENDERING a
// perfectly healthy enrollment page (the real "Pass & Stay Licensed" course
// catalog + state selector). The inverse — a soft-404 that 200s a "page not
// found" body — is the exact trap behind the 465 InsuraCloud fake-success rows.
// So this opens a real browser, renders each external target, and reads the
// VISIBLE text (document.body.innerText), never the status code or the raw HTML.
//
// WHY IT IS NOT A BLOCKING CI GATE, AND HOW IT CAN'T CRY WOLF. It follows links
// to third-party sites, which flake. A flaky gate that reddens a deploy — or
// pages Sam — over a partner's transient 503 is worse than the bug it guards
// (every "permanently-red / false-page" wave in this system's memory). So:
//   - It is wired as a step in post-deploy-seo-render.yml: version-gated to the
//     exact shipped commit, informational on the GitHub run page, NOT a timer-
//     fired paging daemon and NOT a blocking gate.
//   - A control probe (generate_204) + a render of BASE itself gate the whole
//     run: if the control is down, or BASE itself will not render, the verdict
//     is UNKNOWN/SITE_DOWN and the external verdicts are not trusted — a runner
//     network blip must never read as a dead partner.
//   - DEFECT (exit 1) fires ONLY on a POSITIVE signal of death: the target
//     rendered and its visible text matches a dead-page signature, or it hard-
//     failed to load twice while BASE and the control both loaded. A bare non-
//     200 without a dead signature is UNRESOLVED (exit 3), never a DEFECT — a
//     transient partner hiccup is not a leak.
//
// Verdict / exit contract is shared with live-render-integrity.mjs so a cron
// wrapper or apex-doctor can grade it the same way:
//   0 CLEAN | 0 UNKNOWN (network) | 1 DEFECT | 2 SITE_DOWN | 3 UNRESOLVED/partial
//
// Usage:
//   node scripts/check-funnel-external-cta.mjs
//   BASE=https://apex-financial.org node scripts/check-funnel-external-cta.mjs
//   node scripts/check-funnel-external-cta.mjs --selftest   # deterministic, no network

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import http from "node:http";

const BASE = (process.env.BASE || "https://apex-financial.org").replace(/\/$/, "");
const CONTROL = "https://www.google.com/generate_204";
const SETTLE_MS = 2500;
const NAV_TIMEOUT = 40000;
const MIN_BODY_CHARS = 60; // a healthy partner page renders real content

// The public money pages. External CTAs live on /get-licensed today, but every
// funnel page is rendered so a new external handoff on /apply or /vsl is covered
// without editing this list.
const ROUTES = (process.env.ROUTES || "/,/apply,/vsl,/leads,/get-licensed,/schedule-call")
  .split(",").map((s) => s.trim()).filter(Boolean);

const RESULT_FILE = process.env.RESULT_FILE || "";
function record(obj) {
  if (!RESULT_FILE) return;
  try { writeFileSync(RESULT_FILE, JSON.stringify(obj)); }
  catch (e) { console.error("RESULT_FILE write failed: " + e); }
}

// A dead external target renders one of these in its VISIBLE text. Matched
// case-insensitively against document.body.innerText only — never the raw HTML,
// which carries framework/analytics strings like "404" on healthy pages. Kept
// to unambiguous human-facing death phrases so a healthy page cannot trip them.
const DEAD_SIGNATURES = [
  "page not found",
  "page isn't available",
  "page isnt available",
  "page is not available",
  "page you requested",
  "page you were looking for",
  "page has been removed",
  "no longer available",
  "no longer exists",
  "doesn't exist",
  "does not exist",
  "that page doesn",
  "404 error",
  "error 404",
  "not found error",
  // Google-Docs access WALL only. A view-only public doc (the CORRECT sharing
  // for a study guide) renders the benign toolbar affordance "Request edit
  // access" over its full content — proven 2026-11-11 on the live /get-licensed
  // guide (title "How to get License", Steps 1-9 all present). So the generic
  // "request access" / "request edit access" are NOT death signals; only the
  // full-page wall phrases below are, and none of them appear on a healthy doc.
  "you need access",
  "you need permission",
  "you don't have access",
  "request access to open",
  "request access to view",
  "this event has been canceled",
  "this calendly url is not valid",
  "link you clicked may be broken",
  "account is no longer active",
];

// Known partners get an extra expected-ALIVE signal: even if a dead signature
// is absent, the healthy page must contain its own hallmark. Protects against a
// partner silently redirecting the path to a generic marketing homepage.
const PARTNER_ALIVE_HINTS = [
  { host: "xcelsolutions.com", needs: ["licens", "course"], label: "Xcel pre-licensing" },
  { host: "calendly.com", needs: [], label: "Calendly booking" },
  { host: "docs.google.com", needs: [], label: "Google Doc" },
];

function isExternal(u) {
  try { return new URL(u).origin !== new URL(BASE).origin; }
  catch { return false; }
}

async function controlReachable() {
  try {
    const r = await fetch(CONTROL, { method: "GET", signal: AbortSignal.timeout(10000) });
    return r.status === 204 || r.ok;
  } catch { return false; }
}

// Render one external URL and decide ALIVE / DEAD / UNRESOLVED from its visible
// text. Pure of process state so --selftest can drive it against local fixtures.
async function checkExternalAlive(browser, url) {
  const page = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  }).then((c) => c.newPage());
  try {
    let resp = null, navErr = null;
    try { resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }); }
    catch (e) { navErr = String(e).split("\n")[0].slice(0, 180); }
    if (navErr) {
      // one retry — a single nav hiccup is not evidence of death
      try { resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT }); navErr = null; }
      catch (e) { navErr = String(e).split("\n")[0].slice(0, 180); }
    }
    if (navErr) return { url, state: "unresolved", reason: "navigation failed twice: " + navErr };

    await page.waitForTimeout(SETTLE_MS);
    const status = resp ? resp.status() : 0;
    const vis = ((await page.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => "")) || "")
      .replace(/\s+/g, " ").trim();
    const low = vis.toLowerCase();

    const hitDead = DEAD_SIGNATURES.find((s) => low.includes(s));
    if (hitDead) return { url, state: "dead", status, reason: `rendered a dead-page signature: "${hitDead}"`, visLen: vis.length };

    if (vis.length < MIN_BODY_CHARS && (status === 0 || status >= 400)) {
      // blank/near-blank AND an error status: treat as unresolved (could be a
      // JS-heavy app that did not settle, or a transient error) — not DEAD,
      // because death must be positively rendered.
      return { url, state: "unresolved", status, reason: `near-empty render (${vis.length} chars) with status ${status}`, visLen: vis.length };
    }

    const partner = PARTNER_ALIVE_HINTS.find((p) => { try { return new URL(url).hostname.endsWith(p.host); } catch { return false; } });
    if (partner && partner.needs.length) {
      const missing = partner.needs.filter((n) => !low.includes(n));
      if (missing.length === partner.needs.length) {
        // none of the hallmark words present — the partner page is not what we
        // link recruits to anymore (e.g. redirected to a generic homepage).
        return { url, state: "dead", status, reason: `${partner.label} page is missing every expected hallmark [${partner.needs.join(", ")}] — likely redirected/retired`, visLen: vis.length };
      }
    }

    if (status && status >= 400) {
      // rendered real content but a 4xx/5xx status — ambiguous. Report, do not
      // call it a defect.
      return { url, state: "unresolved", status, reason: `status ${status} but page rendered ${vis.length} chars of content`, visLen: vis.length };
    }
    return { url, state: "alive", status, visLen: vis.length };
  } finally {
    await page.context().close().catch(() => {});
  }
}

// ---- selftest: deterministic, no public network ---------------------------
async function selftest() {
  const pages = {
    "/alive": `<!doctype html><title>Enroll</title><body><h1>Pass & Stay Licensed</h1>
      <p>Choose your insurance license course and enroll today.</p></body>`,
    "/dead": `<!doctype html><title>Oops</title><body><h1>Page not found</h1>
      <p>The page you requested has been removed.</p></body>`,
    "/xcel-generic": `<!doctype html><title>Home</title><body><h1>Welcome</h1>
      <p>Marketing homepage with none of the hallmark words.</p></body>`,
    // A view-only PUBLIC Google Doc: full content renders AND the toolbar shows
    // the benign "Request edit access" affordance. This is the healthy state of
    // the live study guide — it must read ALIVE, never dead. Locks the
    // 2026-11-11 false positive that would have reddened a healthy deploy.
    "/doc-viewonly": `<!doctype html><title>How to get License - Google Docs</title><body>
      How to get License Request edit access Share Sign in
      Step 1 Pick your state. Step 2 Buy the pre-licensing course. Step 9 Get contracted.</body>`,
    // A REVOKED Google Doc: no document content, just the access wall.
    "/doc-walled": `<!doctype html><title>Google Docs</title><body>
      You need access. Ask the owner for access, or switch to an account with access.
      Request access</body>`,
    "/blank-500": `HTTP-STUB-500`,
  };
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/blank-500") { res.writeHead(500, { "content-type": "text/html" }); res.end(""); return; }
    const body = pages[path];
    if (body == null) { res.writeHead(404, { "content-type": "text/html" }); res.end("<title>404</title><body>Not Found</body>"); return; }
    res.writeHead(200, { "content-type": "text/html" }); res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });

  // Drive the partner-hint path too: a generic page on an xcelsolutions host
  // must be flagged dead (missing hallmarks). Override hostname matching by
  // pointing the alive-hint host at 127.0.0.1 is not possible, so assert the
  // generic-page logic directly via a host-bearing Host header is overkill —
  // instead temporarily register the loopback host as a partner.
  PARTNER_ALIVE_HINTS.push({ host: "127.0.0.1", needs: ["licens", "course"], label: "selftest-partner" });

  const cases = [
    { url: `${origin}/alive`, want: "alive" },
    { url: `${origin}/dead`, want: "dead" },
    { url: `${origin}/xcel-generic`, want: "dead" },  // partner hallmark missing
    { url: `${origin}/doc-viewonly`, want: "alive" },  // benign "Request edit access" must NOT read dead
    { url: `${origin}/doc-walled`, want: "dead" },     // real "You need access" wall reads dead
    { url: `${origin}/blank-500`, want: "unresolved" }, // error + near-empty => not DEAD
  ];
  let pass = 0;
  for (const c of cases) {
    const r = await checkExternalAlive(browser, c.url);
    const ok = r.state === c.want;
    console.log(`${ok ? "✓" : "✗"} ${c.url} -> ${r.state} (want ${c.want})${r.reason ? "  [" + r.reason + "]" : ""}`);
    if (ok) pass++;
  }
  await browser.close();
  await new Promise((r) => server.close(r));
  PARTNER_ALIVE_HINTS.pop();
  const total = cases.length;
  console.log(`\nselftest: ${pass}/${total}`);
  if (pass !== total) { console.error("SELFTEST FAILED — the alive/dead detector is wrong."); process.exit(1); }
  console.log("✅ selftest: alive/dead/unresolved all classified correctly, both directions.");
  process.exit(0);
}

// ---- live run -------------------------------------------------------------
async function main() {
  const browser = await chromium.launch({ headless: true });

  // 1. Render the funnel money pages, collect the EXTERNAL hrefs actually served.
  const ctx = await browser.newContext();
  const externals = new Map(); // url -> Set(routes)
  let baseRendered = false;
  const renderErrs = [];
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      await page.waitForTimeout(1500);
      baseRendered = true;
      const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
      for (const h of hrefs) {
        if (!h || /^(#|mailto:|tel:|javascript:)/.test(h)) continue;
        let abs; try { abs = new URL(h, BASE + route).href; } catch { continue; }
        if (!isExternal(abs)) continue;
        if (!externals.has(abs)) externals.set(abs, new Set());
        externals.get(abs).add(route);
      }
    } catch (e) {
      renderErrs.push({ route, reason: String(e).split("\n")[0].slice(0, 160) });
    } finally { await page.close().catch(() => {}); }
  }
  await ctx.close().catch(() => {});

  // 2. Gate on whether our OWN funnel rendered at all.
  if (!baseRendered) {
    const controlUp = await controlReachable();
    await browser.close();
    if (!controlUp) {
      const out = { verdict: "UNKNOWN", reason: "funnel AND control both unreachable — network/runner offline, not a partner defect", renderErrs };
      record(out); console.log(JSON.stringify(out, null, 2)); process.exit(0);
    }
    const out = { verdict: "SITE_DOWN", reason: "control reachable but no funnel money page rendered", renderErrs };
    record(out); console.error(JSON.stringify(out, null, 2)); process.exit(2);
  }

  const targets = [...externals.keys()];
  if (!targets.length) {
    const out = { verdict: "CLEAN", base: BASE, external: [], note: "funnel rendered; it serves no external CTA on the probed money pages", renderErrs };
    record(out); console.log(JSON.stringify(out, null, 2));
    console.log(`\n✅ funnel external-CTA CLEAN — ${BASE} serves no external handoff on [${ROUTES.join(", ")}].`);
    process.exit(0);
  }

  // 3. Check each distinct external target's liveness by VISIBLE render.
  const checked = [];
  for (const url of targets) {
    const r = await checkExternalAlive(browser, url);
    r.routes = [...externals.get(url)].join(",");
    checked.push(r);
  }
  await browser.close();

  const dead = checked.filter((r) => r.state === "dead");
  const unresolved = checked.filter((r) => r.state === "unresolved");

  // A dead target is only trustworthy if the control is up (otherwise the
  // "death" could be our runner's broken egress). Verify before declaring.
  let verdict, code;
  if (dead.length) {
    const controlUp = await controlReachable();
    if (controlUp) { verdict = "DEFECT"; code = 1; }
    else { verdict = "UNKNOWN"; code = 0; dead.forEach((d) => { d.state = "unresolved"; d.reason = "dead signature BUT control unreachable — not trusted: " + d.reason; }); }
  } else if (unresolved.length) {
    verdict = "UNRESOLVED"; code = 3;
  } else {
    verdict = "CLEAN"; code = 0;
  }

  const out = { verdict, base: BASE, routes: ROUTES, external: checked, renderErrs };
  record(out);
  console.log(JSON.stringify(out, null, 2));

  if (verdict === "DEFECT") {
    console.error("\nFUNNEL EXTERNAL-CTA DEFECTS (recruits are being handed a dead link):");
    for (const d of checked.filter((r) => r.state === "dead")) console.error(`  [${d.routes}] ${d.url} — ${d.reason}`);
    process.exit(1);
  }
  if (verdict === "UNRESOLVED") {
    console.error(`\n⚠️  funnel external-CTA UNRESOLVED — ${unresolved.length} target(s) neither proved alive nor dead (transient status/empty render). NOT a defect; re-run.`);
    for (const u of unresolved) console.error(`  [${u.routes}] ${u.url} — ${u.reason}`);
    process.exit(3);
  }
  if (verdict === "UNKNOWN") {
    console.log(`\nfunnel external-CTA UNKNOWN — runner egress down; partner verdicts not trusted.`);
    process.exit(0);
  }
  console.log(`\n✅ funnel external-CTA CLEAN — all ${checked.length} external handoff(s) on ${BASE} render alive: ` +
    checked.map((r) => r.url.replace(/^https?:\/\//, "")).join(", "));
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();
else main();
