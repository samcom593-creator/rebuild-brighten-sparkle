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
// 4. hardBroken must be an ALLOW-list of decided verdicts, never a deny-list of
//    excuses. MP-413 wrote it as `!== "external-blocked"` and asserted the host
//    was refusing automation; MP-414 falsified that (both named hosts serve 200
//    to a real browser, and the 49-link burst had rate-limited this IP itself).
//    A deny-list means every new excuse silently widens what cannot fail, which
//    is how a genuinely dead third-party link became unreportable.
if (!/hardBroken\s*=[\s\S]{0,600}?classification\s*===\s*"internal-broken"/.test(codeWithStrings)
    || !/hardBroken\s*=[\s\S]{0,600}?classification\s*===\s*"external-broken"/.test(codeWithStrings)) {
  failures.push("hardBroken is not an allow-list of decided verdicts (internal-broken, external-broken) — an excuse-shaped deny-list lets a real dead link hide behind a classification nobody re-checks");
}

// 5. An external refusal must be re-checked in the real browser before the audit
//    says anything about the host. MEASURED 2026-09-04 against newbridgelife.com:
//    node fetch is 403 with the audit UA *and* with a Chrome UA, while real
//    Chrome is 200 — so the discriminator is the CLIENT, not the user-agent
//    string, and MP-413's two-user-agent curl test could not have shown that.
//    Without this the audit reports its own client's refusal as the host's policy.
if (!/verifyInBrowser\s*\(/.test(code) || !/\bgoto\s*\(/.test(codeWithStrings.slice(codeWithStrings.indexOf("verifyInBrowser")))) {
  failures.push("external refusals are not re-verified in the browser context — a node-fetch 403/429 would again be reported as the host blocking automation");
}

// 5b. The verifier must not be handed the CRAWL context. The crawl is headless
//     and headless Chrome is refused by these WAFs exactly like node fetch is
//     (measured: same host, headless 403 / headed 200). A `verifyContext =
//     context` assignment makes getVerifyContext() short-circuit on its first
//     line, so the headed verifier becomes dead code while the file still reads
//     as fixed -- that shipped once in this very wave and was caught only by
//     running it, not by reading it.
if (/verifyContext\s*=\s*context\b/.test(code)) {
  failures.push("verifyContext is assigned the headless crawl context — the headed verifier is dead code and every external refusal degrades to unverified");
}
if (!/headless:\s*false/.test(code)) {
  failures.push("the verification context is not headed (expected `headless: false`) — a headless browser is refused by the same WAFs as node fetch, so the leg cannot verify the hosts it exists for");
}

// 6. Outbound footprint must be bounded and throttled. The audit sent 98
//    requests to truepeoplesearch.com in 10.4s (49 links x HEAD+GET) and got
//    Sam's office IP rate-limited on a service his recruiters use, then recorded
//    the 429 it had caused as that host's policy. An auditor that is the largest
//    source of the traffic it measures is measuring itself.
// Graded on the ENFORCEMENT, not on the identifiers. A bare presence test for
// `EXTERNAL_HOST_MAX`/`hostSpend` passed mutation M4, which deleted the const
// declaration and the Map while leaving every read site intact — the budget was
// gone (the script would not even run) and the guard said OK. Assert the
// comparison, the declaration, and the skip that the comparison must produce.
if (!/const\s+EXTERNAL_HOST_MAX\s*=/.test(code) || !/const\s+hostSpend\s*=\s*new Map\(\)/.test(code)) {
  failures.push("per-host budget state is not declared (const EXTERNAL_HOST_MAX / const hostSpend = new Map()) — one page of third-party links can burst a single host again");
}
if (!/spent\s*>=\s*EXTERNAL_HOST_MAX/.test(code)) {
  failures.push("the per-host budget is never compared against (expected `spent >= EXTERNAL_HOST_MAX`) — the cap is declared but not enforced");
}
if (!/"external-skipped"/.test(codeWithStrings)) {
  failures.push("exceeding the per-host budget does not produce an `external-skipped` verdict — over-budget links would be silently dropped or silently fetched");
}
if (!/EXTERNAL_HOST_MIN_INTERVAL_MS/.test(code) || !/hostGate\s*\(/.test(code)) {
  failures.push("no per-host throttle (hostGate/EXTERNAL_HOST_MIN_INTERVAL_MS) — requests to one host are unpaced");
}
// The gate is only real if EVERY outbound request pays it. Anchored inside
// fetchWithTimeout, which is the single choke point both HEAD and GET go through.
if (!/async function fetchWithTimeout\s*\([^)]*\)\s*\{\s*await hostGate\s*\(/.test(code)) {
  failures.push("hostGate is not awaited at the top of fetchWithTimeout — the HEAD->GET retry pair would bypass the throttle and double the real request rate");
}
// A cap that does not say what it skipped reads as full coverage.
if (!/externalSkipped/.test(code) || !/hostSkipped/.test(code)) {
  failures.push("skipped external links are not published in the summary — a capped run would be indistinguishable from a complete one");
}

// Keys are checked INSIDE the summary object literal, and shorthand (`key,`) is
// accepted as well as `key:`. A bare `\bkey\s*:` scan over the whole file is a
// proxy for the wrong thing twice: it passes on a local variable declared
// anywhere, and it fails on a valid shorthand property. It rejected this very
// file's correct `externalSkipped,` on first run.
const summaryStart = code.indexOf("const summary = {");
const summaryBody = summaryStart === -1 ? "" : code.slice(summaryStart, code.indexOf("};", summaryStart));
if (!summaryBody) {
  failures.push("cannot locate the `const summary = {` object literal — coverage keys are ungradeable");
}
for (const key of ["pagesVisited", "linksChecked", "authenticated", "seedScope", "capReached", "externalSkipped", "externalUnverified"]) {
  if (!new RegExp(`\\b${key}\\s*[:,]`).test(summaryBody)) {
    failures.push(`the summary record omits \`${key}\` — coverage cannot be read off the artifact`);
  }
}

if (failures.length > 0) {
  console.error("check:link-audit-coverage FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nSee MP-413: the link audit spent its whole life crawling public pages only, and its output file could not tell anyone.");
  process.exit(1);
}

console.log(`check:link-audit-coverage OK — link-audit.mjs mints its own session (wired into installAuth), minting is on by default, every outbound request pays a per-host throttle under a per-host budget, external refusals are re-verified in a real browser before the audit characterises the host, and every run appends a coverage summary carrying pagesVisited/linksChecked/authenticated/seedScope/capReached/externalSkipped/externalUnverified.`);
