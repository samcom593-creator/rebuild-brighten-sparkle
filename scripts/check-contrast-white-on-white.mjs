import fs from "node:fs";
import path from "node:path";

// website-integrity-bot — contrast-white-on-white ratchet.
//
// Class-of-fix. Same shape as the other commit-time ratchets
// (check-empty-catch, check-stale-key-in-list, check-tsc-error-count):
// a baseline-count gate with an opt-out marker + reason.
//
// THE FAILURE PATTERN (the light/dark migration footgun):
//   <div className="min-h-screen bg-white dark:bg-card text-white">
//     <h1 className="text-5xl font-extrabold">Galaxy Storefront</h1>   // inherits text-white
//   ...
//   The 2026 light/dark wave gave hundreds of elements a
//   `bg-white dark:bg-<dark>` background so the page is white in light mode
//   and dark in dark mode. But a base `text-white` (NO dark: prefix) applies
//   in BOTH modes. So in LIGHT mode the element is white text on a white
//   background — invisible. The default theme ships dark (index.html
//   class="dark"), so this hides until a user toggles light (ThemeToggle /
//   TopBar write `light` onto <html> and persist it to localStorage —
//   src/hooks/useTheme.ts), then every inheriting heading / label / CTA on
//   that element vanishes. On a direct-cash page (/storefront, /leads,
//   /contact) that is a blank headline or an invisible "Subscribe" / "Apply
//   Now" button on the exact surface that asks for money.
//
//   This is the same class as the 465 fake-success InsuraCloud rows
//   (memory: project_apex_2026_05_18_insuracloud_auth_dead): the surface
//   LOOKS fine in the mode the author tested (dark) while a supported mode
//   silently breaks — a status check / a dark-default render check both stay
//   green while the light-mode user sees nothing.
//
// DETECTION:
//   Fails on any className string in src/**/*.{tsx,jsx} that contains BOTH a
//   standalone `bg-white` token AND a standalone `text-white` token, unless:
//     (a) the file is exempt (WhatShippedTodayBanner narrates history), OR
//     (b) the guard script itself, OR
//     (c) the offending line (or the line directly above) carries the opt-out
//         marker `contrast-allow:<reason>`.
//
//   "Standalone" means the EXACT whitespace-delimited class token `bg-white`
//   / `text-white`. Variant-prefixed tokens (`dark:bg-white`,
//   `hover:text-white`, `group-hover:bg-white`) and opacity-suffixed tokens
//   (`bg-white/10`, `text-white/70`) are DIFFERENT tokens and are NOT flagged
//   — a `dark:bg-white` only paints in dark mode, a `bg-white/10` is a
//   translucent overlay, neither is the opaque-white-on-opaque-white trap.
//
//   Tokens are read only from inside string / template-literal segments
//   (where className values live); `${…}` interpolations are dropped before
//   tokenizing so a dynamic class expression never fabricates a token.
//   Comment and code text outside strings is never tokenized, so prose that
//   mentions "bg-white text-white" does not false-positive.
//
// THE RIGHT FIX:
//   Use the theme-aware token `text-foreground` (near-black in light,
//   near-white in dark — src/index.css --foreground) instead of a hardcoded
//   `text-white` on an element whose background is light in light mode. That
//   is a no-op in the shipping dark default and legible in light mode. For a
//   genuinely always-dark element (e.g. white text over an opaque colored
//   `bg-emerald-500` / a gradient), the white text is correct and the
//   background is not `bg-white` — so it never trips this guard. If a site is
//   legitimately white-on-white-safe for some reason the tokenizer can't see,
//   annotate it with `contrast-allow:<why>`.
//
// Baseline pay-down: lower BASELINE by exactly the number of sites fixed /
// annotated each commit. NEVER raise it.
//
// Cost when fired: ~80-150ms (single-pass line scan over ~530 src files).

const repoRoot = path.resolve(import.meta.dirname, "..");

const TRACKED_DIRS = ["src"];

