#!/usr/bin/env node
// light-mode-contrast-probe.mjs — ON-DEMAND MEASUREMENT (not a CI gate).
//
// Renders a set of routes with localStorage apex:theme:v2=light set BEFORE
// load, then computes the WCAG 2.x contrast ratio of every visible text node
// against its effective solid background, and reports every node below AA
// (4.5:1 normal, 3:1 large). It exists because the source-token guard
// (check-contrast-white-on-white) is STRUCTURALLY BLIND to the real failures:
// they are CSS-variable / hardcoded-hex / inherited colors, not literal
// bg-white+text-white co-occurrence.
//
// WHY IT IS NOT A GATE:
//   Light mode is a deliberately-kept, known-broken ADMIN-only toggle. A probe
//   of the ADMIN surface in light would be permanently red (Sam "gave up on the
//   white"), and a permanently-red gate is one everybody learns to skip. The
//   actual invariant that matters — "the PUBLIC funnel/brand surface is never
//   rendered in the broken light theme" — is enforced structurally by the
//   index.html dark-pin and guarded by scripts/check-public-theme-pin.mjs.
//   This probe is the measurement that proved the pin works: run it against the
//   PUBLIC routes and every one should report htmlClass:"dark" and 0 failures.
//
// Baseline receipts (2026-11-20, BEFORE the pin, live prod, light forced):
//   / = 136 failures (invisible section headlines text-[#f1f5f9]@1.1 on white,
//   body text-white/65@1.0, the "Ready to run your agency" CTA@1.1).
//   AFTER the pin: / /apply /leads /contact all render htmlClass:"dark".
//
// Usage:
//   node scripts/light-mode-contrast-probe.mjs                 # live prod
//   BASE=http://localhost:4312 node scripts/light-mode-contrast-probe.mjs
//   ROUTES="/,/apply" node scripts/light-mode-contrast-probe.mjs
//
// Requires playwright (already a dep; chromium installed). Exits 0 always —
// it is a report, never a gate.

import { chromium } from "playwright";

const BASE = (process.env.BASE || "https://apex-financial.org").replace(/\/$/, "");
const ROUTES = (process.env.ROUTES || "/,/storefront,/contact,/leads").split(",").map((s) => s.trim()).filter(Boolean);
const STORAGE_KEY = "apex:theme:v2";

const EVAL = () => {
  function parseRGB(s) {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum({ r, g, b }) {
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function ratio(a, b) {
    const l1 = lum(a), l2 = lum(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function effBg(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return { gradient: true };
      const bg = parseRGB(cs.backgroundColor);
      if (bg && bg.a >= 0.95) return { color: bg };
      node = node.parentElement;
    }
    return { color: { r: 255, g: 255, b: 255 } };
  }
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = walker.nextNode())) {
    const txt = (n.textContent || "").trim();
    if (txt.length < 2) continue;
    const el = n.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.1) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const fg = parseRGB(cs.color);
    if (!fg || fg.a < 0.5) continue;
    const bg = effBg(el);
    if (bg.gradient) continue;
    const cr = ratio(fg, bg.color);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const threshold = large ? 3.0 : 4.5;
    if (cr < threshold) {
      const key = el.tagName + "|" + txt.slice(0, 40) + "|" + Math.round(cr * 10);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        tag: el.tagName.toLowerCase(),
        text: txt.slice(0, 60),
        color: cs.color,
        bg: `rgb(${bg.color.r},${bg.color.g},${bg.color.b})`,
        ratio: Math.round(cr * 100) / 100,
        need: threshold,
      });
    }
  }
  return out.sort((a, b) => a.ratio - b.ratio);
};

const browser = await chromium.launch();
const results = {};
for (const route of ROUTES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([k]) => { try { localStorage.setItem(k, "light"); } catch (e) {} }, [STORAGE_KEY]);
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + route, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(3000);
    const htmlClass = await page.evaluate(() => document.documentElement.className);
    const fails = await page.evaluate(EVAL);
    results[route] = { htmlClass, failures: fails.length, sample: fails.slice(0, 15) };
  } catch (e) {
    results[route] = { error: String(e).slice(0, 160) };
  }
  await ctx.close();
}
await browser.close();

console.log(`light-mode-contrast-probe @ ${BASE}`);
for (const [r, v] of Object.entries(results)) {
  if (v.error) { console.log(`  ${r}: ERROR ${v.error}`); continue; }
  const pinned = v.htmlClass === "dark";
  console.log(`  ${r}: htmlClass=${v.htmlClass} failures=${v.failures}${pinned ? " (dark-pinned ✓)" : " ⚠ rendered LIGHT"}`);
}
console.log(JSON.stringify(results, null, 2));
process.exit(0);
