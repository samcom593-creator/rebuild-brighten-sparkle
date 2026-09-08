#!/usr/bin/env node
/**
 * MP-474: cap the private-comment-stripper class.
 *
 * 21 distinct copies of stripComments existed across 23 guards. 19 mis-lexed an
 * apostrophe in JSX prose ("We'll") as an opening string quote and fired on their
 * own comments; 3 stripped a `//` inside a string literal to end-of-line, which
 * DELETES real code and hides a violation. Copies do not drift because anyone
 * intended it -- the first thing a second copy does is drift from the first
 * (scan-utils.mjs says the same thing in its own header, MP-345).
 *
 * This guard does NOT grade a count. MP-357: an auth floor graded on a count let
 * a brand-new endpoint with no auth at all pass green by allowlisting a
 * bystander. The allowlist here is BY NAME and may only shrink -- a new file
 * defining its own stripComments fails, and no amount of paying down elsewhere
 * buys it a pass.
 */
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/strip-comments.mjs";

// Each entry needs a reason. Removing one is a win; adding one needs a wave.
const ALLOWED = new Map([
  ["scripts/lib/strip-comments.mjs", "the shared implementation itself"],
]);

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(mjs|js)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const offenders = [];
let scanned = 0;
for (const f of walk("scripts")) {
  scanned++;
  const rel = f.split(path.sep).join("/");
  // Strip comments before matching, or this guard reports its own header forever
  // -- the exact footnote bug (MP-277/MP-399) this family keeps re-learning.
  const src = stripComments(fs.readFileSync(f, "utf8"));
  if (!/\bfunction\s+stripComments\s*\(/.test(src)) continue;
  if (ALLOWED.has(rel)) continue;
  offenders.push(rel);
}

// A stale allowlist is the 465-fake-success row in a JSON file: report entries
// that no longer define a copy so the list shrinks instead of rotting.
const stale = [...ALLOWED.keys()].filter((rel) => {
  if (!fs.existsSync(rel)) return true;
  return !/\bfunction\s+stripComments\s*\(/.test(stripComments(fs.readFileSync(rel, "utf8")));
});

if (offenders.length) {
  console.error(`✗ check:strip-comments-copies — ${offenders.length} private comment-stripper(s) outside the allowlist:`);
  for (const o of offenders) console.error(`    ${o}`);
  console.error(`\n  Import the shared one instead:  import { stripComments } from "./lib/strip-comments.mjs";`);
  console.error(`  It is held to ground truth by scripts/tests/strip-comments.test.mjs, including the two`);
  console.error(`  directions a hand-rolled copy gets wrong: an apostrophe in JSX prose, and a \`//\` inside a string.`);
  process.exit(1);
}

console.log(`✓ check:strip-comments-copies — ${scanned} script(s) scanned, no private comment-stripper outside the ${ALLOWED.size} allowed.`);
if (stale.length) {
  console.log(`  NOTE: ${stale.length} allowlist entr(y/ies) no longer define one and can be removed: ${stale.join(", ")}`);
}
