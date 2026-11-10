#!/usr/bin/env node
/**
 * check-hardcoded-sender — WP4 (2026-11-10 onboarding audit, DELIVERY-7)
 *
 * THE PROBLEM: recruits got mail from 12 sender display names in 30 days on one
 * domain ("Sam at Galaxy Financial" 1,267, "Galaxy Financial" 905,
 * "Sam · Galaxy Financial" 767, "Sam · Galaxy" 148, "Galaxy System" 109, ...),
 * and next-step reminders went out from an address with no Reply-To at all.
 * Each sender hard-coded its own `from:`. _shared/email.ts now exports
 * BRAND_FROM / BRAND_REPLY_TO; this ratchet stops the literal count growing
 * while the existing senders migrate.
 *
 * WHAT IS COUNTED, per file, in supabase/functions/**\/*.ts except
 * _shared/email.ts (the one place the literal belongs) and *.test.ts: lines of
 * CODE (comments stripped; string bodies kept, because the literal IS a string)
 * that either
 *   - give `from:` a string or template literal, or
 *   - contain an "...@apex-financial.org>" display-name address.
 * A line matching both counts once.
 *
 * RATCHET, PER FILE (a global count would let a new literal in one file hide
 * behind a fix in another): a file above its baseline fails, and a file not in
 * the baseline fails if it has any. A file below its baseline passes and prints
 * the line to lower; `--update` rewrites the baseline from the current tree and
 * refuses to RAISE any entry unless `--allow-raise` is also given.
 *
 * `--selftest` proves the detector can fail: it runs the matcher over fixtures
 * that must count 1, 1, 1, 0 and 0, and exits non-zero if any comes out wrong.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { stripComments } from "./lib/strip-comments.mjs";

const BASELINE = "scripts/data/hardcoded-sender-baseline.json";
const EXEMPT = new Set(["supabase/functions/_shared/email.ts"]);

const FROM_LITERAL = /\bfrom\s*:\s*["'`]/;
const DOMAIN_ADDR = /@apex-financial\.org>/i;

export function countSenderLiterals(source) {
  const code = stripComments(source);
  let n = 0;
  for (const line of code.split("\n")) {
    if (FROM_LITERAL.test(line) || DOMAIN_ADDR.test(line)) n++;
  }
  return n;
}

function selftest() {
  const cases = [
    ['await resend.emails.send({ from: "Galaxy Financial <x@apex-financial.org>", to });', 1],
    ["const F = `Sam <sam@apex-financial.org>`;", 1],
    ["send({ from: 'Someone <a@b.com>' })", 1],
    ["// from: \"Galaxy <x@apex-financial.org>\" in a comment", 0],
    ["send({ from: BRAND_FROM, reply_to: BRAND_REPLY_TO })", 0],
  ];
  let bad = 0;
  for (const [src, want] of cases) {
    const got = countSenderLiterals(src);
    if (got !== want) {
      bad++;
      console.error(`selftest FAIL: expected ${want}, got ${got}: ${src}`);
    }
  }
  if (bad) process.exit(1);
  console.log(`check:hardcoded-sender selftest — ${cases.length}/${cases.length} fixtures graded as expected`);
}

function currentCounts() {
  const files = execFileSync("git", ["ls-files", "supabase/functions"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !EXEMPT.has(f) && existsSync(f));
  const counts = {};
  for (const f of files) {
    const n = countSenderLiterals(readFileSync(f, "utf8"));
    if (n > 0) counts[f] = n;
  }
  return counts;
}

const args = new Set(process.argv.slice(2));
if (args.has("--selftest")) {
  selftest();
  process.exit(0);
}

const counts = currentCounts();
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (args.has("--update")) {
  const old = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")).files ?? {} : {};
  const raised = Object.entries(counts).filter(([f, n]) => n > (old[f] ?? 0));
  if (raised.length && existsSync(BASELINE) && !args.has("--allow-raise")) {
    for (const [f, n] of raised) console.error(`refusing to raise ${f}: ${old[f] ?? 0} -> ${n}`);
    console.error("check:hardcoded-sender --update only lowers. Use BRAND_FROM from _shared/email.ts instead of a literal.");
    process.exit(1);
  }
  writeFileSync(BASELINE, JSON.stringify({
    note: "WP4 ratchet: per-file count of literal sender lines in supabase/functions (see scripts/check-hardcoded-sender.mjs). Only lower these.",
    total,
    files: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
  }, null, 2) + "\n");
  console.log(`check:hardcoded-sender — baseline written: ${total} lines in ${Object.keys(counts).length} files`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`check:hardcoded-sender — ${BASELINE} is missing; run with --update once to create it.`);
  process.exit(1);
}
const base = JSON.parse(readFileSync(BASELINE, "utf8")).files ?? {};
const over = [];
const under = [];
for (const [f, n] of Object.entries(counts)) {
  const b = base[f] ?? 0;
  if (n > b) over.push(`${f}: ${n} (baseline ${b})`);
  else if (n < b) under.push(`${f}: ${n} (baseline ${b})`);
}
for (const [f, b] of Object.entries(base)) {
  if (!(f in counts) && b > 0) under.push(`${f}: 0 (baseline ${b})`);
}
if (over.length) {
  console.error("check:hardcoded-sender — new literal sender lines in supabase/functions:");
  for (const l of over) console.error("  " + l);
  console.error("Import BRAND_FROM / BRAND_REPLY_TO from supabase/functions/_shared/email.ts instead.");
  process.exit(1);
}
if (under.length) {
  console.log("check:hardcoded-sender — below baseline (lower it with `node scripts/check-hardcoded-sender.mjs --update`):");
  for (const l of under) console.log("  " + l);
}
console.log(`check:hardcoded-sender — OK: ${total} literal sender lines in ${Object.keys(counts).length} files, none above baseline`);
