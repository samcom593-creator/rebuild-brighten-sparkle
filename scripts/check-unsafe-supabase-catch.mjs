#!/usr/bin/env node
// Fails the build if any edge function chains `.catch()` directly onto a
// Supabase QueryBuilder. The builder is a thenable but does NOT expose
// `.catch` — calling it throws `sb.from(...).insert(...).catch is not a
// function` at runtime, silently breaking the function.
//
// Memory: agentlink-cookie-sync hit this 2026-05-20 — 102 error rows + 189
// orphan "running" rows in agentlink_sync_log before detection. Same pattern
// previously bit InsuraCloud sync (memory: project_apex_2026_05_18_insuracloud_auth_dead).
//
// SAFE patterns we explicitly allow:
//   - fetch(...).catch(...)
//   - resend.emails.send(...).catch(...)
//   - supabase.functions.invoke(...).catch(...)
//   - req.json().catch(...)
//   - res.json().catch(...)
//   - .rpc(...).then(...).catch(...)  ← explicit .then BEFORE .catch
//
// UNSAFE patterns this script flags:
//   - sb.from("x").insert({...}).catch(...)
//   - sb.from("x").update({...}).catch(...)
//   - sb.from("x").delete().catch(...)
//   - sb.from("x").upsert({...}).catch(...)
//   - sb.from("x").select(...).catch(...)   (no .then before)
//   - sb.rpc("fn", {...}).catch(...)        (no .then before)
//
// MP-547 — WHY THIS NO LONGER USES A LINE WINDOW. The original scan looked
// back a fixed SIX lines from `.catch` for the builder verb. An ordinary
// Supabase insert is longer than that: applicant-checkin wrote a nine-field
// agent_tasks payload, so `.from("agent_tasks")` sat TEN lines above its
// `.catch` and this guard printed "ok — no unsafe .catch chains" against the
// real, live bug sitting in its own scan root. PROVEN by re-running the old
// scan against that exact pre-fix file. Only 5 of the 91 `).catch` lines in
// supabase/functions have their nearest preceding builder verb inside six
// lines, so the reach was shorter than the code it was written to read.
//
// The window is replaced by resolving the actual member chain: from the `.`
// of `.catch`, walk backwards balancing (), [] and {} to the head of the
// expression, then judge THAT. Distance stops mattering, which is the point —
// a guard whose reach is a line count is guessing at syntax.
//
// Promise.resolve(builder).catch(...) is SAFE and must stay safe: it is the
// idiom the correct call sites in src/ already use.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const fnDir = path.join(repoRoot, "supabase/functions");

if (!fs.existsSync(fnDir)) {
  console.log("[check-unsafe-supabase-catch] no functions dir — skipping");
  process.exit(0);
}

const violations = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      scan(full);
    }
  }
}

// Verb of a Supabase builder call we want to track
const VERB_RE = /\b(?:from|rpc)\s*\(/;
// Catches `.<op>(... arbitrary ...).catch(` on a chain that started with .from() or .rpc()
const CHAIN_OP_RE = /\.(insert|update|upsert|delete|select|maybeSingle|single)\b/;

// Blank out comment and string bodies while preserving offsets, so a `.catch`
// written in prose or inside a SQL template literal cannot be mistaken for
// code. (MP-277: a scanner that reads raw source counts its own footnotes.)
function blankCommentsAndStrings(src) {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      let j = src.indexOf("\n", i);
      if (j < 0) j = n;
      for (let k = i; k < j; k++) out[k] = " ";
      i = j;
    } else if (c === "/" && src[i + 1] === "*") {
      let j = src.indexOf("*/", i + 2);
      j = j < 0 ? n : j + 2;
      for (let k = i; k < j; k++) if (src[k] !== "\n") out[k] = " ";
      i = j;
    } else if (c === '"' || c === "'" || c === "`") {
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === q) { j += 1; break; }
        j += 1;
      }
      for (let k = i + 1; k < Math.min(j - 1, n) + 1; k++) {
        if (k < n && src[k] !== "\n") out[k] = " ";
      }
      i = j;
    } else {
      i += 1;
    }
  }
  return out.join("");
}

// Walk backwards from `idx` (the `.` of `.catch`) to the head of the member
// chain, balancing brackets. Returns the chain text.
function chainHead(src, idx) {
  let i = idx - 1;
  let depth = 0;
  while (i >= 0) {
    const c = src[i];
    if (c === ")" || c === "]" || c === "}") depth += 1;
    else if (c === "(" || c === "[" || c === "{") {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && (c === ";" || c === "=" || c === ",")) break;
    i -= 1;
  }
  return src.slice(i + 1, idx);
}

function scan(file) {
  const text = fs.readFileSync(file, "utf8");
  const code = blankCommentsAndStrings(text);
  const re = /\.catch\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const head = chainHead(code, m.index);

    // Must be a Postgrest builder chain at all.
    if (!VERB_RE.test(head)) continue;
    if (!CHAIN_OP_RE.test(head) && !/\.\s*rpc\s*\(/.test(head)) continue;

    // Already converted to a real Promise — safe.
    if (/\.then\s*\(/.test(head)) continue;
    if (/Promise\s*\.\s*(resolve|all|allSettled|race)\s*\(/.test(head)) continue;

    // Non-Postgrest receivers that legitimately return real Promises.
    if (/\.functions\s*\.\s*invoke\s*\(/.test(head)) continue;
    if (/\.\s*(auth|storage)\s*\./.test(head)) continue;
    if (/\bfetch\s*\(/.test(head)) continue;
    if (/\.\s*(json|text)\s*\(\s*\)\s*$/.test(head.trimEnd())) continue;
    if (/\.emails\s*\.\s*send\s*\(/.test(head)) continue;

    const line = code.slice(0, m.index).split("\n").length;
    violations.push({
      file: path.relative(repoRoot, file),
      line,
      snippet: (text.split("\n")[line - 1] ?? "").trim(),
    });
  }
}

walk(fnDir);

if (violations.length) {
  console.error("\n[check-unsafe-supabase-catch] BLOCKED — unsafe .catch() chained on a Supabase QueryBuilder.");
  console.error("Supabase QueryBuilder has no .catch() — replace with await + try/catch.\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.snippet}`);
  }
  console.error("\nFix template:");
  console.error("  try { await sb.from(\"x\").insert({...}); } catch (_err) { /* non-fatal */ }\n");
  process.exit(1);
}

console.log(`[check-unsafe-supabase-catch] ok — scanned ${fnDir}, no unsafe .catch chains.`);
