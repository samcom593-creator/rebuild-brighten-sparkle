#!/usr/bin/env node
/**
 * check:page-header-compact — keeps the operating-route header band compact.
 *
 * PageHeader renders on 30+ routes, so its height is the single most leveraged
 * spacing number in the product. v5 (2026-08-11) measured it in headless
 * chromium and brought it from 140px -> 88px on desktop and 196px -> 133px on a
 * 390px phone.
 *
 * Two separate things can silently undo that, and one of them already did once:
 *
 *   1. The component's own padding/type creeping back up.
 *   2. A global `!important` rule in index.css. The mobile block at
 *      `@media (max-width: 640px)` used to force
 *      `.apex-page-header h1 { font-size: clamp(1.5rem, 9vw, 2.15rem) !important }`
 *      — 34.4px at 390px — which beat the component's own text-xl. The
 *      compaction was live and correct on desktop while the phone, the device
 *      Sam actually runs the business on, saw almost no change at all. A guard
 *      that only reads the .tsx would have reported success.
 *
 * This is a static check on purpose: a real layout measurement needs a browser
 * and a dev server, which is too slow for pre-commit. It asserts the specific
 * regressions that have actually happened, not a pixel value it cannot see.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const violations = [];

const HEADER = "src/components/ui/page-header.tsx";
const CSS = "src/index.css";

// Comments must be blanked before matching or this guard reports its own
// docstring — the v5 comment explains that the scan rail was removed, and a raw
// substring search reads that explanation as the rail being present. Blanking
// rather than deleting preserves byte offsets.
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? " ".repeat(line.length) : line))
    .join("\n");
}

const headerSrc = stripComments(
  fs.readFileSync(path.join(repoRoot, HEADER), "utf8"),
);

// 1. No ornamental looping animation on a band that renders on every route.
if (headerSrc.includes("apex-header-scan")) {
  violations.push(
    `${HEADER}: the apex-header-scan rail is back. It is a 3.8s infinite animation on every operating route, purely decorative. Being reduced-motion-safe does not make it earn the space.`,
  );
}

// 2. Vertical padding must stay at the compacted step.
const padMatch = headerSrc.match(/apex-page-header[^"]*?\bpy-([\d.]+)\b/);
if (!padMatch) {
  violations.push(
    `${HEADER}: could not find the header's \`py-*\` class — update scripts/check-page-header-compact.mjs rather than letting this guard silently pass.`,
  );
} else if (Number(padMatch[1]) > 3.5) {
  violations.push(
    `${HEADER}: header padding is py-${padMatch[1]}, above the compacted py-3.5. v4's py-5 cost 52px of first screen on every route.`,
  );
}

// 3. Title must not go back to a display size.
const titleMatch = headerSrc.match(/<h1 className="([^"]+)"/);
if (!titleMatch) {
  violations.push(
    `${HEADER}: could not find the <h1> class list — update scripts/check-page-header-compact.mjs.`,
  );
} else if (/\btext-(3xl|4xl|5xl)\b/.test(titleMatch[1])) {
  violations.push(
    `${HEADER}: the title is back to a display size (${titleMatch[1]}). v5 uses text-xl / sm:text-2xl.`,
  );
}

// 4. The mobile !important override must stay scoped and small. This is the one
//    that actually shipped a half-working fix.
const cssSrc = fs.readFileSync(path.join(repoRoot, CSS), "utf8");
const headerH1Rules = [
  ...cssSrc.matchAll(/\.apex-page-header h1[^{]*\{([^}]*)\}/g),
];
if (headerH1Rules.length === 0) {
  violations.push(
    `${CSS}: no \`.apex-page-header h1\` rule found. v5 relies on one to beat the global mobile h1 clamp on specificity — if it is gone, phones fall back to clamp(1.5rem, 9vw, 2.15rem) and the header re-inflates to ~182px.`,
  );
}
for (const rule of headerH1Rules) {
  const vw = rule[1].match(/clamp\([^,]+,\s*([\d.]+)vw/);
  if (vw && Number(vw[1]) > 6) {
    violations.push(
      `${CSS}: \`.apex-page-header h1\` uses ${vw[1]}vw. At a 390px viewport that is ${Math.round(390 * (Number(vw[1]) / 100) * 10) / 10}px of title. v5 caps this at 5.5vw (21.45px) — above 6vw the phone header re-inflates.`,
    );
  }
}

// A bare `h1` rule must not also name .apex-page-header *when it sets font-size*.
// index.css:1915 legitimately groups those selectors to zero out letter-spacing;
// only a shared font-size re-creates the bug, because that is what the component
// is trying to control.
for (const m of cssSrc.matchAll(
  /\.apex-page-header h1,\s*\n?\s*h1,[^{]*\{([^}]*)\}/g,
)) {
  if (/font-size/.test(m[1])) {
    violations.push(
      `${CSS}: \`.apex-page-header h1\` is grouped with the global \`h1\` selector in a rule that sets font-size. That is exactly the rule that forced 34.4px titles on phones and made the v5 compaction desktop-only. Give the header its own rule.`,
    );
  }
}

if (violations.length) {
  console.error(
    `\n✗ check:page-header-compact — ${violations.length} regression(s) in the shared header band.\n`,
  );
  for (const v of violations) console.error(`  ${v}`);
  console.error("");
  process.exit(1);
}

console.log(
  `✓ check:page-header-compact — header band compact (py<=3.5, no display title, no scan rail, ${headerH1Rules.length} scoped mobile h1 rule(s)).`,
);
