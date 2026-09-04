#!/usr/bin/env node
/**
 * check-ilike-user-input.mjs — MP-422
 *
 * WHAT THIS GRADES
 * `.ilike(column, value)` where `value` is an expression rather than an
 * author-written literal. PostgREST's .ilike() is a LIKE pattern match, so every
 * metacharacter in the value is interpreted instead of compared. MP-277 proved
 * this against live prod and shipped _shared/like-escape.ts; MP-422 found the
 * sweep had missed the two endpoints where it mattered most.
 *
 * WHY A GUARD AND NOT JUST THE FIX
 * simple-login was `verify_jwt = false` and returned a magic-link tokenHash on
 * match. Re-proven read-only on 2026-09-04: `email ilike '%'` matched 628 of 628
 * profiles; `ilike '\%'` matched 0. A single "%" as the identifier selected the
 * newest profile and minted a session as that person, unauthenticated. Every
 * other identity lookup in the repo (add-agent, claim-account, xcel-import,
 * create-new-agent-account, apex-outbox-dispatcher, send-batch-blast,
 * resolve-ref-slug) already used the helper. One file out of eight escaped, and
 * nothing went red — so the class needs an owner, not another one-time sweep.
 *
 * KEYED ON IDENTITY, NOT ON A COUNT
 * MP-356 and MP-357: a count-only floor is fungible. A real regression can sit
 * red until an unrelated pay-down absorbs it, and a brand-new endpoint with no
 * escaping at all passes green so long as the total does not rise. So the
 * baseline is a SET of `file::column::argument` keys. A key not in the baseline
 * fails, whatever the total. Keys that disappear are reported as paid down.
 *
 * WHAT THIS DOES NOT GRADE, ON PURPOSE
 *  - String-literal patterns (`.ilike("full_name", "%obiajulu%")`). Those are the
 *    author asking for a pattern, which is what .ilike() is for.
 *  - The `.or("phone.ilike.%" + x + "%")` filter-string form. It is a different
 *    shape (PostgREST filter injection, not LIKE escaping) and no site in the
 *    repo currently feeds it anything but digits. Naming it here so the next
 *    reader knows it was considered and left, rather than missed.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["supabase/functions", "src"];
const BASELINE = "scripts/data/ilike-user-input-baseline.json";
const SAFE_WRAPPERS = ["emailPattern", "escapeLikePattern", "likeLiteral"];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e === "dist") continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p) && !/\.test\.ts$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Blank comments only. MP-277's footnote bug: scanning raw source counted
 * `.ilike()` written inside a comment as a call site, so a wave could trade a
 * real violation for a phantom and hold the number flat. String bodies are NOT
 * blanked — the argument text is exactly what this guard has to read.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/**
 * Blank the BODY of every string literal, keeping quotes and offsets.
 *
 * Detection reads this masked copy; the argument text is then sliced out of the
 * ORIGINAL. Both halves are needed and they pull opposite ways: MP-277 recorded
 * that blanking strings made every table name look like a variable, and MP-422's
 * own first cut skipped masking entirely and flagged `.ilike(\"email\", email)`
 * inside src/data/shipped-data.ts — MP-277's changelog prose describing this very
 * bug. A guard that counts its own documentation lets a wave trade a real
 * violation for a phantom and hold the total flat while the code gets worse.
 */
function maskStrings(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      out += ch;
      i++;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === "\\") { out += "  "; i += 2; continue; }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < src.length) { out += ch; i++; }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Read the second argument with balanced parentheses. A non-greedy `.*?\)` stops
 * at the first close paren, which truncates `escapeLikePattern(x)` mid-call and
 * makes correctly-escaped code look bare.
 */
function readArgs(src, openIdx) {
  let depth = 0, i = openIdx, argStart = openIdx + 1;
  const parts = [];
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) { parts.push(src.slice(argStart, i)); return parts; } }
    else if (c === "," && depth === 1) { parts.push(src.slice(argStart, i)); argStart = i + 1; }
  }
  return null;
}

const isLiteral = (t) => /^["'`]/.test(t);
const isWrapped = (t) => SAFE_WRAPPERS.some((w) => t.startsWith(w + "("));

/**
 * An argument is safe when EVERY branch of it is safe. `x ? emailPattern(x) : "lit"`
 * is escaped on both sides; a startsWith() test alone reads it as bare and would
 * push a wave to baseline correct code — MP-357's "turn the gate green by
 * allowlisting a bystander", which is how a real regression hides.
 */
function argIsSafe(arg) {
  // In `cond ? a : b` only a and b reach the query — the condition is not a value.
  // Counting it as one marked correctly-escaped ternaries as violations.
  const values = arg.includes("?") ? arg.slice(arg.indexOf("?") + 1) : arg;
  const branches = values.split(/:|\|\||&&/).map((t) => t.trim()).filter(Boolean);
  if (!branches.length) return false;
  return branches.every((b) => isLiteral(b) || isWrapped(b));
}

const findings = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = stripComments(readFileSync(file, "utf8"));
    const masked = maskStrings(src);
    const re = /\.ilike\(/g;
    let m;
    while ((m = re.exec(masked))) {
      const openIdx = m.index + ".ilike".length;
      const parts = readArgs(masked, openIdx);
      if (!parts || parts.length < 2) continue;
      // offsets match between copies; read the real text back out of the source
      let off = openIdx + 1;
      const real = parts.map((t) => { const v = src.slice(off, off + t.length); off += t.length + 1; return v.trim(); });
      const column = real[0];
      const arg = real.slice(1).join(",").trim();
      if (argIsSafe(arg)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      findings.push({ key: `${file}::${column}::${arg}`, file, line, column, arg });
    }
  }
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { keys: [] };
const known = new Set(baseline.keys);
const seen = new Set(findings.map((f) => f.key));

if (process.argv.includes("--write-baseline")) {
  writeFileSync(BASELINE, JSON.stringify({ keys: [...seen].sort() }, null, 2) + "\n");
  console.log(`baseline written: ${seen.size} tolerated site(s)`);
  process.exit(0);
}

const added = findings.filter((f) => !known.has(f.key));
const paidDown = [...known].filter((k) => !seen.has(k));

console.log(`check:ilike-user-input — ${findings.length} unescaped site(s), ${known.size} baselined`);
for (const k of paidDown) console.log(`  paid down: ${k}`);

if (added.length) {
  console.error(`\nFAIL — ${added.length} .ilike() site(s) pass an unescaped value:\n`);
  for (const f of added) {
    console.error(`  ${f.file}:${f.line}  .ilike(${f.column}, ${f.arg})`);
  }
  console.error(`\n.ilike() is a LIKE pattern, not a case-insensitive equals. A "%" in the`);
  console.error(`value matches every row. Wrap it: emailPattern(x) for emails, likeLiteral(x)`);
  console.error(`otherwise — supabase/functions/_shared/like-escape.ts. If the pattern is`);
  console.error(`deliberate, make it a string literal so it reads as intentional.\n`);
  process.exit(1);
}
console.log("PASS");
