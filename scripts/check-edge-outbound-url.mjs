#!/usr/bin/env node
/**
 * Edge-function OUTBOUND-URL canonical-host guard.
 *
 * WHY THIS EXISTS (2026-11-23, Website Integrity Bot — MP-WIB-EDGE-OUTBOUND-URL)
 * morning-brief's daily owner email carried one CTA button, "OPEN TODAY PAGE →",
 * hardcoded to https://apexfinaincial.vercel.app/dashboard/today. Three things
 * were wrong with that single href and NONE of the brand guards could see it:
 *   1. TYPO — "apexfina{in}cial", not "apexfinancial". A reader never reads the
 *      href, so the misspelling was invisible on screen.
 *   2. NON-CANONICAL — the app's real home is galaxyfinancial.org (APP_BASE_URL
 *      in _shared/apex.ts). A *.vercel.app preview host is not the branded
 *      domain; the recipient lands on a URL bar that does not say the brand.
 *   3. STALE — that preview alias served index-BL5NA38L.js while production
 *      served index-COgHnwQc.js. The CTA dropped the owner onto an OLD build of
 *      the dashboard. A link that resolves 200 to the wrong bytes is the worst
 *      kind: it looks healthy and lies.
 * The edge-text/-svg brand guards check the WORDS a reader sees; nothing checked
 * the HOST an outbound button sends them to. This guard holds that line.
 *
 * It is the SIXTH guard in the src/-only-ratchet-blind-spot class (the others:
 * check-brand-literals, check-index-brand, check-manifest-brand,
 * check-edge-svg-brand, check-edge-text-brand). Each covers a surface the
 * src/ ratchet cannot see; this one covers the LINK TARGET in outbound copy.
 *
 * WHAT THIS GUARD CHECKS
 * NEGATIVE only: no edge-function .ts code string may link to the app on a
 * preview/non-canonical host (*.vercel.app / *.netlify.app / *.lovable.app).
 * The app is reached by its real domain or via buildAppUrl()/APP_BASE_URL,
 * never a preview alias. A hit is unambiguous: a reader's link bar would show a
 * preview host instead of the brand's domain.
 *
 * WHAT THIS GUARD DELIBERATELY DOES NOT TOUCH
 *   - Comments. Stripped via scripts/lib/strip-comments.mjs (the ONE repo
 *     stripper; a hand-rolled one mis-lexes apostrophes in prose — MP-474).
 *     instagram-auth/index.ts documents META_REDIRECT_URI with a vercel.app
 *     example; that is env-config documentation, not a reader's link.
 *   - kingofsales-brand.vercel.app — the King of Sales PERSONAL-brand funnel
 *     (fitness/mentorship/rentals/partner), a DIFFERENT brand deliberately
 *     hosted on vercel.app (manychat-webhook). Allowlisted by exact host.
 *   - API endpoints on *.dev (ai.gateway.lovable.dev) — these are backend
 *     service calls, not links a reader opens, and .dev never matches .app.
 *
 * FAIL-LOUD: if the functions tree yields zero .ts files, the scan seam is
 * broken and this exits non-zero. A guard that cannot find its operand must
 * never report green (the 465 fake-success rows).
 *
 * Literal/structural check, no build. Prove both directions instantly:
 *   node scripts/check-edge-outbound-url.mjs --selftest
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const FUNCS = join(ROOT, "supabase/functions");

function die(msg) {
  console.error(`❌ check:edge-outbound-url FAIL\n   ${msg}`);
  process.exit(1);
}

// Any app link on a preview host is forbidden. Capture group 1 = the host, so
// the allowlist can exempt one precise host without widening the pattern.
const PREVIEW_HOST = /https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:vercel|netlify|lovable)\.app)/gi;

// Exact hosts that are legitimately on a preview platform. A substring match
// would be a loophole (a typo'd look-alike must still fail), so compare whole
// hosts, lowercased.
const ALLOW_HOSTS = new Set(["kingofsales-brand.vercel.app"]);

function scan(src) {
  const text = stripComments(src); // documentation never votes (MP-474)
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  const hits = [];
  PREVIEW_HOST.lastIndex = 0;
  for (const m of text.matchAll(PREVIEW_HOST)) {
    const host = m[1].toLowerCase();
    if (ALLOW_HOSTS.has(host)) continue;
    hits.push({ line: lineOf(m.index), match: m[0] });
  }
  return hits;
}

// --- selftest: prove both directions, no filesystem writes ----------------
if (process.argv.includes("--selftest")) {
  const fails = [];
  // POSITIVE: the typo'd stale preview host in a CTA must be caught
  const bad = 'const html = `<a href="https://apexfinaincial.vercel.app/dashboard/today">OPEN</a>`;';
  if (scan(bad).length === 0) fails.push("typo'd apexfinaincial.vercel.app CTA NOT caught");
  // POSITIVE: even the correctly-spelled preview host is non-canonical
  const badSpelled = 'const url = "https://apexfinancial.vercel.app/apply";';
  if (scan(badSpelled).length === 0) fails.push("non-canonical apexfinancial.vercel.app NOT caught");
  // POSITIVE: sibling preview platforms are the same disease
  const badNetlify = 'const url = "https://galaxy-today.netlify.app/dashboard";';
  if (scan(badNetlify).length === 0) fails.push("netlify.app preview host NOT caught");
  // NEGATIVE: the canonical domain must pass
  const okCanon = 'const url = buildAppUrl("/dashboard/today"); // https://galaxyfinancial.org';
  if (scan(okCanon).length > 0) fails.push("canonical galaxyfinancial.org wrongly flagged");
  // NEGATIVE: the King of Sales personal-brand funnel is deliberate
  const okKos = 'const MENTORSHIP_URL = "https://kingofsales-brand.vercel.app/mentorship";';
  if (scan(okKos).length > 0) fails.push("allowlisted kingofsales-brand.vercel.app wrongly flagged");
  // NEGATIVE: a comment documenting a preview host (env example) must not vote
  const okComment = '// META_REDIRECT_URI e.g. https://apexfinaincial.vercel.app/instagram/callback';
  if (scan(okComment).length > 0) fails.push("comment-documented preview host wrongly flagged");
  // NEGATIVE: a backend .dev API endpoint is not an .app link
  const okApi = 'await fetch("https://ai.gateway.lovable.dev/v1/chat/completions");';
  if (scan(okApi).length > 0) fails.push("lovable.dev API endpoint wrongly flagged");
  if (fails.length) die("SELFTEST FAILED:\n   - " + fails.join("\n   - "));
  console.log("✅ check:edge-outbound-url --selftest OK — positive+negative both proven.");
  process.exit(0);
}

// --- collect every edge-function .ts (skip tests + generated) -------------
function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    die(`cannot read ${dir} — the edge-function tree is the operand; scan seam broken.`);
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__pycache__") continue;
      out = out.concat(walk(p));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(FUNCS);
if (files.length === 0) die("found 0 edge-function .ts files — scan seam broken, refusing to report green.");

const leaks = [];
for (const file of files) {
  for (const h of scan(readFileSync(file, "utf8"))) {
    leaks.push({ file: file.slice(ROOT.length), line: h.line, match: h.match });
  }
}

if (leaks.length > 0) {
  const detail = leaks.map((l) => `   ${l.file}:${l.line}  "${l.match}"`).join("\n");
  die(
    `outbound edge-function copy links a reader to the app on a PREVIEW host. ` +
      `The app is reached by its canonical domain — use buildAppUrl()/APP_BASE_URL ` +
      `from _shared/apex.ts, not a *.vercel.app alias (fragile, non-canonical, and ` +
      `often a STALE build). If a preview host is genuinely intended for a ` +
      `different brand, add its exact host to ALLOW_HOSTS:\n${detail}`,
  );
}

console.log(
  `✅ check:edge-outbound-url OK — ${files.length} edge-function files scanned; ` +
    `no outbound CTA links the app to a preview host (*.vercel.app/*.netlify.app/*.lovable.app); ` +
    `canonical domain / buildAppUrl() only.`,
);
