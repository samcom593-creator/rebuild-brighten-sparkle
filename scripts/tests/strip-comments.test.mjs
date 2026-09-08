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

  // MP-482: a regex literal is code and its body may hold a quote or a `//`.
  // Without a regex rule the quote opened a phantom string and every comment
  // downstream survived -- the apostrophe bug through a different door. Measured
  // at 56 files / 689 real comment lines before the fix.
  ["regex-dquote-then-comment",   "STRIPPED", `const e = s.replace(/"/g, "&quot;");\n// MARK\n`],
  ["regex-squote-then-comment",   "STRIPPED", `const e = s.replace(/'/g, "&#39;");\n// MARK\n`],
  ["regex-backtick-then-comment", "STRIPPED", 'const e = s.replace(/[`>#]/g, "x");\n// MARK\n'],
  ["regex-quote-keeps-template",  "STRIPPED", 'const e = s.replace(/"/g, "&q;");\nconst h = `<p>hi</p>`;\n// MARK\n'],
  // DANGEROUS direction. `/^https:\\/\\//i` carries a literal `//`; reading that as
  // a line comment blanked 105 chars of real code (contracting-delivery.ts:88).
  // This is why the regex rule may NOT be narrowed to bodies containing a quote.
  ["regex-with-escaped-slashes",  "SURVIVED", `const ok = /^https:\\/\\//i.test(u); const b = MARK;\n`],
  // DANGEROUS direction, and the exact regression this fix caused in its own first
  // cut. Verbatim from InsuraCloudHealthAlert.tsx:97-101. JSX prose sits in CODE
  // state, so the `<` of every closing tag (`</code>`) preceded a `/` and made it
  // look like a regex start; the mis-scan desynchronised the lexer and ate
  // `//replit.com/~" title="..."` out of a real href. Bisected to `<` specifically:
  // `~`, `>`, `?`, `{`, `}`, `+`, `-`, `*`, `%` and `^` were each re-added alone and
  // NONE reproduce it. A shorter hand-written fixture does not reproduce either --
  // the desync needs this much accumulated state, which is why it is quoted whole.
  ["jsx-close-tag-eats-href",     "SURVIVED", `            Single action to fix: drop the real <code className="px-1 py-0.5 rounded bg-card/60 text-amber-300 text-[10px]">SAMUEL_JAMES_API_TOKEN</code> at <code className="px-1 py-0.5 rounded bg-card/60 text-amber-300 text-[10px]">~/.config/apex-creds/insuracloud.token</code>. Edge fn now writes <code className="px-1 py-0.5 rounded bg-card/60 text-amber-300 text-[10px]">auth_failed</code> instead of fake success — once the token is real, sync_log starts logging the truth.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://replit.com/~" title="MARK"
`],
  // Division is not a regex, and must not be consumed as one.
  ["division-not-regex",          "SURVIVED", `const r = total / count / 2;\nconst b = MARK;\n`],
  ["division-then-comment",       "STRIPPED", `const r = total / count;\n// MARK\n`],
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
