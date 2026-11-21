#!/usr/bin/env node
// MP-WIB-COLD-JS-BUDGET (2026-11-21): post-build gz budget on the cold public
// critical-path JS — the sibling guard to check:landing-css-size, for the
// bytes a first-time prospect downloads before first paint on `/`.
//
// WHY THIS EXISTS. f488979f (MP-WIB-EAGER-CHROME-ICONS) found the full
// `vendor-icons` chunk (17.2 KB gz) riding the cold homepage on top of the
// intentional narrow `vendor-icons-landing` subset, and shaved the cold
// critical-path JS from 135.0 KB → 115.68 KB gz. That gain had NOTHING
// watching it: check:vendor-icons-landing-census audits one icon chunk's
// membership, and check:landing-css-size budgets only CSS. Nothing budgeted
// the total JS a cold visitor pulls. So the next eager import into App.tsx's
// pre-lazy graph (a new provider, boundary, global chrome component, or a
// vendor the entry pulls in non-lazily) can silently re-balloon the cold path
// and the perf win evaporates with a green CI. This guard is that watcher.
//
// WHAT "THE COLD CRITICAL PATH" IS (and why dist/index.html is the authority).
// Vite emits, into dist/index.html, the ENTRY `<script type="module">` plus a
// `<link rel="modulepreload">` for every chunk in App's EAGER static-import
// graph — everything imported before any route-lazy boundary. That list IS
// what the browser fetches+parses before it can paint `/`. Measuring the built
// dist (not the source graph) means the number is exactly what ships: chunk
// splits, tree-shaking and minification are already applied. See the memory
// note vendor-icons-eager-chrome-cold-path for the full method.
//
// WHY POST-BUILD, NOT PRE-COMMIT. This reads dist/, which only exists after
// `npm run build`. It is wired into verify:core immediately AFTER the build
// step (alongside check:brand-literals and the other dist consumers), NOT into
// .husky/pre-commit — a full build is minutes, pre-commit must stay fast. The
// CSS guard can live in pre-commit because it rebuilds just the narrow Tailwind
// emit in <1s; a JS budget cannot.
//
// WHY A gz MEASUREMENT IS NOT THE false-fail disease this repo warns about.
// Lighthouse timing is deliberately left advisory (see memory
// check8_lighthouse_wiring_and_speedguard / lighthouse_homepage_covers_spa)
// because wall-clock on a shared runner is noisy. gzip of content-hashed built
// chunks is NOT noisy — it is deterministic per build and only moves when code
// or deps move. So a tight-ish budget here has teeth without crying wolf.
//
// BUDGET. Baseline on f488979f = 118,458 B gz (115.68 KB), 8 chunks. Ceiling
// = 128 KB gz, i.e. ~9.6 KB / ~8.3% headroom. That is deliberately LESS than
// the 17.2 KB vendor-icons regression it must catch, so the guard cannot be
// satisfied while that exact leak is back; and it is enough slack that an
// ordinary entry-chunk feature add or a minor React/router bump does not
// false-fail. Growing the cold path past the ceiling must be a CONSCIOUS act:
// raise COLD_JS_CEILING_GZ in the same commit, with the new measured baseline
// in the message — exactly the escape hatch check:landing-css-size uses.
//
// ANTI-FAKE-SUCCESS. The classic failure of a "sum some files and compare"
// guard is a parse that finds nothing, sums to 0, and reports GREEN — the
// blank-reads-as-healthy disease this repo has paid for repeatedly. Guarded
// three ways: dist/index.html missing → FAIL (not skip); a referenced chunk
// file missing on disk → FAIL; and fewer than MIN_COLD_CHUNKS parsed → FAIL,
// because the entry + vendor-react + vendor-react-dom + vendor-router chunks
// are structurally always on the cold path, so a count below that means the
// HTML shape changed and this guard has gone blind.

import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const distDir = path.join(repoRoot, "dist");
const indexHtml = path.join(distDir, "index.html");

// 128 KB gz. See BUDGET note above before changing.
export const COLD_JS_CEILING_GZ = 128 * 1024;
// Floor below which a parse is presumed broken/blind rather than genuinely tiny.
const MIN_COLD_CHUNKS = 4;

