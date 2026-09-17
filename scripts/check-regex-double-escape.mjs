#!/usr/bin/env node
// check-regex-double-escape — MP-553 (2026-09-16)
//
// v.email() in supabase/functions/_shared/validate.ts rejected 11 of 11 valid
// addresses for its entire life. The pattern LOOKED right at a glance:
//     /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
// It is a regex LITERAL, so every `\\` is an escaped backslash — a literal
// backslash — not the start of a shorthand class. Two separate faults:
//
//   [^\\s@]  inside a character class this reads "not backslash, not the
//            LETTER s, not @". bob@x.co passed it; sam@x.co did not. It also
//            ADMITS whitespace, so "a b@c.com" was accepted as valid.
//   \\.      outside a class, backslash-then-any-char: the pattern demanded a
//            real backslash somewhere in the address. This took accept to 0.
//
// WHY A GUARD AND NOT JUST A FIX: this is invisible to every other check in the
// repo. It type-checks, it lints, it bundles, it deploys, and at runtime it
// simply says no. The defect had zero callers, so nothing went red — it was a
// landmine in the module every handler imports, waiting for the first adopter.
//
// ── THE DISTINCTION THIS GUARD IS BUILT ON ──────────────────────────────────
// `\\s` is CORRECT in a string and WRONG in a regex literal:
//     new RegExp("[^\\s@]+")   // correct: the string delivers \s to the parser
//     /[^\\s@]+/               // wrong:   the parser sees a literal backslash
// So the scan must run on regex literals ONLY. Blanking string and template
// bodies is therefore load-bearing, not incidental — a scanner that reads raw
// source flags every correct `new RegExp("\\d")` in the repo, and it also reads
// bugs out of its own prose (MP-277 shipped exactly that footnote bug, and
// MP-399's sampler matched a value out of its own comment). Comments are
// stripped with the repo's shared lexer so this guard and its siblings agree.
//
// ── WHAT IS DELIBERATELY *NOT* FLAGGED ──────────────────────────────────────
// `\\` in a literal is often exactly right — it is how you match a backslash:
//     .replace(/\\/g, "\\\\")            // onboarding-call-invites, ICS escaping
//     /replace\(\s*\/\\D/                // check-phone-display-format, which
//                                        // matches SOURCE TEXT containing \D
// Both are correct and both must stay green, or this becomes a guard people
// route around. The rule below is therefore narrow and evidence-backed:
//
//   RULE A  `\\` + [sdwSDWb] INSIDE a character class.
//           `[\\s]` means "a backslash, or the letter s". No author means that.
//           To mean "backslash or whitespace" you write `[\\\s]`; to mean just
//           a backslash you write `[\\]`. So this spelling is unambiguous
//           evidence of the double-escape bug, never a deliberate choice.
//
//   RULE B  `\\.` anywhere in a regex literal.
//           Backslash-then-any-char. Almost always a mis-transcribed `\.`.
//           If a literal backslash followed by any character is genuinely
//           meant, write `\\[\s\S]` or add the path to ALLOW below WITH a
//           comment naming what it matches — do not widen the rule.
//
// Measured on this repo at authoring time: 1 hit (the bug) and 0 false
// positives across 1,178 scanned files. Verified green after the fix, and
// mutation-proven in both directions.
//
// Run: node scripts/check-regex-double-escape.mjs
import { readFileSync } from "node:fs";
import { walk, stripComments } from "./lib/scan-utils.mjs";

const ROOTS = ["supabase/functions", "src", "scripts"];
const EXT = /\.(ts|tsx|mjs|js)$/;

/** Paths whose `\\` really does mean "match a backslash". Each needs a reason. */
const ALLOW = new Map([
  // (empty at MP-553 — both known-legitimate sites use spellings the rules
  //  below do not match, which is the point of keeping the rules narrow.)
]);

/**
 * Blank the bodies of string and template literals, leaving quotes and length
 * intact so reported line/column numbers stay true. Regex literals are left
 * alone — they are the thing being scanned.
 */
