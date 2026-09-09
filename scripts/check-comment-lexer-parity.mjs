#!/usr/bin/env node
/**
 * The shared comment lexer must agree with TypeScript's parser about what a
 * comment is -- in BOTH directions, across the whole repo.
 *
 * scripts/lib/strip-comments.mjs is a hand-written lexer that 27 guards import.
 * Every wave that touched it (MP-474, MP-480, MP-481, MP-482, MP-487) found the
 * same thing: a single character it mis-reads desynchronises it for the rest of
 * the file. The unit test in scripts/tests/strip-comments.test.mjs pins the
 * shapes we already know about. This grades the invariant over real code, which
 * is the only thing that catches the shape nobody has thought of yet.
 *
 * TWO invariants, and they fail for opposite reasons:
 *
 *   SURVIVING  a real comment left standing in the stripped output. A guard then
 *              scans its own prose and reports a violation that is not there.
 *              LOUD -- somebody investigates and eventually files a wave.
 *
 *   BLANKED    a character OUTSIDE any comment replaced with a space. A guard
 *              reads that code as absent, so a real violation there is never
 *              reported. SILENT -- it emits nothing to investigate, which is why
 *              MP-487 found 191 such characters that had survived every prior
 *              wave on this file, including the two waves that rewrote it.
 *
 * Neither is a count with a baseline. A baseline here would be fungible the way
 * MP-356 proved: a real regression could be absorbed by an unrelated pay-down and
 * the gate would stay green. The contract is zero, in both directions.
 *
 * The oracle is the PARSER, never a bare scanner. MP-482 measured that
 * ts.createScanner without parser guidance desynchronises on TSX exactly like the
 * lexer under test and reported 23,805 confident false violations -- an oracle
 * that shares the defect it is grading proves nothing. Comments are collected as
 * leading and trailing trivia of every TOKEN, not of every AST node: MP-474's
 * node walk missed comments sitting between links of a fluent chain.
 *
 * Cost is MEASURED and printed, never documented. MP-493: check-tsc-error-count
 * advertised "~10-15s" in its header while taking 881s, and a wave budgeted the
 * documented number and left its own work uncommitted for an hour.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["src", "supabase/functions", "scripts"];
const started = Date.now();
const SKIP_DIRS = new Set(["node_modules", "__pycache__", ".git", "dist", "build", "coverage"]);

// The walk must not silently shrink. A guard that grades 104 of 1,136 files and
// prints a green is worth less than no guard, because it also stops anyone looking.
const MIN_FILES = 900;

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      // Match directory NAMES, never the path. The first cut tested the absolute
      // path against /dist|build/ -- and this repo is called rebuild-brighten-sparkle,
      // so every directory under it matched and the walk never recursed. It graded
      // 104 of 1,136 files and printed a confident green. A filter that excludes by
      // substring excludes the repo it lives in.
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (/\.(ts|tsx|mjs|js|jsx)$/.test(e.name)) out.push(p);
    }
  };
  for (const r of ROOTS) {
    const d = path.join(ROOT, r);
    if (fs.existsSync(d)) walk(d);
  }
  return out.sort();
}

// Every comment in the file, as the PARSER sees it.
function commentRanges(text, file) {
  const sf = ts.createSourceFile(
    file, text, ts.ScriptTarget.Latest, /* setParentNodes */ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : undefined,
  );
  const seen = new Map();
  const add = (rs) => { if (rs) for (const r of rs) seen.set(`${r.pos}:${r.end}`, r); };
  const walk = (node) => {
    node.getChildren(sf).forEach(walk);
    if (node.getChildCount(sf) === 0) {
      add(ts.getLeadingCommentRanges(text, node.getFullStart()));
      add(ts.getTrailingCommentRanges(text, node.getEnd()));
    }
  };
  walk(sf);
  return [...seen.values()];
}

const lineOf = (text, pos) => text.slice(0, pos).split("\n").length;

const surviving = [];
const blanked = [];
const unprovable = [];
let scanned = 0;

for (const file of sourceFiles()) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, "utf8");
  let ranges;
  try { ranges = commentRanges(text, file); }
  catch (e) { unprovable.push(`${rel} — parser threw: ${e.message}`); continue; }

  let stripped;
  try { stripped = stripComments(text); }
  catch (e) { unprovable.push(`${rel} — lexer threw: ${e.message}`); continue; }

  // Offsets are load-bearing: callers slice the ORIGINAL text by indices taken
  // from the stripped copy, so a length change silently misreports every line.
  if (stripped.length !== text.length) {
    unprovable.push(`${rel} — stripped length ${stripped.length} != source ${text.length}`);
    continue;
  }
  scanned++;

  const inComment = new Uint8Array(text.length);
  for (const r of ranges) for (let k = r.pos; k < r.end; k++) inComment[k] = 1;

  for (const r of ranges) {
    let alive = false;
    for (let k = r.pos; k < r.end; k++) {
      if (text[k] === "\n") continue;
      if (stripped[k] !== " ") { alive = true; break; }
    }
    if (alive) surviving.push(`${rel}:${lineOf(text, r.pos)}`);
  }

  // Report the first offending character per contiguous run: one desync blanks a
  // whole line, and 55 identical lines would bury the other file it happened in.
  let prev = -2;
  for (let k = 0; k < text.length; k++) {
    if (stripped[k] === text[k] || inComment[k]) continue;
    if (k !== prev + 1) blanked.push(`${rel}:${lineOf(text, k)}  ${JSON.stringify(text.slice(k, Math.min(text.length, k + 48)).split("\n")[0])}`);
    prev = k;
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
const tooFew = scanned < MIN_FILES;
const fail = surviving.length || blanked.length || unprovable.length || tooFew;

if (tooFew) {
  console.error(`\n❌ graded only ${scanned} file(s), below the floor of ${MIN_FILES}. The walk is`);
  console.error(`   excluding source it should reach, so a green here would not mean agreement.`);
}

if (blanked.length) {
  console.error(`\n❌ ${blanked.length} run(s) of NON-COMMENT code blanked by the lexer (silent direction — a guard reads this code as absent):`);
  for (const s of blanked.slice(0, 25)) console.error(`   ${s}`);
  if (blanked.length > 25) console.error(`   ... +${blanked.length - 25} more`);
}
if (surviving.length) {
  console.error(`\n❌ ${surviving.length} real comment(s) left standing by the lexer (loud direction — a guard fires on its own prose):`);
  for (const s of surviving.slice(0, 25)) console.error(`   ${s}`);
  if (surviving.length > 25) console.error(`   ... +${surviving.length - 25} more`);
}
if (unprovable.length) {
  // Never a silent pass: a file the oracle could not read is not a file that agrees.
  console.error(`\n❌ ${unprovable.length} file(s) UNPROVABLE — neither direction was graded:`);
  for (const s of unprovable.slice(0, 25)) console.error(`   ${s}`);
}

if (fail) {
  console.error(`\nscripts/lib/strip-comments.mjs disagrees with the TypeScript parser. Fix the lexer,`);
  console.error(`and add the shape to scripts/tests/strip-comments.test.mjs so it cannot return.`);
  console.error(`[comment-lexer-parity] ${scanned} file(s) graded in ${secs}s\n`);
  process.exit(1);
}
console.log(`[comment-lexer-parity] ✅ ${scanned} file(s): 0 comments survived, 0 non-comment chars blanked (${secs}s)`);
