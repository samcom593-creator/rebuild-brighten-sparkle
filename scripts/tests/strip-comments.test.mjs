#!/usr/bin/env node
/**
 * Ground-truth contract for scripts/lib/strip-comments.mjs (MP-474).
 *
 * Each case states whether MARK is inside a comment (must be STRIPPED) or inside
 * real code / JSX prose (must SURVIVE). Two directions matter and they are not
 * symmetric: a MARK that wrongly SURVIVES makes a guard fire on its own prose;
 * a MARK that is wrongly STRIPPED makes a guard MISS a real violation. The
 * second is the dangerous one and is marked DANGEROUS below.
 */
import { stripComments } from "../lib/strip-comments.mjs";

const CASES = [
  ["control-line-comment",        "STRIPPED", `const a = 1;\n// MARK\n`],
  ["control-code",                "SURVIVED", `const a = "MARK";\n`],
  ["jsx-apostrophe-then-comment", "STRIPPED", `<p>We'll never share it</p>\n// MARK\n`],
  ["jsx-apostrophe-then-block",   "STRIPPED", `<p>Don't drift</p>\n/* MARK */\n`],
  ["jsx-apostrophe-keeps-code",   "SURVIVED", `<p>We'll hold it</p>\nconst b = MARK;\n`],
  ["two-apostrophes",             "STRIPPED", `<p>We'll not don't</p>\n// MARK\n`],
  ["apostrophe-string-code",      "SURVIVED", `<p>Don't drift</p>\nconst l = 'ok';\nconst b = MARK;\n`],
  ["jsx-expression-comment",      "STRIPPED", `<div>\n{/* MARK */}\n</div>\n`],
  ["apostrophe-then-jsx-comment", "STRIPPED", `<p>We'll ship</p>\n<div>{/* MARK */}</div>\n`],
  ["template-apostrophe",         "STRIPPED", "const t = `Don't drift`;\n// MARK\n"],
  ["apostrophe-inside-string",    "STRIPPED", `const s = "don't";\n// MARK\n`],
  // DANGEROUS direction: `//` inside a string is not a comment. Stripping it to
  // end-of-line deletes real code after it and hides a violation.
  ["url-in-string-same-line",     "SURVIVED", `const s = "https://x.co"; const b = MARK;\n`],
  ["block-open-in-string",        "SURVIVED", `const s = "/*"; const b = MARK; const t = "*/";\n`],
  // The case that falsified MP-474's first approach: a TypeScript AST walk leaves
  // comments sitting between links of a fluent chain intact, because they attach
  // to no node's leading trivia. A lexer must blank them.
  ["mid-chain-comment",           "STRIPPED",
    `const { data } = await sb.from("t")\n  .eq("chat_id", id)\n  // MARK .maybeSingle() in prose\n  .limit(1)\n  .maybeSingle();\n`],
  // ...and must not damage the chain around them.
  ["mid-chain-keeps-limit",       "SURVIVED",
    `const { data } = await sb.from("t")\n  // prose\n  .limit(1) // MARK is not here\n`.replace("MARK is not here", "x").replace(".limit(1)", ".limit(1); const q = MARK;")],
];

let pass = 0;
const fail = [];
for (const [id, truth, src] of CASES) {
  let got;
  try { got = stripComments(src).includes("MARK") ? "SURVIVED" : "STRIPPED"; }
  catch (e) { got = `THREW(${e.message})`; }
  if (got === truth) pass++;
  else fail.push(`  ${id}: expected ${truth}, got ${got}`);
}

// Offsets must be preserved, or reported line numbers drift.
const sample = `const a = 1;\n// comment\nconst b = 2;\n`;
if (stripComments(sample).length !== sample.length) fail.push("  offset-preservation: length changed");
else pass++;
if (stripComments(sample).split("\n").length !== sample.split("\n").length) fail.push("  offset-preservation: line count changed");
else pass++;

const total = CASES.length + 2;
if (fail.length) {
  console.error(`[strip-comments] ❌ ${pass}/${total}\n${fail.join("\n")}`);
  process.exit(1);
}
console.log(`[strip-comments] ✅ ${pass}/${total} ground-truth cases`);
