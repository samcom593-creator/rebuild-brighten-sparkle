import fs from "node:fs";
import path from "node:path";

// wave-17 (2026-07-05) — target=_blank + window.open("_blank") noopener/noreferrer guard.
//
// Class-of-fix companion to wave-16's check-internal-nav-hrefs. That guard closed
// the SPA-internal reload-trap window forever; this guard closes the reverse-
// tabnabbing + Referer-leak window forever.
//
// Reverse tabnabbing:
//   <a href="https://malicious.example" target="_blank">Attackers can</a>
// gives the destination page `window.opener` — a live handle back to Sam's site.
// From there, `opener.location = "https://phish.example/apex-login"` silently
// swaps the parent tab's URL to a lookalike phishing page. The user sees the
// site they were originally on in the tab bar, sees the URL change (or not, if
// the phishing site fakes it well enough), and if they're re-prompted to log in
// they hand credentials to an attacker. `rel="noopener"` severs opener; adding
// `noreferrer` also strips the Referer header so the destination doesn't learn
// which admin/dashboard URL routed the click. Modern browsers implicitly apply
// noopener when `rel="noreferrer"` is present, but not every UA follows that,
// and being explicit is the industry norm (React docs, MDN, OWASP).
//
// The other half of the disease class:
//   window.open(url, "_blank")            // no features string → opener live
//   window.open(url, "_blank", "menubar")  // features string without noopener
// Same tabnabbing exposure. Fix: `window.open(url, "_blank", "noopener,noreferrer")`.
//
// This guard walks src/**/*.{tsx,ts,jsx,js,html} + index.html, parses every
// <a … target="_blank" …> tag (single- and multi-line JSX) and every
// window.open() call, and fails when either lacks the noopener/noreferrer
// disclaimer. Findings caught by hand at write time on 2026-07-05:
//   <a> without noopener:
//     - src/components/agent/MyReferralLinkCard.tsx:152 (rel="noreferrer" alone)
//     - src/pages/OnboardingCourse.tsx:232 (rel="noreferrer" alone)
//     - src/pages/ReadyModeIntegration.tsx:608 (rel="noreferrer" alone)
//     - src/pages/admin/ContentCommand.tsx:633 (rel="noreferrer" alone)
//   window.open without noopener:
//     - src/components/callcenter/CallCenterLeadCard.tsx:569
//     - src/components/dashboard/InterviewScheduler.tsx:225
//     - src/pages/AwardGraphics.tsx:96
//     - src/pages/CalendarPage.tsx:387 + 755
//     - src/pages/DashboardApplicants.tsx:597
//     - src/pages/RecruiterDashboard.tsx:674
// All 11 fixed in the same wave-17 commit; the guard prevents the next one.
//
// Opt-out marker per line: `external-link-noopener-allow:<reason>` on the
// same line or the line directly above the hit. Legitimate cases:
//   - Sandbox/test fixtures asserting the pattern itself.
//   - Vercel deploy-preview iframes where opener access is required.

const repoRoot = path.resolve(import.meta.dirname, "..");

const TRACKED_DIRS = ["src", "index.html"];

const EXCLUDE_FILES = new Set([
  // WhatShippedTodayBanner narrates historical fixes in prose that may quote
  // the pattern itself. Excluded so the shipped log stays readable without
  // breaking the guard.
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
  // The SHIPPED[] payload was split out of WhatShippedTodayBanner.tsx on
  // 2026-07-25 so the 722 KB history no longer ships on every dashboard.
  // Same prose-quotes-the-pattern exclusion reason.
  "src/data/shipped-data.ts",
  // The guard's own doc comments quote the pattern.
  "scripts/check-external-link-noopener.mjs",
]);

const OPT_OUT_MARKER = /external-link-noopener-allow:/;

function walk(rel) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [rel];
  const out = [];
  for (const entry of fs.readdirSync(abs)) {
    out.push(...walk(path.join(rel, entry)));
  }
  return out;
}

const files = TRACKED_DIRS
  .flatMap(walk)
  .filter((p) => /\.(tsx?|jsx?|html)$/.test(p))
  .filter((p) => !/\.(test|spec)\.(tsx?|jsx?)$/.test(p))
  .filter((p) => !EXCLUDE_FILES.has(p));

const violations = [];

