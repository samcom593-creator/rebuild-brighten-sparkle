#!/usr/bin/env node
/**
 * Positive control for scripts/lib/empty-body.mjs (MP-480).
 *
 * check-empty-catch is a RATCHET, and a ratchet cannot catch the regression this
 * file exists to catch. If the .trim() in normalizeBody() is dropped — or the
 * shared stripper is swapped in naively — every comment-bodied handler stops
 * reading as empty, the supabase/functions count falls 51 -> 22, and the guard
 * EXITS 0 while printing "Lower the baseline ... to 22 in this commit". The
 * number moving DOWN is what the blinding looks like, so the number cannot be
 * what grades it. These cases can.
 *
 * Direction matters and the two are not symmetric:
 *   EMPTY  wrongly reported NOT-EMPTY  -> the guard misses a real swallow. DANGEROUS.
 *   CODE   wrongly reported EMPTY      -> the guard accuses working code.
 */
import { normalizeBody, isEmptyCatchExpression } from "../lib/empty-body.mjs";

// [id, "EMPTY" | "CODE", body text as it appears between the handler's braces]
const BODIES = [
  ["truly-empty",              "EMPTY", ``],
  ["whitespace-only",          "EMPTY", `   \n\t `],
  // THE regression case. Every one of the 29 sites a naive conversion loses has
  // this shape; several wrap a DB or log write (agentlink-import:307,
  // morning-brief:157, notion-sync:184).
  ["block-comment-only",       "EMPTY", ` /* ignore */ `],
  ["line-comment-only",        "EMPTY", ` // audit-only; never block the run\n`],
  ["multiline-block-comment",  "EMPTY", ` /* snapshot is audit-only;\n never block the sync */ `],
  ["comment-with-apostrophe",  "EMPTY", ` /* don't block the caller */ `],
  ["jsdoc-only",               "EMPTY", ` /** nothing to do */ `],

  ["logs-the-error",           "CODE",  ` logger.error(e); `],
  ["rethrows",                 "CODE",  ` throw e; `],
  ["code-after-line-comment",  "CODE",  ` // best effort\n retry(); `],
  // DANGEROUS direction, the bug the old private stripper carried: a `//` inside
  // a string is not a comment. Deleting to end-of-line here erases the only
  // statement in the body and the handler reads as an empty swallow.
  ["url-in-string",            "CODE",  ` report("https://x.co"); `],
  ["block-open-in-string",     "CODE",  ` note("/*"); `],
];

let pass = 0;
const fail = [];
for (const [id, truth, body] of BODIES) {
  let got;
  try { got = normalizeBody(body) === "" ? "EMPTY" : "CODE"; }
  catch (e) { got = `THREW(${e.message})`; }
  if (got === truth) pass++;
  else fail.push(`  ${id}: expected ${truth}, got ${got}  (normalized: ${JSON.stringify(normalizeBody(body))})`);
}

// The `.catch(...)` expression forms that discard the error without a block.
const EXPRESSIONS = [
  ["null",        true,  `null`],
  ["undefined",   true,  `undefined`],
  ["void-0",      true,  `void 0`],
  ["void-ident",  true,  `void ignore`],
  ["comment-expr",true,  `/* parse fallback */`],
  ["real-call",   false, `logger.error(e)`],
  ["value",       false, `fallbackValue`],
];
for (const [id, truth, expr] of EXPRESSIONS) {
  const got = isEmptyCatchExpression(normalizeBody(expr));
  if (got === truth) pass++;
  else fail.push(`  expr-${id}: expected ${truth}, got ${got}`);
}

const total = BODIES.length + EXPRESSIONS.length;
if (fail.length) {
  console.error(`[empty-body] ❌ ${pass}/${total}\n${fail.join("\n")}`);
  console.error(`\n  A comment-only handler body MUST read as empty. If it does not,`);
  console.error(`  check-empty-catch has gone blind to 29 real swallows in supabase/functions`);
  console.error(`  and will exit 0 telling you to lower its baseline. Do not lower it.`);
  process.exit(1);
}
console.log(`[empty-body] ✅ ${pass}/${total} ground-truth handler bodies`);
