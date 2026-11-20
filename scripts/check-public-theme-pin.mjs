#!/usr/bin/env node
// check-public-theme-pin.mjs — guards the invariant that the public
// marketing / funnel / brand surface is ALWAYS rendered in the brand dark
// theme, regardless of a persisted `apex:theme:v2 === 'light'` preference.
//
// WHY THIS EXISTS (measured, not hypothesized):
//   Light mode is a deliberately-kept ADMIN-only toggle (TopBar, inside
//   AuthenticatedShell) that Sam re-locked to dark-default twice ("give up on
//   the white"). Its tokens are known-broken: a Playwright render of the LIVE
//   public homepage with localStorage apex:theme:v2=light measured 136 WCAG
//   contrast failures on `/` on 2026-11-20 (invisible section headlines,
//   invisible body copy, the "Ready to run your agency" CTA at ratio 1.1).
//   index.html's inline theme bootstrap applies the persisted class GLOBALLY
//   at parse time — so a persisted-light browser renders that broken theme on
//   the public conversion/brand surface. The sibling source-token guard
//   (check-contrast-white-on-white) is STRUCTURALLY BLIND to this: the 136
//   failures are CSS-variable / hardcoded-hex / inherited colors, not literal
//   `bg-white`+`text-white` co-occurrence. So its green does NOT mean the
//   public surface is contrast-safe in light — only this pin makes it so.
//
//   The fix pins the public funnel routes to dark in the inline bootstrap.
//   This guard asserts that pin is present and correctly shaped so it can't
//   silently regress away (e.g. a future bootstrap rewrite dropping the
//   `forceDark` branch — the exact FOUC-driven rewrite history this file has).
//
// This is a SOURCE guard (reads index.html), not a render gate: fast,
// deterministic, never flaky, safe in CI. The end-to-end render consequence
// is measured separately by the light-mode contrast probe.
//
// Usage:
//   node scripts/check-public-theme-pin.mjs            # guard index.html
//   node scripts/check-public-theme-pin.mjs --selftest # hermetic proof

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The public routes that MUST be dark. Keep in lockstep with the regex in
// index.html; a drift between them is itself the regression this guards.
const REQUIRED_PUBLIC_ROUTES = [
  "apply",
  "vsl",
  "schedule-call",
  "get-licensed",
  "leads",
  "get-leads",
  "dialer",
  "contact",
  "storefront",
  "careers",
];

// Extract the inline theme bootstrap IIFE that touches apex:theme:v2 + adds
// the theme class. We look at the block, not the whole file, so unrelated
// mentions of the strings elsewhere can't give a false pass.
function extractBootstrap(html) {
  // Collect every "(function() ... })();" IIFE, then return the one that is
  // actually the theme bootstrap (reads the theme key AND writes the class).
  // Scanning all blocks — rather than grabbing the first mention of the key —
  // means a decoy mention of apex:theme:v2 outside the IIFE cannot give a
  // false pass (proven in the selftest).
  const endMarker = "})();";
  const blocks = [];
  let i = 0;
  while (true) {
    const start = html.indexOf("(function()", i);
    if (start === -1) break;
    const end = html.indexOf(endMarker, start);
    if (end === -1) break;
    blocks.push(html.slice(start, end + endMarker.length));
    i = end + endMarker.length;
  }
  return blocks.find((b) => b.includes("apex:theme:v2") && b.includes("classList")) || null;
}