const EXCLUDE_FILES = new Set([
  // Narrates historical fixes; a shipped-log label that quotes the pattern
  // verbatim would false-positive, and a marker there would be misleading.
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
  // The guard itself (self-reference).
  "scripts/check-contrast-white-on-white.mjs",
]);

const EXCLUDE_PATTERNS = [
  /\.test\.(tsx?|jsx?)$/,
  /\.spec\.(tsx?|jsx?)$/,
  /__tests__\//,
];

const OPT_OUT_MARKER = /contrast-allow:([^\s*/}"'`]+)/;

const TEXT_EXTS = new Set([".tsx", ".jsx"]);

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

// Pull out the contents of every quoted string / template-literal segment on a
// line. className values live inside these; code and comments outside them are
// ignored. `${…}` interpolations are replaced with a space so a dynamic
// expression never contributes a token. Returns an array of plain-text class
// fragments.
function extractStringSegments(line) {
  const out = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      let buf = "";
      while (i < n && line[i] !== quote) {
        if (line[i] === "\\") {
          buf += " ";
          i += 2;
          continue;
        }
        if (quote === "`" && line[i] === "$" && line[i + 1] === "{") {
          // skip ${ ... } interpolation (brace-balanced within the line)
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (line[i] === "{") depth++;
            else if (line[i] === "}") depth--;
            i++;
          }
          buf += " ";
          continue;
        }
        buf += line[i];
        i++;
      }
      // i is at closing quote (or EOL for a multi-line template — fine)
      i++;
      out.push(buf);
    } else {
      i++;
    }
  }
  return out;
}

// A class fragment trips the guard iff its whitespace-delimited token set
// contains BOTH exactly `bg-white` and exactly `text-white`.
function fragmentHasWhiteOnWhite(fragment) {
  const tokens = fragment.split(/\s+/);
  let hasBg = false;
  let hasText = false;
  for (const t of tokens) {
    if (t === "bg-white") hasBg = true;
    else if (t === "text-white") hasText = true;
  }
  return hasBg && hasText;
}

function checkFile(rel) {
  const abs = path.join(repoRoot, rel);
  const text = fs.readFileSync(abs, "utf8");
  const lines = text.split("\n");
  const violations = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const lineText = lines[idx];
    const segments = extractStringSegments(lineText);
    if (!segments.some(fragmentHasWhiteOnWhite)) continue;

    const prevLineText = lines[idx - 1] ?? "";
    if (OPT_OUT_MARKER.test(lineText)) continue;
    if (OPT_OUT_MARKER.test(prevLineText)) continue;

    violations.push({ line: idx + 1, text: lineText.trim().slice(0, 140) });
  }
  return violations;
}

