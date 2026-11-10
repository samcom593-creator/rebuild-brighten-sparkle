#!/usr/bin/env node
// check-scheduling-links — WP2 (onboarding audit 2026-11-10). Two ratchets, run by
// .husky/pre-commit and verify:core.
//
// 1. SCHEDULING SLUGS. A 'calendly.com/apexfinancialempire/' literal may live only in
//    src/lib/apexConfig.ts and supabase/functions/_shared/scheduling-links.ts (held equal by
//    src/tests/config/schedulingLinksParity.test.ts). The same lifecycle step had three
//    different links because the slug was typed into eight senders: the page embedded one
//    licensed event, the welcome email and seminar-confirmation another, and outreach
//    templates sent UNLICENSED recruits the licensed call, whose booking auto-flips
//    license_status. Files owned by other work packages still hold literals; they are
//    baselined by count and may only go down.
//
// 2. COST CLAIMS. Sam has not said who pays for the pre-licensing course (AUDIT N1). Six
//    surfaces said "Galaxy pays it" / "we cover the course" / "we reimburse" while the
//    confirmation page said "buy the course". Every surface now renders LICENSING_COST
//    (neutral). A new "we cover / we pay / Galaxy pays / course on us / no upfront cost"
//    phrase fails here. The two LICENSING_COST source files are exempt: their comments
//    quote the retired claims on purpose.
//
// Scope: src/, supabase/functions/, api/ (.ts .tsx .js .mjs). Tests and the shipped-history
// banner are not user surfaces and are skipped. Counting is per line.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ROOTS = ["src", "supabase/functions", "api"];
const EXT = /\.(tsx?|jsx?|mjs)$/;
const SKIP = (rel) =>
  rel === "src/data/shipped-data.ts" ||
  rel.startsWith("src/tests/") ||
  /\.test\.(tsx?|jsx?|mjs)$/.test(rel) ||
  rel.includes("/node_modules/");

const SLUG_RE = /calendly\.com\/apexfinancialempire\//;
const SLUG_OWNERS = new Set(["src/lib/apexConfig.ts", "supabase/functions/_shared/scheduling-links.ts"]);
// Measured 2026-11-10 after WP2 swept its own files to 0. Other packages own these.
const SLUG_BASELINE = {
  "src/components/instagram/igCopy.ts": 1,
  "supabase/functions/manychat-webhook/index.ts": 2,
  "supabase/functions/notify-low-close-rate/index.ts": 1,
  "supabase/functions/notify-missed-dialer/index.ts": 1,
  "supabase/functions/notify-no-deal-today/index.ts": 1,
  "supabase/functions/outreach-sender/index.ts": 1,
  "supabase/functions/send-abandoned-followup/index.ts": 1,
  "supabase/functions/send-calendly-invite/index.ts": 1,
  "supabase/functions/send-candidate-confirmation/email.ts": 1,
  "supabase/functions/test-email-flows/index.ts": 6,
  "supabase/functions/welcome-new-agent/index.ts": 1,
};

const COST_RES = [
  /\bwe (cover|pay for|reimburse)\b[^.<\n"`]{0,40}?\b(cost|course|licens|fee|exam|this)/i,
  /\b(galaxy|apex) (pays|covers)\b/i,
  /\bcourse on us\b/i,
  /\bno upfront (course|cost|payment|fee)/i,
];
const COST_OWNERS = new Set(["src/lib/apexConfig.ts", "supabase/functions/_shared/licensing-cost.ts"]);
// send-licensing-instructions is WP7's file, send-followup-emails is WP3's (both handed off
// in the WP2 receipt); test-email-flows is a staff-only test sender.
const COST_BASELINE = {
  "supabase/functions/send-followup-emails/index.ts": 1,
  "supabase/functions/send-licensing-instructions/index.ts": 1,
  "supabase/functions/test-email-flows/index.ts": 3,
};

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(abs, out);
    } else if (EXT.test(name)) {
      out.push(abs);
    }
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(ROOT, r), []))
  .map((abs) => relative(ROOT, abs).split("\\").join("/"))
  .filter((rel) => !SKIP(rel));

if (files.length < 50) {
  // A walk that found almost nothing graded nothing. Never report that as clean.
  console.error(`✗ check:scheduling-links — only ${files.length} files found under ${ROOTS.join(", ")}; refusing to grade.`);
  process.exit(1);
}

const slugCounts = {};
const costCounts = {};
const costHits = [];
const slugHits = [];
for (const rel of files) {
  const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!SLUG_OWNERS.has(rel) && SLUG_RE.test(line)) {
      slugCounts[rel] = (slugCounts[rel] ?? 0) + 1;
      slugHits.push(`${rel}:${i + 1}`);
    }
    if (!COST_OWNERS.has(rel) && COST_RES.some((re) => re.test(line))) {
      costCounts[rel] = (costCounts[rel] ?? 0) + 1;
      costHits.push(`${rel}:${i + 1}`);
    }
  });
}

function grade(label, counts, baseline, hits, remedy) {
  const failures = [];
  const lowered = [];
  for (const [rel, n] of Object.entries(counts)) {
    const allowed = baseline[rel] ?? 0;
    if (n > allowed) failures.push(`${rel}: ${n} (baseline ${allowed})`);
  }
  for (const [rel, allowed] of Object.entries(baseline)) {
    const n = counts[rel] ?? 0;
    if (n < allowed) lowered.push(`${rel}: ${n} < baseline ${allowed} (lower it in scripts/check-scheduling-links.mjs)`);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (failures.length) {
    console.error(`✗ ${label}: ${failures.length} file(s) above baseline`);
    for (const f of failures) console.error(`   - ${f}`);
    for (const h of hits.filter((h) => failures.some((f) => f.startsWith(h.split(":")[0] + ":")))) console.error(`     at ${h}`);
    console.error(`   ${remedy}`);
  } else {
    console.log(`✓ ${label}: ${total} baselined occurrence(s) outside the owners, none new`);
  }
  for (const l of lowered) console.log(`   ratchet: ${l}`);
  return failures.length;
}

const bad =
  grade(
    "check:scheduling-links slugs",
    slugCounts,
    SLUG_BASELINE,
    slugHits,
    "Import SCHEDULING_LINKS from src/lib/apexConfig.ts (SPA) or supabase/functions/_shared/scheduling-links.ts (edge).",
  ) +
  grade(
    "check:scheduling-links cost claims",
    costCounts,
    COST_BASELINE,
    costHits,
    "Render LICENSING_COST (src/lib/apexConfig.ts / _shared/licensing-cost.ts). No claim about who pays until Sam answers N1.",
  );

console.log(`  graded ${files.length} files`);
process.exit(bad ? 1 : 0);