function blankStringBodies(code) {
  const out = code.split("");
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < n) {
        if (code[i] === "\\") { out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (code[i] === quote) break;
        if (code[i] !== "\n") out[i] = " ";
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** Yield {body, index} for each regex literal in already-stripped code. */
function* regexLiterals(code) {
  // A `/` starts a regex only in an operand position. Approximated by the
  // preceding non-space character, the same heuristic the shared lexer uses.
  const PRECEDES = new Set(["=", "(", ",", ":", "!", "&", "|", "?", "{", "}", ";", "[", "+", "*", "%", "<", ">", "~", "^", "\n", undefined]);
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== "/") continue;
    let j = i - 1;
    while (j >= 0 && /\s/.test(code[j])) j--;
    const prev = j >= 0 ? code[j] : undefined;
    if (!PRECEDES.has(prev)) continue;
    if (code[i + 1] === "/" || code[i + 1] === "*") continue;
    // scan to the closing slash, tracking char classes
    let k = i + 1, inClass = false, body = "";
    for (; k < code.length; k++) {
      const c = code[k];
      if (c === "\n") { body = null; break; }
      if (c === "\\") { body += c + (code[k + 1] ?? ""); k++; continue; }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
      body += c;
    }
    if (body === null || k >= code.length || body.length === 0) continue;
    yield { body, index: i };
    i = k;
  }
}

function classRanges(body) {
  const ranges = [];
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") { i++; continue; }
    if (body[i] === "[") start = i;
    else if (body[i] === "]" && start >= 0) { ranges.push([start, i]); start = -1; }
  }
  return ranges;
}

const findings = [];
let scanned = 0;

for (const root of ROOTS) {
  let files;
  try { files = walk(root); } catch { continue; }
  for (const file of files) {
    if (!EXT.test(file) || file.includes("node_modules")) continue;
    if (ALLOW.has(file)) continue;
    // The specimen itself is quoted verbatim in its own regression test, which
    // is the one place the broken pattern must survive.
    if (file.endsWith("validate.email.test.ts")) continue;
    scanned++;
    const raw = readFileSync(file, "utf8");
    const code = blankStringBodies(stripComments(raw));
    const lineOf = (idx) => code.slice(0, idx).split("\n").length;
    for (const { body, index } of regexLiterals(code)) {
      const classes = classRanges(body);
      const inAnyClass = (off) => classes.some(([a, b]) => off > a && off < b);
      for (const m of body.matchAll(/\\\\([sdwSDWb.])/g)) {
        const tok = m[1];
        const inClass = inAnyClass(m.index);
        let rule = null;
        if (inClass && tok !== ".") rule = "A";
        else if (tok === ".") rule = "B";
        if (!rule) continue;
        findings.push({
          file, line: lineOf(index), rule,
          token: `\\\\${tok}`,
          detail: rule === "A"
            ? `inside a character class, \\\\${tok} means "a backslash, or the letter ${tok}" — write \\${tok}`
            : `\\\\. is backslash-then-any-char — write \\. for a literal dot`,
          snippet: `/${body.slice(0, 70)}${body.length > 70 ? "…" : ""}/`,
        });
      }
    }
  }
}

if (findings.length) {
  console.error(`\ncheck-regex-double-escape: ${findings.length} double-escaped regex literal(s)\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [rule ${f.rule}]  ${f.token}`);
    console.error(`      ${f.snippet}`);
    console.error(`      ${f.detail}\n`);
  }
  console.error("A regex LITERAL is not a string: `\\\\s` is a literal backslash, not whitespace.");
  console.error("This is invisible to tsc, the linter and the bundler — it fails only at runtime,");
  console.error("by silently refusing input. See supabase/functions/_shared/validate.email.test.ts.\n");
  process.exit(1);
}

console.log(`check-regex-double-escape: OK (${scanned} files, 0 double-escaped regex literals)`);
