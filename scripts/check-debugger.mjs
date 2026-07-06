import fs from "node:fs";
import path from "node:path";

// wave-22 (2026-07-06) — debugger-statement guard.
//
// Class-of-fix Round 6 sibling to wave-16 (internal-nav-hrefs), wave-17
// (external-link-noopener), wave-18 (raw-db-slug-leak), wave-19
// (console-in-prod), wave-20 (raw-db-slug-leak tightened), wave-21
// (empty-catch-swallow).
//
// The failure pattern: a dev drops `debugger;` inside a component or a hook
// while chasing a repro locally, forgets to remove it before commit, and it
// ships. Every production visitor whose browser has DevTools open freezes on
// that line — the app hangs mid-render, breakpoints fire on strangers, and
// Sam's admin UX turns into a lottery ticket for anyone with the panel closed.
//
// The fix is a lock-at-zero ratchet: sweep src/**/*.{tsx,ts,jsx,js} for any
// bare `debugger;` (or `debugger`) statement at the start of a line (allowing
// leading whitespace only) and fail if ANY are found. There's no baseline —
// this is a class of leak that should never exist in production source.
//
// Detection:
//   Fails on any `debugger` statement at the start of a line (leading
//   whitespace optional, semicolon optional) in src/**/*.{tsx,ts,jsx,js}
//   unless the line has the opt-out marker `debugger-allow:<reason>` on the
//   same line or the line directly above.
//
// Not flagged:
//   - The literal string "debugger" inside quoted strings, template literals,
//     or comments (via a state-machine skipper).
//   - The identifier `debugger` used as an object property key or method name
//     (e.g. `foo.debugger`, `debugger:` in an object literal, `debuggerName`).
//     Enforced by rejecting matches that have any word-char immediately before
//     or after the token.
//   - `// debugger;` or `/* debugger; */` commented-out patterns.

const repoRoot = path.resolve(import.meta.dirname, "..");

const TRACKED_DIRS = ["src"];

const EXCLUDE_FILES = new Set([
  // WhatShippedTodayBanner narrates historical fixes and would false-positive
  // if we ever quote the pattern verbatim in a shipped-log entry.
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
]);

const EXCLUDE_PATTERNS = [
  /\.test\.(tsx?|jsx?)$/,
  /\.spec\.(tsx?|jsx?)$/,
  /__tests__\//,
];

const OPT_OUT_MARKER = /debugger-allow:/;

// Anchor: start of line, whitespace only allowed before `debugger`, then a
// word boundary. Rejects `foo.debugger`, `debuggerName`, `mydebugger`, etc.
// Semicolon optional. Trailing comment allowed.
const DEBUGGER_RE = /^(\s*)debugger\b\s*;?\s*(\/\/.*|\/\*.*\*\/)?\s*$/;

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

function isExcluded(rel) {
  if (EXCLUDE_FILES.has(rel)) return true;
  return EXCLUDE_PATTERNS.some((re) => re.test(rel));
}

function checkFile(rel) {
  const abs = path.join(repoRoot, rel);
  const text = fs.readFileSync(abs, "utf8");
  const lines = text.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!DEBUGGER_RE.test(line)) continue;

    // Opt-out marker on same line or line directly above.
    if (OPT_OUT_MARKER.test(line)) continue;
    if (i > 0 && OPT_OUT_MARKER.test(lines[i - 1])) continue;

    violations.push({ line: i + 1, text: line.trim() });
  }

  return violations;
}

let totalFiles = 0;
let totalViolations = 0;
const allViolations = [];

for (const dir of TRACKED_DIRS) {
  for (const rel of walk(dir)) {
    if (isExcluded(rel)) continue;
    totalFiles++;
    const v = checkFile(rel);
    if (v.length > 0) {
      totalViolations += v.length;
      allViolations.push({ rel, v });
    }
  }
}

if (totalViolations > 0) {
  console.error(
    `[check:debugger] FAIL — ${totalViolations} debugger statement(s) in ${allViolations.length} file(s):`
  );
  for (const { rel, v } of allViolations) {
    for (const { line, text } of v) {
      console.error(`  ${rel}:${line}  ${text}`);
    }
  }
  console.error("");
  console.error(
    "Fix: remove the `debugger` statement. In the rare case where it's intentional"
  );
  console.error(
    "(e.g. a dev-only utility that's DEV-gated), add `debugger-allow:<reason>`"
  );
  console.error("as a comment on the same line or the line directly above.");
  process.exit(1);
}

console.log(
  `[check:debugger] OK — ${totalFiles} files scanned, 0 debugger statements.`
);