// Parse every `<a … target="_blank" …>` opening tag (may span multiple lines).
// Uses a state machine over the file's raw text to avoid regex fragility across
// JSX line breaks + interpolations.
function scanAnchorTags(rel, src) {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\n") lineStarts.push(i + 1);
  }
  const lineOf = (idx) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const openTagRe = /<a(\s[^>]*)?>/gs;
  let m;
  while ((m = openTagRe.exec(src)) !== null) {
    const tag = m[0];
    if (!/target\s*=\s*["'`{]?\s*["'`]?_blank/.test(tag)) continue;

    const lineNum = lineOf(m.index);
    const lineText = src.slice(lineStarts[lineNum - 1], lineStarts[lineNum] ?? src.length);
    const prevLineText = lineNum > 1
      ? src.slice(lineStarts[lineNum - 2], lineStarts[lineNum - 1])
      : "";
    if (OPT_OUT_MARKER.test(lineText) || OPT_OUT_MARKER.test(prevLineText)) continue;

    // Extract rel="…" value (single-line only; JSX rel={foo} is uncheckable — flag).
    const relStaticMatch = tag.match(/\brel\s*=\s*["'`]([^"'`]*)["'`]/);
    const relDynamicMatch = /\brel\s*=\s*\{/.test(tag);
    if (relDynamicMatch) {
      violations.push(
        `${rel}:${lineNum}: <a target="_blank" rel={dynamic}> — dynamic rel expressions can silently drop noopener/noreferrer; hard-code rel="noopener noreferrer" or add \`external-link-noopener-allow:<reason>\` if the dynamic value is provably safe.`,
      );
      continue;
    }
    const relValue = relStaticMatch ? relStaticMatch[1] : "";
    const hasNoopener = /\bnoopener\b/.test(relValue);
    const hasNoreferrer = /\bnoreferrer\b/.test(relValue);
    if (!hasNoopener || !hasNoreferrer) {
      violations.push(
        `${rel}:${lineNum}: <a target="_blank"> rel="${relValue}" — missing ${!hasNoopener ? "noopener" : ""}${!hasNoopener && !hasNoreferrer ? "+" : ""}${!hasNoreferrer ? "noreferrer" : ""}. Reverse-tabnabbing + Referer-leak class. Fix: rel="noopener noreferrer".`,
      );
    }
  }
}

// Parse every `window.open(...)` call. Only flag when target arg is "_blank"
// (or absent, which browsers treat as _blank in most cases) AND the features
// arg either doesn't exist or doesn't carry noopener.
function scanWindowOpen(rel, src) {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\n") lineStarts.push(i + 1);
  }
  const lineOf = (idx) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const callRe = /\bwindow\.open\s*\(/g;
  let m;
  while ((m = callRe.exec(src)) !== null) {
    // Walk from '(' to matching ')' respecting nested parens + strings/backticks.
    let i = m.index + m[0].length - 1; // position of '('
    let depth = 1;
    let end = -1;
    let inStr = null; // '"', "'", "`"
    let esc = false;
    for (let k = i + 1; k < src.length; k++) {
      const c = src[k];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (c === "\\") { esc = true; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) { end = k; break; } }
    }
    if (end < 0) continue;
    const argsSrc = src.slice(i + 1, end);

    // Split args at top-level commas.
    const args = [];
    let cur = "";
    let d = 0, s = null, e = false;
    for (const c of argsSrc) {
      if (e) { cur += c; e = false; continue; }
      if (s) {
        cur += c;
        if (c === "\\") { e = true; continue; }
        if (c === s) s = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { s = c; cur += c; continue; }
      if (c === "(" || c === "[" || c === "{") { d++; cur += c; continue; }
      if (c === ")" || c === "]" || c === "}") { d--; cur += c; continue; }
      if (c === "," && d === 0) { args.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    if (cur.trim()) args.push(cur.trim());

    const target = args[1] ?? "";
    const features = args[2] ?? "";
    // Non-_blank target (e.g. "_self", "_top", named window) is out of scope.
    if (target && !/["'`]_blank["'`]/.test(target) && !/^undefined$/.test(target)) continue;
    // Missing target defaults to _blank behavior only in some browsers; still flag.

    const lineNum = lineOf(m.index);
    const lineText = src.slice(lineStarts[lineNum - 1], lineStarts[lineNum] ?? src.length);
    const prevLineText = lineNum > 1
      ? src.slice(lineStarts[lineNum - 2], lineStarts[lineNum - 1])
      : "";
    if (OPT_OUT_MARKER.test(lineText) || OPT_OUT_MARKER.test(prevLineText)) continue;

    if (!/noopener/.test(features)) {
      violations.push(
        `${rel}:${lineNum}: window.open(…, "_blank"${features ? ", " + features : ""}) — missing "noopener,noreferrer" features arg. Fix: window.open(url, "_blank", "noopener,noreferrer").`,
      );
    }
  }
}

for (const rel of files) {
  const abs = path.join(repoRoot, rel);
  const src = fs.readFileSync(abs, "utf8");
  scanAnchorTags(rel, src);
  scanWindowOpen(rel, src);
}

if (violations.length > 0) {
  console.error(
    "check:external-link-noopener — reverse-tabnabbing / Referer-leak risk:",
  );
  for (const v of violations) console.error("  " + v);
  console.error("");
  console.error(
    "Why this exists: any `<a target=\"_blank\">` or `window.open(url, \"_blank\")`",
  );
  console.error(
    "without `rel=\"noopener noreferrer\"` (or the `noopener,noreferrer` features",
  );
  console.error(
    "arg) hands the destination page a live `window.opener` handle back to Sam's",
  );
  console.error(
    "site. An attacker on the far end can `opener.location = phishing-url` to",
  );
  console.error(
    "swap the parent tab under the user. Referer header also leaks the exact",
  );
  console.error(
    "admin/dashboard URL that routed the click. React docs / MDN / OWASP all",
  );
  console.error(
    "flag this as the industry-standard fix — `rel=\"noopener noreferrer\"`.",
  );
  console.error("");
  console.error(
    "Opt-out marker for legitimate cases: `external-link-noopener-allow:<reason>`",
  );
  console.error("same line or line directly above.");
  process.exit(1);
}

console.log(
  `check:external-link-noopener OK — ${files.length} files scanned, 0 tabnabbing traps.`,
);
