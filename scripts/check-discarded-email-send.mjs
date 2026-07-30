#!/usr/bin/env node
// Bans NEW `await resend.emails.send({...})` calls that discard the return value.
//
// THE DEFECT. The Resend SDK v2 does not throw on API errors — it resolves with
// `{ data, error }`. So this:
//
//     await resend.emails.send({ ... });
//     return new Response(JSON.stringify({ success: true }));
//
// reports success for a send that never left the building. A surrounding try/catch does
// not help: nothing is thrown. The only way to know is to read `error` (and `data.id`).
//
// This is not hypothetical. On 2026-07-30 the provider account was under review and
// rejecting every external recipient, while send-agent-portal-login returned
// `success: true` and send-bulk-portal-logins incremented `results.sent` for each one.
// A bulk run could report "42 sent" having delivered zero.
//
// Same family as the 465 fake-success InsuraCloud rows and the 198 AgentLink zombie rows:
// a write that reports success without checking whether it happened.
//
// THE FIX at each site:
//     const { data, error } = await resend.emails.send({ ... });
//     if (error || !data?.id) { /* record the failure, do not count it as sent */ }
//
// BASELINE. 100 pre-existing sites across 68 edge functions as of 2026-07-30, measured by
// this script itself. (A cruder shell count first said 126/87 — it double-counted
// multi-line call forms. Trust the script.) That is too
// many to hand-verify in one pass — each needs its own decision about what "failed" means
// for that flow (return 502? mark the queue row? skip the counter?). So this gate locks the
// number and lets it be paid down, the same way check-tsc-error-count and
// check-empty-catch work here. New ones fail the commit.
//
// Lower the baseline whenever you fix some. Never raise it.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const SCAN_DIR = path.join(repoRoot, "supabase/functions");
const BASELINE = 100;

// `await resend.emails.send(` NOT preceded by a destructure/assignment on the same line.
const SEND_RX = /await\s+resend\s*\.\s*emails\s*\.\s*send\s*\(/;
const CAPTURED_RX = /(?:const|let|var)\s*[\{\w][^=]*=\s*await\s+resend\s*\.\s*emails\s*\.\s*send\s*\(/;
const ALLOW_RX = /discarded-email-send-allow/;

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|js)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const hits = [];
for (const file of walk(SCAN_DIR)) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!SEND_RX.test(line)) continue;
    if (CAPTURED_RX.test(line)) continue;
    const prev = i > 0 ? lines[i - 1] : "";
    if (ALLOW_RX.test(line) || ALLOW_RX.test(prev)) continue;
    hits.push({ file: path.relative(repoRoot, file), line: i + 1, snippet: line.trim().slice(0, 110) });
  }
}

const count = hits.length;
const fnCount = new Set(hits.map((h) => h.file)).size;

if (count <= BASELINE) {
  console.log(
    `✓ check:discarded-email-send — ${count}/${BASELINE} discarded resend.emails.send calls across ${fnCount} functions`,
  );
  if (count < BASELINE) {
    console.log(
      `  Ratchet drop available: lower BASELINE from ${BASELINE} to ${count} in scripts/check-discarded-email-send.mjs`,
    );
  }
  process.exit(0);
}

console.error(
  `\n✗ check:discarded-email-send — ${count} discarded sends exceeds baseline ${BASELINE} (Δ +${count - BASELINE})\n`,
);
console.error("The Resend SDK v2 does NOT throw on API errors — it resolves with");
console.error("{ data, error }. Discarding that tuple means a rejected send is reported as");
console.error("a successful one, and a try/catch around it will never fire.\n");
console.error("Capture and check it:");
console.error("  const { data, error } = await resend.emails.send({ ... });");
console.error("  if (error || !data?.id) { /* record the failure — do not count it sent */ }\n");
console.error("Newest hits (showing up to 10):");
for (const h of hits.slice(-10)) {
  console.error(`  ${h.file}:${h.line}`);
  console.error(`    ${h.snippet}`);
}
console.error(
  "\nIf a send genuinely is fire-and-forget, tag the line `discarded-email-send-allow:<reason>`.",
);
process.exit(1);
