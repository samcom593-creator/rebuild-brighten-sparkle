#!/usr/bin/env node
/**
 * MP-416 — fixed-position phone formatting must live in src/lib/phone.ts.
 *
 * THE BUG THIS EXISTS FOR: src/pages/WhaleRecruiting.tsx formatted a phone by
 * slicing positions 0-3/3-6/6-10 behind a `digits.length >= 10` gate. That is
 * correct only at exactly 10. 45 of the 50 rows the page loads are stored
 * `+1XXXXXXXXXX`, so `+16184381249` rendered as "(161) 843-8124" — shifted one
 * place left, last digit dropped — and a UK number rendered as a plausible US
 * one, "(447) 911-1234". Nothing on screen said it was wrong, and the href
 * beside it was correct, so clicking worked and only the number a human reads
 * was wrong. Five sibling formatters had independently written the correct
 * logic; the sixth drifted. Duplication is what allowed the drift, so the fix
 * was to single-source it and the guard is to keep it single-sourced.
 *
 * TWO LEGS:
 *   A. No `>=`-gated fixed-position phone formatting anywhere. `>= 10` with
 *      10-digit positions is never correct; this is the exact mutation.
 *   B. No local fixed-position phone DISPLAY formatter outside src/lib/phone.ts.
 *
 * HOW LEG B TELLS A DISPLAY FORMATTER FROM AN INPUT MASK, without an allowlist
 * (an allowlist can be turned green by exempting a bystander — MP-357): an
 * input mask formats as the user types, so it must handle partial input and
 * always carries a short-input branch (`<= 3`, `<= 6`, `< 4`, `< 7`). A display
 * formatter renders stored data and has none. The discriminator is derived from
 * the code's own shape, so a new mask is exempt automatically and a new display
 * formatter is caught automatically.
 *
 * WHAT THIS DOES NOT COVER, stated rather than implied: it does not check that a
 * formatter is CALLED with the right value, does not follow a digit string
 * across function boundaries, and does not grade server-side (supabase/functions)
 * or SQL-side formatting. It greps structure, not dataflow.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const LIB = "src/lib/phone.ts";
const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { encoding: "utf8" })
  .split("\n").filter(Boolean);

// Strip line comments and block comments so prose describing this bug is never
// matched as code (MP-277: a guard that scans raw source counts its own footnotes).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

const SLICE_TRIPLE = /\.slice\(\s*0\s*,\s*3\s*\)[\s\S]{0,120}?\.slice\(\s*3\s*,\s*6\s*\)[\s\S]{0,120}?\.slice\(\s*6/;
const GE_GATE = /\.length\s*(?:>=\s*10|>\s*9)\b/;
const PARTIAL_BRANCH = /\.length\s*(?:<=\s*[36]|<\s*[47])\b/;
const DIGIT_STRIP = /replace\(\s*\/\\D/;

const violations = [];
let graded = 0;

for (const f of files) {
  if (f === LIB) continue;
  const raw = readFileSync(f, "utf8");
  const src = stripComments(raw);
  if (!SLICE_TRIPLE.test(src)) continue;

  // Split into rough function bodies so a mask in one function does not excuse a
  // display formatter in another file-mate.
  const bodies = src.split(/\n(?=(?:export\s+)?(?:async\s+)?function |\s*const \w+\s*=\s*\()/);
  for (const body of bodies) {
    if (!SLICE_TRIPLE.test(body)) continue;
    if (!DIGIT_STRIP.test(body) && !/phone|Phone/.test(body)) continue;
    graded++;
    const name = (body.match(/function (\w+)|const (\w+)\s*=/) || [])[1]
      || (body.match(/const (\w+)\s*=/) || [])[1] || "(anonymous)";
    if (GE_GATE.test(body)) {
      violations.push({ f, name, leg: "A", why: "fixed-position phone formatting behind a `>=` length gate — correct only at exactly 10" });
    } else if (!PARTIAL_BRANCH.test(body)) {
      violations.push({ f, name, leg: "B", why: "local phone DISPLAY formatter (no partial-input branch, so not a mask) — use formatPhoneDisplay from @/lib/phone" });
    }
  }
}

console.log(`check:phone-display-format — graded ${graded} fixed-position phone formatter(s) outside ${LIB}`);
if (violations.length) {
  for (const v of violations) console.log(`  VIOLATION [leg ${v.leg}] ${v.f} :: ${v.name} — ${v.why}`);
  console.log(`\n${violations.length} violation(s).`);
  process.exit(1);
}
console.log("OK — no >=-gated formatting, no display formatter outside the library.");
