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
  license_progress: [
    "unlicensed", "course_purchased", "finished_course", "test_scheduled",
    "passed_test", "fingerprints_done", "waiting_on_license", "licensed",
    "waiting_fingerprints", "failed_test", "exam_passed", "in_field_training",
  ],
};

// (table, column) -> enum name. Only unambiguous, high-traffic pairs are policed; a wrong
// entry here would be worse than no entry, so the map stays small and verified.
const COLUMN_ENUM = {
  "applications.status": "application_status",
  "applications.license_status": "license_status",
  "applications.license_progress": "license_progress",
  "agents.status": "agent_status",
  "agents.license_status": "license_status",
};

// 2026-08-11 — two attribution bugs, both found when this guard reported
// LicensedInbox.tsx:114 `applications.status = "active"`. That filter is not on
// applications at all: it is on the NEXT chain in the same Promise.all, against
// apex_toolkit_agents, whose status column is CHECK (status IN
// ('active','hired','passed')) — i.e. correct code. "Fixing" it would have broken
// a working query to satisfy a broken guard.
//
//   1. The receiver was hardcoded to `supabase`, so any chain built on a typed
//      wrapper (`toolkitInboxClient.from(...)`) was never scanned — a silent gap,
//      not a false pass, which is the worse of the two failure modes.
//   2. Neither this nor NEXT_FROM_RX tolerated a generic parameter, so
//      `.from<Omit<LicensedRow, "origin">>("apex_toolkit_agents")` did not read as
//      a chain boundary. The preceding `applications` chain therefore never
//      terminated and swallowed the following chain's filters.
//
// Receiver is now any identifier. That cannot over-match: the table argument must
// still be a quoted bare identifier AND must own a registered enum column, so
// Array.from(...) and friends are filtered out before any literal is checked.
const GENERIC = String.raw`(?:<[^(]*>)?`;
const FROM_RX = new RegExp(
  String.raw`[A-Za-z_$][\w$]*\s*\.\s*from\s*${GENERIC}\s*\(\s*["'\`]([a-z_]+)["'\`]`,
  "g",
);
// .eq("col", "val") / .neq(...) / .not("col", "in", "(a,b)") / .in("col", ["a","b"])
const EQ_RX = /\.\s*(eq|neq)\s*\(\s*["'`]([a-z_]+)["'`]\s*,\s*["'`]([^"'`]*)["'`]/g;
const NOT_IN_RX = /\.\s*not\s*\(\s*["'`]([a-z_]+)["'`]\s*,\s*["'`]in["'`]\s*,\s*["'`]\(([^)]*)\)["'`]/g;
const IN_RX = /\.\s*in\s*\(\s*["'`]([a-z_]+)["'`]\s*,\s*\[([^\]]*)\]/g;
const ALLOW_RX = /enum-literal-allow/;
// ---------------------------------------------------------------------------
// 2026-08-29 — the same 22P02, on the WRITE side.
//
// CallCenter.tsx dispositioned an application lead with
//     updateData.status = "contacted"
// and the status dropdown offered "contacted" and "hired". Neither is a member
// of application_status ("hired" is agent_status — the identical cross-enum
// mix-up this guard was written for). Proven against the live type:
//     select 'contacted'::application_status
//     -> invalid input value for enum application_status: "contacted"
// so two of eight disposition buttons and two of six dropdown options threw and
// wrote nothing. Zero applications rows have ever held status='contacted'.
//
// Why the READ-side half of this guard could not see it, and why TypeScript
// could not either: the payload is built as `Record<string, string>` and then
// handed to `.update(updateData as never)`. The Record indirection hides the
// value from the generated Update type, and the cast — added 2026-08-29 in
// 13932ca7 to clear 6 type errors — guarantees nothing will ever object again.
// So this must match the ASSIGNMENT, not just an inline literal: a guard that
// only reads `.update({ ... })` would miss the exact bug that motivated it.
const UPDATE_OBJ_RX = /\.\s*(?:update|insert|upsert)\s*\(\s*\{([^{}]*)\}/g;
const UPDATE_IDENT_RX = /\.\s*(?:update|insert|upsert)\s*\(\s*([A-Za-z_$][\w$]*)\s*(?:as\s+[^)]*)?\)/g;
const PAYLOAD_KV_RX = /([a-z_]+)\s*:\s*["'`]([^"'`]*)["'`]/g;

// Option lists rendered as UI controls never touch a .from() chain, so neither
// half of the chain scan can reach them — but every member is written verbatim
// to the column. Registering the const makes the list a checked artifact.
const CONST_ENUM = {
  APPLICATION_STATUS_OPTIONS: "application_status",
};


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
const NEXT_FROM_RX = new RegExp(String.raw`\.\s*from\s*${GENERIC}\s*\(`, "g");

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

// A variable payload is resolved against the whole file once per chain that
// writes it, so sites B/C/D of one handler each report the same assignment.
// Dedupe on the identity of the finding, not the path that found it.
const seenViolation = new Set();
const violations = [];
let chainsScanned = 0;
let literalsChecked = 0;

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function recordEnum(file, text, enumName, raw, at, where) {
  const allowed = ENUMS[enumName];
  for (const rawLit of raw) {
    const lit = rawLit.trim().replace(/^["'`]|["'`]$/g, "");
    if (!lit) continue;
    literalsChecked += 1;
    if (allowed.includes(lit)) continue;
    const vkey = `${file}:${lineOf(text, at)}:${where}:${lit}`;
    if (seenViolation.has(vkey)) continue;
    seenViolation.add(vkey);
    violations.push({
      file: path.relative(repoRoot, file),
      line: lineOf(text, at),
      table: where,
      column: "",
      literal: lit,
      enumName,
      allowed,
    });
  }
}

function check(file, text, table, segment, offset) {
  const record = (column, raw, at = offset) => {
    const key = `${table}.${column}`;
    const enumName = COLUMN_ENUM[key];
    if (!enumName) return;
    const allowed = ENUMS[enumName];
    for (const rawLit of raw) {
      const lit = rawLit.trim().replace(/^["'`]|["'`]$/g, "");
      if (!lit) continue;
      literalsChecked += 1;
      if (allowed.includes(lit)) continue;
      const vkey = `${file}:${lineOf(text, at)}:${table}.${column}:${lit}`;
      if (seenViolation.has(vkey)) continue;
      seenViolation.add(vkey);
      violations.push({
        file: path.relative(repoRoot, file),
        line: lineOf(text, at),
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

  // Write path: inline payload literal.
  for (const m of segment.matchAll(UPDATE_OBJ_RX)) {
    const at = offset + m.index;
    for (const kv of m[1].matchAll(PAYLOAD_KV_RX)) record(kv[1], [kv[2]], at);
  }

  // Write path: payload built in a variable, then handed to .update(). The
  // assignments sit BEFORE the .from() that opens this chain, so they are not
  // in the segment — they are resolved against the whole file, with the table
  // taken from the chain the identifier is actually written through.
  for (const m of segment.matchAll(UPDATE_IDENT_RX)) {
    const ident = m[1];
    const esc = ident.replace(/[$]/g, "\\$&");
    const q = "[\"'`]";
    const asgRx = new RegExp(
      String.raw`(?:\(\s*)?\b${esc}\b(?:\s+as\s+[^)]*\))?\s*\.\s*([a-z_]+)\s*=\s*` +
        q + "([^\"'`]*)" + q,
      "g",
    );
    for (const a of text.matchAll(asgRx)) record(a[1], [a[2]], a.index);
    const iniRx = new RegExp(
      String.raw`\b(?:const|let|var)\s+${esc}\b[^=\n]*=\s*\{([^{}]*)\}`,
      "g",
    );
    for (const b of text.matchAll(iniRx)) {
      for (const kv of b[1].matchAll(PAYLOAD_KV_RX)) record(kv[1], [kv[2]], b.index);
    }
  }
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

  for (const [name, enumName] of Object.entries(CONST_ENUM)) {
    const rx = new RegExp(String.raw`\b${name}\b\s*(?::[^=\n]*)?=\s*\[([^\]]*)\]`, "g");
    for (const m of text.matchAll(rx)) {
      chainsScanned += 1;
      recordEnum(file, text, enumName, m[1].split(","), m.index, name);
    }
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
  const site = v.column ? `${v.table}.${v.column}` : v.table;
  console.error(`    ${site} — "${v.literal}" is not a ${v.enumName} member`);
  console.error(`    valid: ${v.allowed.join(", ")}\n`);
}
console.error("Fix the literal. If a migration genuinely added the label, update ENUMS in");
console.error("scripts/check-enum-filter-literals.mjs in the SAME commit.");
process.exit(1);
