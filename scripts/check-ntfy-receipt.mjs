#!/usr/bin/env node
// Bans ntfy pushes that cannot tell a refusal from a delivery.
//
// THE DEFECT. `fetch()` rejects only on a TRANSPORT failure. An HTTP 429, 401 or
// 500 is an ordinary resolved Response, so both of these report success for a
// push that never reached Sam's phone:
//
//     await fetch(NTFY_URL, { method: "POST", headers, body }).catch(() => {});
//     try { await fetch(NTFY_URL, {...}); } catch (e) { console.error(e); }
//
// The catch never fires. Four edge functions shipped that shape. A fifth,
// apex-alert-dispatch, kept `http:${r.status}` and discarded the body.
//
// WHY THE BODY AND NOT JUST THE STATUS. apex-doctor Check #21 spent 26 days
// unable to name why Sam's push was refused, because `http:429` names nothing.
// ntfy's body said {"code":42908,"error":"limit reached: daily message quota
// reached"} — a per-visitor-IP daily quota on the shared Supabase egress, which
// no cadence change can fix. The two ntfy 429s recorded on 2026-08-19 during the
// real Vercel outage are undiagnosable today for exactly this reason.
//
// THE RULE. Every ntfy push in supabase/functions must either:
//   (a) go through postNtfyGraded() from _shared/ntfy-post.ts, or
//   (b) do its own raw fetch AND grade the response — reference `.ok` and read
//       the body with `.text()` within the enclosing call.
//
// There are NO exemptions and no allowlist. site-shell-watch passes on (b) by
// its own merits, measured rather than waved through — an exemption list is
// judgement, this is a measurement.
//
// BASELINE 0. This class was swept to zero when the guard landed, so it is a
// ceiling and not a bump-me floor: any NEW ungraded ntfy push fails the commit.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const SCAN_DIR = path.join(repoRoot, "supabase/functions");

// The one file that MUST perform the raw graded fetch, and the tests that
// deliberately construct throwaway Requests against ntfy URLs.
const IS_HELPER = (rel) => rel === "_shared/ntfy-post.ts";
const IS_TEST = (rel) => /\.test\.ts$/.test(rel);

// A fetch whose target argument names ntfy: a literal URL, or an identifier
// whose name contains NTFY (NTFY_URL, NTFY, ntfyUrl, topicOverride is NOT
// matched — that one reaches the helper).
const NTFY_FETCH_RX = /\bfetch\s*\(\s*(?:`[^`]*ntfy\.sh[^`]*`|"[^"]*ntfy\.sh[^"]*"|'[^']*ntfy\.sh[^']*'|[A-Za-z_$][\w$]*NTFY[\w$]*|NTFY[\w$]*|[A-Za-z_$][\w$]*[Nn]tfy(?:Url|URL)[\w$]*)/;

// How far past the fetch to look for the grading. A fetch and its response
// handling live in the same small function in every caller here; 30 lines is
// comfortably past the longest (site-shell-watch's pushNtfy is 22).
const WINDOW = 30;

// SECOND RULE, and it is the one that matters most. The first rule matches on
// the fetch TARGET, so it is blind to apex-alert-dispatch — whose postNtfy does
// `fetch(url, ...)` against a variable resolved from system_settings. That is
// the exact function whose discarded body cost 26 days of diagnosis, so a guard
// that cannot see it is guarding the wrong thing. Any fetch inside a function
// whose NAME names ntfy (postNtfy, pushNtfy, ntfy) must grade too.
// Only real function forms. An earlier cut used a loose "identifier = ... (" and
// it matched `const r = await fetch(url, {` — renaming the enclosing function to
// "r" on the very line being judged, which silently disabled this whole rule.
// It reported 4 instead of 5 and looked exactly like a clean pass.
const FN_DECL_RX = /(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=>/;
const NTFY_FN_RX = /ntfy/i;

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|js)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

// MP-543: this file used to carry its OWN comment stripper. check:strip-comments-copies
// forbids that, and had been failing on this file since MP-542 wired it in --
// verify:core was red for every worker, not just this one. The shared copy is held to
// ground truth by scripts/tests/strip-comments.test.mjs, including the two directions a
// hand-rolled one gets wrong: an apostrophe in prose, and a `//` inside a string literal.
import { stripComments } from "./lib/strip-comments.mjs";

export function findViolations(files, readFile = (f) => fs.readFileSync(f, "utf8")) {
  const hits = [];
  for (const file of files) {
    const rel = path.relative(SCAN_DIR, file);
    if (IS_HELPER(rel) || IS_TEST(rel)) continue;
    const lines = stripComments(readFile(file)).split("\n");
    let currentFn = "";
    for (let i = 0; i < lines.length; i++) {
      // Judge the line against the function it is INSIDE, then apply any
      // declaration on it — never the other way round.
      const targetNamesNtfy = NTFY_FETCH_RX.test(lines[i]);
      const insideNtfyFn = /\bfetch\s*\(/.test(lines[i]) && NTFY_FN_RX.test(currentFn);

      const decl = FN_DECL_RX.exec(lines[i]);
      if (decl) currentFn = decl[1] || decl[2] || currentFn;

      if (!targetNamesNtfy && !insideNtfyFn) continue;
      const windowText = lines.slice(i, i + WINDOW).join("\n");
      const grades = /\.ok\b/.test(windowText);
      const readsBody = /\.text\s*\(/.test(windowText);
      if (grades && readsBody) continue;
      const missing = [];
      if (!grades) missing.push("does not grade .ok (a 429 is a resolved Response, not a throw)");
      if (!readsBody) missing.push("does not read the body (.text()), so the refusal cannot be named");
      hits.push({ rel, line: i + 1, missing });
    }
  }
  return hits;
}

// Only run when invoked directly, so the proof harness can import the internals.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const hits = findViolations(walk(SCAN_DIR));
  if (hits.length === 0) {
    console.log("check-ntfy-receipt: OK — every ntfy push grades its own response (0 ungraded)");
    process.exit(0);
  }
  console.error(`check-ntfy-receipt: ${hits.length} ungraded ntfy push(es) — a refused push would report as delivered\n`);
  for (const h of hits) {
    console.error(`  supabase/functions/${h.rel}:${h.line}`);
    for (const m of h.missing) console.error(`      - ${m}`);
  }
  console.error(`\n  Fix: import { postNtfyGraded } from "../_shared/ntfy-post.ts" and use its receipt,`);
  console.error(`  or grade res.ok and capture await res.text() at the call site.`);
  process.exit(1);
}
