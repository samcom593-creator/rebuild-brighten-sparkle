#!/usr/bin/env node
// Guards the class of bug that blanked the Licensed Inbox for three days (2026-07-24 →
// 2026-07-27, commit e26fdcb7).
//
// LicensedInbox.tsx filtered:
//     .not("status", "in", "(contracting,rejected,hired,active,terminated)")
// on the `applications` table. 'hired', 'active' and 'terminated' are not members of the
// application_status enum — they belong to agent_status. PostgREST coerces filter literals
// to the column type during query planning, so the ENTIRE request failed with
// 400 / 22P02 "invalid input value for enum application_status". The page's catch turned
// that into `return []`, so it rendered a cleared-queue empty state while 73 licensed
// applicants were invisible.
//
// Why nothing caught it:
//   - TypeScript cannot see inside a filter string literal.
//   - The generated Supabase types do not constrain .not()/.in() value strings.
//   - The failure mode is a silent empty list, which looks exactly like success.
//
// What this checks: for every `supabase.from("<table>")` chain, any .eq / .neq / .in / .not
// filter on a column KNOWN to be a Postgres enum must use only real members of that enum.
//
// The enum members below are copied from the live database (pg_enum, 2026-07-27). If a
// migration adds a label, update this map in the same commit — that is the point: the
// allowed set becomes a reviewed, visible artifact instead of a string nobody validates.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const ENUMS = {
  application_status: [
    "new", "reviewing", "interview", "contracting", "approved", "rejected",
    "no_pickup", "lead", "registered", "attended", "attended_no_show", "paid",
    "onboarding", "producing", "lapsed", "disqualified", "quick_qualified",
  ],
  agent_status: ["active", "inactive", "pending", "terminated"],
  license_status: ["licensed", "unlicensed", "pending"],
};

// (table, column) -> enum name. Only unambiguous, high-traffic pairs are policed; a wrong
// entry here would be worse than no entry, so the map stays small and verified.
const COLUMN_ENUM = {
  "applications.status": "application_status",
  "applications.license_status": "license_status",
  "agents.status": "agent_status",
  "agents.license_status": "license_status",
};

const FROM_RX = /supabase\s*\.\s*from\s*\(\s*["'`]([a-z_]+)["'`]/g;
// .eq("col", "val") / .neq(...) / .not("col", "in", "(a,b)") / .in("col", ["a","b"])
const EQ_RX = /\.\s*(eq|neq)\s*\(\s*["'`]([a-z_]+)["'`]\s*,\s*["'`]([^"'`]*)["'`]/g;
const NOT_IN_RX = /\.\s*not\s*\(\s*["'`]([a-z_]+)["'`]\s*,\s*["'`]in["'`]\s*,\s*["'`]\(([^)]*)\)["'`]/g;
const IN_RX = /\.\s*in\s*\(\s*["'`]([a-z_]+)["'`]\s*,\s*\[([^\]]*)\]/g;
const ALLOW_RX = /enum-literal-allow/;

// How far after a .from("table") a filter is still considered part of that chain.
// The segment is ALSO cut at the next `.from(` — without that, a chain on one table bleeds
// into the next chain and reports filters against the wrong table. That bug produced 5
// false positives on the first run of this very script (RecruiterDashboard.tsx:929 read
// `.from("agents")` and then swallowed the following `.from("applications")` filters).
// A noisy check is worse than no check.
// The window is deliberately generous (4000) because the next `.from(` is the real
// boundary; at 900 a long explanatory comment between .from() and the filter pushed the
// filter out of range and the guard silently passed the very bug it exists to catch.
// Verified by reintroducing that bug and confirming this script now exits 1.
const CHAIN_WINDOW = 4000;
const NEXT_FROM_RX = /\.\s*from\s*\(/g;

// `afterFrom` must point PAST this chain's own `.from(...)` call, otherwise the scan
// immediately matches the chain's own from() and returns an empty segment — which silently
// checks nothing and reports a false all-clear. That was the second bug in this script.
function chainSegment(text, start, afterFrom) {
  const hardEnd = Math.min(text.length, start + CHAIN_WINDOW);
  NEXT_FROM_RX.lastIndex = afterFrom;
  const next = NEXT_FROM_RX.exec(text);
  const end = next && next.index < hardEnd ? next.index : hardEnd;
  return text.slice(start, end);
}

// Comments must be blanked before matching, or the guard fires on prose. Writing
// `.neq("status","terminated")` inside an explanatory comment — as the fix for
// WhaleRecruiting.tsx does — otherwise reports itself as a violation forever.
// Blanking (rather than deleting) preserves byte offsets so reported line numbers stay true.
function stripComments(text) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  out = out
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? " ".repeat(line.length) : line))
    .join("\n");
  return out;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const violations = [];
let chainsScanned = 0;
let literalsChecked = 0;

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function check(file, text, table, segment, offset) {
  const record = (column, raw) => {
    const key = `${table}.${column}`;
    const enumName = COLUMN_ENUM[key];
    if (!enumName) return;
    const allowed = ENUMS[enumName];
    for (const rawLit of raw) {
      const lit = rawLit.trim().replace(/^["'`]|["'`]$/g, "");
      if (!lit) continue;
      literalsChecked += 1;
      if (allowed.includes(lit)) continue;
      violations.push({
        file: path.relative(repoRoot, file),
        line: lineOf(text, offset),
        table,
        column,
        literal: lit,
        enumName,
        allowed,
      });
    }
  };

  for (const m of segment.matchAll(EQ_RX)) record(m[2], [m[3]]);
  for (const m of segment.matchAll(NOT_IN_RX)) record(m[1], m[2].split(","));
  for (const m of segment.matchAll(IN_RX)) record(m[1], m[2].split(","));
}

for (const file of walk(path.join(repoRoot, "src"))) {
  const raw = fs.readFileSync(file, "utf8");
  if (ALLOW_RX.test(raw)) continue;
  const text = stripComments(raw);
  for (const m of text.matchAll(FROM_RX)) {
    const table = m[1];
    if (!Object.keys(COLUMN_ENUM).some((k) => k.startsWith(`${table}.`))) continue;
    chainsScanned += 1;
    check(file, text, table, chainSegment(text, m.index, m.index + m[0].length), m.index);
  }
}

if (violations.length === 0) {
  console.log(
    `✓ check:enum-filter-literals — ${chainsScanned} supabase chains, ${literalsChecked} enum literals, 0 invalid.`,
  );
  process.exit(0);
}

console.error(
  `\n✗ check:enum-filter-literals — ${violations.length} filter literal(s) are not members of their column's enum.\n`,
);
console.error(
  "PostgREST coerces filter literals at query-plan time, so ONE bad label fails the WHOLE",
);
console.error(
  "request with 400/22P02. If the caller swallows the error, the surface renders empty and",
);
console.error("looks like a cleared queue. That is exactly how 73 licensed applicants went");
console.error("invisible for three days.\n");
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.table}.${v.column} — "${v.literal}" is not a ${v.enumName} member`);
  console.error(`    valid: ${v.allowed.join(", ")}\n`);
}
console.error("Fix the literal. If a migration genuinely added the label, update ENUMS in");
console.error("scripts/check-enum-filter-literals.mjs in the SAME commit.");
process.exit(1);