function fmtBytes(n) {
  return n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`;
}

// Extract, order-independently, the cold-path JS refs from index.html:
//   - the entry   <script type="module" ... src="/assets/*.js">
//   - every       <link rel="modulepreload" ... href="/assets/*.js">
// Attribute order inside a tag is not assumed (rollup/vite can emit crossorigin
// before or after rel/href), so each matching tag is inspected for its own
// attributes.
function extractColdJsRefs(html) {
  const refs = new Set();

  for (const tag of html.match(/<script\b[^>]*>/gi) || []) {
    if (!/\btype="module"/i.test(tag)) continue;
    const src = tag.match(/\bsrc="([^"]+)"/i)?.[1];
    if (src && src.endsWith(".js")) refs.add(src);
  }

  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/\brel="modulepreload"/i.test(tag)) continue;
    const href = tag.match(/\bhref="([^"]+)"/i)?.[1];
    if (href && href.endsWith(".js")) refs.add(href);
  }

  return [...refs];
}

function fail(msg, extra = []) {
  console.error("");
  console.error(`✗ FAIL [check:cold-landing-js-size]: ${msg}`);
  for (const line of extra) console.error(line);
  console.error("");
  process.exit(1);
}

if (!existsSync(indexHtml)) {
  fail(`dist/index.html not found at ${indexHtml}.`, [
    "  This guard reads the built cold-path graph. It must run AFTER `npm run build`.",
    "  In verify:core it is wired immediately after the build step; run `npm run build` first.",
  ]);
}

const html = readFileSync(indexHtml, "utf8");
const refs = extractColdJsRefs(html);

if (refs.length < MIN_COLD_CHUNKS) {
  fail(
    `parsed only ${refs.length} cold-path JS chunk(s) from dist/index.html (floor ${MIN_COLD_CHUNKS}).`,
    [
      "  The entry + vendor-react + vendor-react-dom + vendor-router chunks are",
      "  structurally always on the cold path. A count below the floor means the",
      "  index.html shape changed and this guard has gone blind — it is NOT a pass.",
      "  Re-check extractColdJsRefs() against the current Vite HTML output.",
    ],
  );
}

let total = 0;
const rows = [];
for (const ref of refs) {
  const file = path.join(distDir, ref.replace(/^\//, ""));
  if (!existsSync(file)) {
    fail(`cold-path chunk referenced by index.html is missing on disk: ${ref}`, [
      `  Expected at ${file}. A stale/partial build cannot be budgeted honestly.`,
      "  Re-run `npm run build` and retry.",
    ]);
  }
  const raw = readFileSync(file);
  const gz = gzipSync(raw).length;
  total += gz;
  rows.push({ ref, gz, raw: raw.length });
}

rows.sort((a, b) => b.gz - a.gz);
console.log(
  `[check:cold-landing-js-size] cold critical-path JS: ${fmtBytes(total)} gz across ${refs.length} chunks (ceiling ${fmtBytes(COLD_JS_CEILING_GZ)} gz)`,
);
for (const r of rows) {
  console.log(
    `  ${fmtBytes(r.gz).padStart(9)} gz  ${fmtBytes(r.raw).padStart(9)} raw  ${r.ref}`,
  );
}

if (total > COLD_JS_CEILING_GZ) {
  fail(
    `cold critical-path JS ${fmtBytes(total)} gz exceeds ${fmtBytes(COLD_JS_CEILING_GZ)} gz ceiling.`,
    [
      "  A cold first-time prospect now downloads more JS before first paint on `/`.",
      "",
      "  Triage:",
      "    1. Diff dist/index.html's modulepreload list against the last green build —",
      "       a NEW chunk on the cold path is a new eager import in App.tsx's pre-lazy graph.",
      "    2. If it's an icon chunk, you likely re-leaked the full `vendor-icons` blob;",
      "       see check:vendor-icons-landing-census and commit f488979f.",
      "    3. If a heavy vendor appeared, make its importer route-lazy (React.lazy) so it",
      "       leaves the entry's eager graph.",
      "    4. If the growth is genuinely required cold-path code, raise COLD_JS_CEILING_GZ",
      "       in THIS commit and put the new measured baseline in the commit message.",
    ],
  );
}

console.log(`✓ cold critical-path JS under ${fmtBytes(COLD_JS_CEILING_GZ)} gz ceiling.`);
