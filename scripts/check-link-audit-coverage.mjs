#!/usr/bin/env node
// check-link-audit-coverage.mjs — MP-413
//
// WHY THIS EXISTS
// scripts/link-audit.mjs ran three times over 15 days (2026-08-20, 2026-08-25,
// 2026-09-02) and every single run degraded to public-seeds-only, recording one
// row: "no logged-in auth state supplied; authenticated routes were not
// crawled". The 12 authenticated seeds and every static route in App.tsx —
// Sam's daily ops surface — had ZERO link coverage for the audit's whole life,
// while the session-minting mechanism it needed already existed in
// ~/business-ops/scripts/apex-see-page.mjs.
//
// Worse, the artifact could not say so. The OUT file held broken rows and
// nothing else, so "crawled 258 pages, every link fine" and "crawled nothing"
// were the same empty file — and an empty file reads as health. That is the
// blank-means-green shape this repo has paid for before.
//
// This guard grades the two structural properties that keep the audit honest:
// it must be able to authenticate itself, and it must record what it covered.
// It does NOT grade a run's results — a clean crawl and a dirty crawl are both
// fine here. Grading findings would make this a permanently-red weather report.
//
// COMMENT STRIPPING IS LOAD-BEARING: every token below appears in this very
// header and in link-audit.mjs's own comments. A raw-source scan would match
// its own documentation and pass while the code was gutted.

import fs from "node:fs";
import path from "node:path";

const target = path.join(import.meta.dirname, "link-audit.mjs");
const failures = [];

if (!fs.existsSync(target)) {
  console.error("check:link-audit-coverage FAIL — scripts/link-audit.mjs is missing");
  process.exit(1);
}

const raw = fs.readFileSync(target, "utf8");

// Strip block comments, line comments, and string/template bodies so a mention
// in prose or in an error message cannot satisfy a code-level assertion.
function stripNonCode(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code";
  let quote = "";
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (c === "/" && next === "*") { state = "block"; i += 2; continue; }
      if (c === "/" && next === "/") { state = "line"; i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { state = "string"; quote = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") { state = "code"; i += 2; continue; }
      i += 1; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += "\n"; }
      i += 1; continue;
    }
    // string: keep the delimiters, drop the body, so identifiers inside
    // messages ("authenticated routes were not crawled") never count as code.
    if (c === "\\") { i += 2; continue; }
    if (c === quote) { state = "code"; out += c; i += 1; continue; }
    i += 1;
  }
  return out;
}

const code = stripNonCode(raw);

// Comments stripped, string literals KEPT. Assertions about a literal *value*
// (e.g. that the opt-out compares against "1") cannot run against `code`,
// because stripNonCode empties string bodies and would turn `=== "1"` into
// `=== ""` — which is exactly how this guard first went red on its own author.
// Comments are the false-positive risk being defended against here, not strings.
const codeWithStrings = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// 1. The audit must be able to mint its own admin session, and the minter must
//    actually be reachable from the auth installer — a defined-but-uncalled
//    minter is the "guard run by nothing" shape.
if (!/function\s+mintAdminSession\s*\(/.test(code)) {
  failures.push("mintAdminSession() is not defined — the audit cannot authenticate itself and will silently degrade to public-only");
}
const installAuthBody = code.match(/async\s+function\s+installAuth\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!installAuthBody) {
  failures.push("installAuth() could not be located — cannot prove the minter is wired");
} else if (!/mintAdminSession\s*\(/.test(installAuthBody[1])) {
  failures.push("installAuth() never calls mintAdminSession() — minting is orphaned, so every run falls back to public-only");
}

// 2. Minting must be ON by default. An opt-out that defaults to opted-out is
//    how this regressed in the first place.
if (!/NO_AUTH_MINT\s*=\s*process\.env\.NO_AUTH_MINT\s*===\s*"1"/.test(codeWithStrings)) {
  failures.push("NO_AUTH_MINT is not a strict opt-out (expected `process.env.NO_AUTH_MINT === \"1\"`) — minting may be off by default");
}

// 3. Every run must leave a coverage record in the artifact itself, not only on
//    stdout, so an empty result set can never be mistaken for a clean audit.
// Anchored to the summary record specifically. A bare `appendFileSync(OUT, ...)`
// assertion is satisfied by recordBroken(), which has always existed — so it
// would have passed against the exact pre-MP-413 code that caused this bug.
// Proven: mutation M1 (delete the summary append) passed a bare OUT match.
// Uses codeWithStrings because stripNonCode empties the template body that
// carries the `summary` identifier.
if (!/appendFileSync\s*\(\s*OUT\s*,[^;]*\bsummary\b/.test(codeWithStrings)) {
  failures.push("no appendFileSync(OUT, ...) for the summary — the artifact would hold broken rows only, so 'clean' and 'never ran' stay indistinguishable");
}
// 4. A third-party host that bot-blocks must not be counted as site breakage.
//    49 of the first authenticated crawl's 50 findings were one such host; if
//    they feed hardBroken, the audit exits non-zero on a healthy site forever
//    and becomes a signal nobody reads.
if (!/hardBroken\s*=[\s\S]{0,400}?classification\s*!==/.test(codeWithStrings)) {
  failures.push("hardBroken does not exclude classification === \"external-blocked\" — a bot-blocking third-party host would make a healthy site exit non-zero on every run");
}

for (const key of ["pagesVisited", "linksChecked", "authenticated", "seedScope", "capReached"]) {
  if (!new RegExp(`\\b${key}\\s*:`).test(code)) {
    failures.push(`the summary record omits \`${key}\` — coverage cannot be read off the artifact`);
  }
}

if (failures.length > 0) {
  console.error("check:link-audit-coverage FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nSee MP-413: the link audit spent its whole life crawling public pages only, and its output file could not tell anyone.");
  process.exit(1);
}

console.log(`check:link-audit-coverage OK — link-audit.mjs mints its own session (wired into installAuth), minting is on by default, and every run appends a coverage summary carrying pagesVisited/linksChecked/authenticated/seedScope.`);
