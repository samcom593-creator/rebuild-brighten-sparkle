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

function scan(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  // Use a sliding window of the previous 6 lines to handle multi-line chains.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\)\s*\.catch\b/.test(line)) continue;
    // Look back up to 6 lines for a Supabase builder verb + a chain op
    const window = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
    if (!VERB_RE.test(window)) continue;
    if (!CHAIN_OP_RE.test(window)) continue;
    // Allow `.then(...).catch(...)` — explicit .then converts to real Promise
    if (/\.then\s*\([^)]*\)\s*\.catch\b/.test(line)) continue;
    // Allow patterns where .catch is on `fetch(`/`res.json(`/`req.json(`/`Resend`
    if (/(?:fetch\(|\.json\(\)\s*\.catch|\.invoke\([^)]*\)\s*\.catch|\.emails\.send\([^)]*\)\s*\.catch)/.test(window.split("\n").pop() ?? "")) continue;
    // Allow .catch in a string template (raw SQL embedded RPC arg)
    if (/`[^`]*\.catch[^`]*`/.test(line)) continue;
    violations.push({ file: path.relative(repoRoot, file), line: i + 1, snippet: line.trim() });
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