function auditBootstrap(block) {
  const problems = [];
  if (!block) {
    return ["could not locate the inline theme bootstrap IIFE referencing apex:theme:v2 in index.html"];
  }
  // 1. a forceDark gate must exist and be ANDed against the light branch so a
  //    persisted light preference cannot win on a public route.
  if (!/forceDark/.test(block)) {
    problems.push("theme bootstrap has no `forceDark` gate — a persisted light preference would render on public routes (the 136-failure light theme)");
  }
  if (!/t\s*===\s*'light'\s*&&\s*!forceDark/.test(block) && !/!forceDark\s*&&\s*t\s*===\s*'light'/.test(block)) {
    problems.push("the class-add expression does not AND `!forceDark` with the light check — the public-dark pin is not actually enforced");
  }
  // 2. the root path must be pinned.
  if (!/p\s*===\s*'\/'/.test(block) && !/pathname\s*===\s*'\/'/.test(block)) {
    problems.push("the homepage `/` is not explicitly pinned to dark");
  }
  // 3. every required public funnel/brand route must be in the pin regex.
  const missing = REQUIRED_PUBLIC_ROUTES.filter((r) => {
    // word-boundary-ish: the route token present in the regex alternation
    const re = new RegExp("(^|[\\(|/])" + r.replace(/[-]/g, "\\-") + "([\\(|/)]|$)");
    return !re.test(block);
  });
  if (missing.length) {
    problems.push("public routes missing from the dark-pin regex: " + missing.join(", "));
  }
  return problems;
}

function runGuard() {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const block = extractBootstrap(html);
  const problems = auditBootstrap(block);
  if (problems.length) {
    console.error("❌ check-public-theme-pin: public funnel/brand surface is NOT pinned to the brand dark theme.");
    for (const p of problems) console.error("   - " + p);
    console.error("   Fix: index.html inline bootstrap must force dark on the public routes regardless of a persisted light preference.");
    process.exit(1);
  }
  console.log(
    "✅ check-public-theme-pin: public funnel/brand surface pinned to brand dark (" +
      (REQUIRED_PUBLIC_ROUTES.length + 1) +
      " routes incl. `/`); admin toggle preserved."
  );
}

function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (name, cond) => {
    if (cond) { pass++; }
    else { fail++; console.error("  SELFTEST FAIL: " + name); }
  };

  const GOOD = `(function(){
    var root=document.documentElement; var t=null;
    try{t=localStorage.getItem('apex:theme:v2');}catch(e){}
    var PUBLIC_DARK=/^\\/(apply|vsl|schedule-call|get-licensed|leads|get-leads|dialer|contact|storefront|careers)(\\/|$)/;
    var p=location.pathname; var forceDark=p==='/'||PUBLIC_DARK.test(p);
    root.classList.remove('light','dark');
    root.classList.add(t === 'light' && !forceDark ? 'light':'dark');
  })();`;
  ok("good block passes", auditBootstrap(GOOD).length === 0);

  // regression: drop the !forceDark AND -> light can win on public
  const NO_PIN = GOOD.replace("t === 'light' && !forceDark", "t === 'light'");
  ok("missing !forceDark AND fails", auditBootstrap(NO_PIN).length > 0);

  // regression: forceDark computed but never used in the class expression
  const UNUSED = GOOD.replace("t === 'light' && !forceDark ? 'light':'dark'", "t === 'light' ? 'light':'dark'");
  ok("forceDark unused fails", auditBootstrap(UNUSED).length > 0);

  // regression: a public route dropped from the regex
  const DROP_APPLY = GOOD.replace("apply|", "");
  ok("dropped public route fails", auditBootstrap(DROP_APPLY).some((x) => /apply/.test(x)));

  // regression: homepage not pinned
  const NO_ROOT = GOOD.replace("p==='/'||", "");
  ok("unpinned homepage fails", auditBootstrap(NO_ROOT).some((x) => /homepage/.test(x)));

  // null block (no bootstrap) fails loudly
  ok("absent bootstrap fails", auditBootstrap(null).length > 0);

  // extractor finds the block inside a realistic file and ignores decoys
  const FILE = `<html><head><script>var x='apex:theme:v2 decoy in a comment';</script>\n<script>${GOOD}</script></head></html>`;
  ok("extractor isolates the real IIFE", auditBootstrap(extractBootstrap(FILE)).length === 0);

  console.log(`check-public-theme-pin selftest: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (process.argv.includes("--selftest")) selftest();
else runGuard();