// ---------- selftest ----------
function selftest() {
  const cases = [
    ['className="bg-white dark:bg-card text-white"', true, "base bg-white + base text-white -> flag"],
    ['className="min-h-screen bg-white dark:bg-[#0A0A0A] px-4 text-white"', true, "bg-white + text-white with other utils -> flag"],
    ['className="bg-white dark:bg-card text-foreground"', false, "text-foreground is theme-aware -> ok"],
    ['className="bg-emerald-500 hover:bg-emerald-600 text-white"', false, "white on opaque colored bg -> ok"],
    ['className="dark:bg-white text-white"', false, "dark:bg-white only paints in dark -> ok"],
    ['className="bg-white dark:text-white"', false, "dark:text-white only paints in dark -> ok"],
    ['className="bg-white/10 text-white"', false, "translucent overlay bg-white/10 -> ok"],
    ['className="bg-white text-white/70"', false, "text-white/70 is a different token -> ok"],
    ['className="bg-gradient-to-r from-teal-500 to-teal-600 text-white"', false, "gradient bg + white text -> ok"],
    ['// prose mentioning bg-white and text-white together', false, "comment text is not a string segment -> ok"],
    ['const note = "use bg-white and text-white carefully";', true, "any string literal with both tokens -> flag (conservative; annotate if intentional)"],
    ['className={`bg-white ${x} text-white`}', true, "template literal static tokens -> flag"],
    ['className={`bg-white ${cond ? "text-white" : ""}`}', false, "text-white only inside dropped ${} -> ok (not static)"],
  ];
  let pass = 0;
  for (const [line, expectFlag, label] of cases) {
    const segs = extractStringSegments(line);
    const got = segs.some(fragmentHasWhiteOnWhite);
    const ok = got === expectFlag;
    console.log(`  ${ok ? "PASS" : "FAIL"} — ${label} (expected ${expectFlag}, got ${got})`);
    if (ok) pass++;
  }
  const allPass = pass === cases.length;
  console.log(`\n[check:contrast-white-on-white --selftest] ${pass}/${cases.length} ${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

if (process.argv.includes("--selftest")) selftest();

// ---------- live scan ----------
let totalFiles = 0;
const allViolations = [];

for (const dir of TRACKED_DIRS) {
  for (const rel of walk(dir)) {
    if (isExcluded(rel)) continue;
    totalFiles++;
    const v = checkFile(rel);
    if (v.length > 0) allViolations.push({ rel, v });
  }
}

const count = allViolations.reduce((n, f) => n + f.v.length, 0);

// Lower this number when fixes land. NEVER raise it.
// 2026-11-20 initial lock: 3 public money/conversion surfaces fixed this
// commit (Storefront, Contact x3, LeadsLanding x2 CTAs); the remainder are
// admin/dashboard chips, avatars, rank badges + orphaned-gradient admin
// buttons (AgentPortal, DashboardCommandCenter, XcelPipeline,
// RecruiterDashboard, AwardGraphics, TeamChat, Plaque,
// PerformanceDashboardSection, MyRankingChart, ContentLibrary) — real but
// lower-$ dark-default surfaces, paid down in later passes.
const BASELINE = 14;

if (count <= BASELINE) {
  const delta = BASELINE - count;
  if (delta > 0) {
    console.log(
      `[check:contrast-white-on-white] OK — ${totalFiles} files scanned, ${count} unmarked bg-white+text-white site(s) ` +
        `(${delta} below baseline ${BASELINE}). Lower BASELINE in scripts/check-contrast-white-on-white.mjs to ${count} in this commit.`,
    );
  } else {
    console.log(
      `[check:contrast-white-on-white] OK — ${totalFiles} files scanned, ${count} unmarked bg-white+text-white site(s) (== baseline ${BASELINE}).`,
    );
  }
  process.exit(0);
}

console.error(
  `[check:contrast-white-on-white] FAIL — ${count} unmarked bg-white+text-white site(s) found, baseline is ${BASELINE}. ` +
    `A new element with base \`bg-white\` + base \`text-white\` was added since the last baseline lock.`,
);
console.error("");
for (const { rel, v } of allViolations) {
  for (const { line, text } of v) {
    console.error(`  ${rel}:${line} ${text}`);
  }
}
console.error("");
console.error("An element with a base `bg-white` and a base `text-white` (neither");
console.error("variant-prefixed) is white text on a white background in LIGHT mode.");
console.error("The app ships dark by default (index.html class=\"dark\"), so this hides");
console.error("until a user toggles light (ThemeToggle / TopBar persist it to");
console.error("localStorage). On a public cash surface that is an invisible headline or");
console.error("an invisible CTA for every light-mode visitor.");
console.error("");
console.error("Fix by either:");
console.error("  1. Use `text-foreground` (theme-aware: dark-on-light, light-on-dark)");
console.error("     instead of a hardcoded `text-white`. No-op in the dark default,");
console.error("     legible in light mode.");
console.error("  2. If the element is genuinely always-dark (white text over an opaque");
console.error("     colored / gradient background — not bg-white), the background won't");
console.error("     be `bg-white` and this guard won't fire. If it legitimately must,");
console.error("     annotate with `contrast-allow:<short-reason>` on the line or above.");
console.error("");
console.error("Light-mode-only breakage is the same fake-success class as the 465");
console.error("InsuraCloud rows: green in the mode the author tested, broken in a");
console.error("supported mode nobody checked. No fake success.");
process.exit(1);
