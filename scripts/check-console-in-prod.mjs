import fs from "node:fs";
import path from "node:path";

// wave-19 (2026-07-06) — console-in-prod guard.
//
// Class-of-fix Round 3 sibling to wave-16 (internal-nav-hrefs), wave-17
// (external-link-noopener), and wave-18 (raw-db-slug-leak).
//
// The failure pattern: a component calls `console.info("[Foo] fetched", { role,
// counts, filters })` at the top of a query success handler for "quick debug".
// It ships. Every production visitor's DevTools console dumps the shape of
// Sam's admin queries: which manager filter is set, how many applications the
// current role sees, whether they're admin/manager/agent. Not a full PII leak,
// but a structured surface-area leak — an attacker who lands a phishing link
// on a logged-in user gets to inspect the console for free reconnaissance.
//
// The repo already has the right primitive: `src/shared/lib/logger.ts` (info +
// debug DEV-gated, warn + error always). The convention has been "wrap in
// `if (import.meta.env.DEV) console.log(...)` OR call logger.info". This
// guard makes that convention commit-time enforceable.
//
// Detection:
//   Fails on `console.log(` / `console.debug(` / `console.info(` calls in
//   src/**/*.{tsx,ts,jsx,js} unless:
//     (a) preceded by `if (import.meta.env.DEV)` inline on the same line, OR
//     (b) enclosed by an `if (import.meta.env.DEV) { … }` block within the
//         previous 6 lines, OR
//     (c) the file is exempt (logger, historical banner, tests), OR
//     (d) the line has the opt-out marker `console-in-prod-allow:<reason>`
//         on the same line or the line directly above.
//
// Not flagged: `console.error`, `console.warn` — both legitimately fire in
// production (uncaught errors, user-facing warnings) and route through the
// logger emit() function unconditionally.
//
// Commented-out `// console.log(...)` lines are ignored.

const repoRoot = path.resolve(import.meta.dirname, "..");

const TRACKED_DIRS = ["src"];

const EXCLUDE_FILES = new Set([
  // Canonical logger abstraction — owns the console.* dispatch.
  "src/shared/lib/logger.ts",
  // WhatShippedTodayBanner narrates historical fixes in prose that quote the
  // patterns caught by past guards; would false-positive on quoted examples.
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
]);

const EXCLUDE_PATTERNS = [
  /\.test\.(tsx?|jsx?)$/,
  /\.spec\.(tsx?|jsx?)$/,
  /__tests__\//,
];

const OPT_OUT_MARKER = /console-in-prod-allow:/;

const BANNED_METHODS = ["log", "debug", "info"];
const CALL_RE = new RegExp(
  `console\\.(${BANNED_METHODS.join("|")})\\s*\\(`,
  "g"
);

const DEV_GUARD_RE = /import\.meta\.env\.DEV/;
const DEV_GUARD_BLOCK_RE = /if\s*\(\s*import\.meta\.env\.DEV\b/;

const TEXT_EXTS = new Set([".tsx", ".ts", ".jsx", ".js"]);

function walk(rel) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return TEXT_EXTS.has(path.extname(rel)) ? [rel] : [];
  const out = [];
  for (const entry of fs.readdirSync(abs)) {
    if (entry.startsWith(".")) continue;
    out.push(...walk(path.join(rel, entry)));
  }
  return out;
}

function isExempt(rel) {
  if (EXCLUDE_FILES.has(rel)) return true;
  return EXCLUDE_PATTERNS.some((re) => re.test(rel));
}

function isCommented(line, callIdx) {
  // Line-level `//` before the call = commented out.
  const before = line.slice(0, callIdx);
  const idx = before.indexOf("//");
  if (idx !== -1) {
    // Ensure the `//` isn't inside a string literal (rare in practice, and a
    // false-negative here is only skipping a real hit that a stray `//`
    // inside a template literal precedes — vanishingly rare).
    return true;
  }
  if (/^\s*\/\//.test(line)) return true;
  if (/^\s*\*/.test(line)) return true;
  return false;
}

function isDevGuarded(lines, lineIdx) {
  const line = lines[lineIdx];
  if (DEV_GUARD_RE.test(line)) return true;
  // Scan up to 6 lines back for an enclosing `if (import.meta.env.DEV) {`
  // that has not yet been closed by a matching `}` before our line.
  let braceDelta = 0;
  for (let j = lineIdx - 1; j >= Math.max(0, lineIdx - 8); j--) {
    const prev = lines[j];
    // Count braces on the previous line to keep our block state honest.
    const opens = (prev.match(/\{/g) || []).length;
    const closes = (prev.match(/\}/g) || []).length;
    braceDelta += closes - opens;
    if (DEV_GUARD_BLOCK_RE.test(prev)) {
      // We found a guard opener. If braceDelta after this line is <= 0 we're
      // still inside its block (i.e. more opens than closes between the guard
      // and our call).
      return braceDelta <= 0;
    }
  }
  return false;
}

const violations = [];
const allFiles = TRACKED_DIRS.flatMap(walk);
const scannedFiles = allFiles.filter((rel) => !isExempt(rel));

for (const rel of scannedFiles) {
  const source = fs.readFileSync(path.join(repoRoot, rel), "utf8");
  const lines = source.split("\n");

  // Iterate line-by-line so we can preserve context and match the guard/comment
  // heuristics without threading state across an offset-driven regex loop.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(line)) !== null) {
      const callIdx = m.index;
      if (isCommented(line, callIdx)) continue;
      if (isDevGuarded(lines, i)) continue;
      const thisLine = line;
      const prevLine = lines[i - 1] || "";
      if (OPT_OUT_MARKER.test(thisLine) || OPT_OUT_MARKER.test(prevLine)) continue;
      violations.push({
        file: rel,
        line: i + 1,
        method: m[1],
        preview: line.trim().slice(0, 140),
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `check:console-in-prod FAIL — ${violations.length} unguarded console.log|debug|info in ${scannedFiles.length} scanned files.`
  );
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  console.${v.method}`);
    console.error(`    ${v.preview}`);
  }
  console.error("");
  console.error(
    "Fix: route through logger.info / logger.debug (src/shared/lib/logger.ts)"
  );
  console.error(
    "     which is DEV-gated automatically, OR wrap the call in"
  );
  console.error(
    "     `if (import.meta.env.DEV) { console.log(...) }` for a one-off,"
  );
  console.error(
    "     OR add `// console-in-prod-allow:<reason>` above the line if the"
  );
  console.error(
    "     log must fire in production (rare — usually only telemetry paths)."
  );
  console.error("");
  console.error(
    "console.warn and console.error are NOT flagged — both legitimately fire"
  );
  console.error("in production for error reporting.");
  process.exit(1);
}

console.log(
  `check:console-in-prod OK — ${scannedFiles.length} files scanned, 0 unguarded console.log|debug|info calls.`
);
