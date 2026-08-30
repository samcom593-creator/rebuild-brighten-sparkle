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
// Where the allowed member lists come from: scripts/data/enum-catalog.json,
// generated from the live catalog by scripts/refresh-enum-catalog.sh.
//
// 2026-08-30 — this map used to be five (table, column) pairs hand-copied out of
// pg_enum on 2026-07-27, with a comment saying it stayed small because a wrong
// entry would be worse than no entry. Measured, both halves of that tradeoff had
// already come due:
//
//   COVERAGE. src/ writes or filters enum literals against TEN enum columns.
//   Four were registered. Six were not: user_roles.role (10 files — the RBAC
//   read path), agents.onboarding_stage (6), agents.deactivation_reason (2),
//   agent_attendance.attendance_type (2), v_agents_full.status (2, and no view
//   column was registered at all), agent_attendance.status (1). All ten are
//   currently valid, so this is prevention, not recovered money — but the two
//   bugs this guard has already caught (MP-341 CallCenter, MP-342 kanban) both
//   landed on registered columns, which is the only reason it caught them.
//
//   CORRECTNESS. The map was keyed by BARE type name, and this database has two
//   enums named app_role: public.app_role (admin, manager, agent, va_manager,
//   va, recruiter) and recruit.app_role (agent, manager, admin, super_admin).
//   Registering "app_role" by hand is a coin flip. Proven, not theorised: the
//   audit that produced this commit resolved column types by joining
//   information_schema.udt_name to pg_type.typname, matched both, and reported
//   UnlicensedAll.tsx:213's entirely valid `role = "va"` as a violation. A guard
//   that can be aimed at the wrong enum by an ordinary-looking edit is a guard
//   whose green means nothing.
//
// Generating the map fixes both at once: coverage is total by construction (all
// 127 enum-typed columns, tables and views), and every type is schema-qualified,
// so the app_role ambiguity is recorded in the catalog rather than resolved by
// whoever last copied a list. apex-doctor Check #29 re-queries pg_enum weekly
// and goes red when the snapshot drifts.
//
// 2026-08-30 — the same silent-empty, one type system over. A text column with
// CHECK (col = ANY (ARRAY[...])) refuses every other value exactly as an enum
// does; it just fails LATER (23514 on the write, not 22P02 at plan time) and, on
// a READ filter, does not fail at all — it matches nothing, which is the failure
// this guard was written for. 150 such columns were graded by nobody. Measured
// against src/, four literals in two files were already dead:
// SamHQ.tsx and TelegramBot.tsx both ask telegram_groups.type for
// licensing_reference / daily_movement / seminar_reminders / ask_apex_ai, and the
// column can only ever hold pipeline / ai_dm / manager_alerts / wins / onboarding.
// Both lists also omit every type the column CAN hold except one, so the "Bind N
// Telegram HQ channels" action and the Pre-Agent HQ panel were blind in both
// directions at once.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const CATALOG_PATH = path.join(repoRoot, "scripts", "data", "enum-catalog.json");
// A missing or shape-broken catalog must stop the run. Falling back to an empty
// map would check zero literals and print the same tick as a clean pass — the
// blank-means-green failure this repo has shipped a cure for four times.
let CATALOG;
try {
  CATALOG = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
} catch (err) {
  console.error(`\n✗ check:enum-filter-literals — cannot read ${path.relative(repoRoot, CATALOG_PATH)}: ${err.message}`);
  console.error("Regenerate it: bash scripts/refresh-enum-catalog.sh");
  process.exit(1);
}
const ENUMS = CATALOG.enums;
const COLUMN_ENUM = CATALOG.column_enum;
if (!ENUMS || !COLUMN_ENUM || Object.keys(COLUMN_ENUM).length === 0) {
  console.error("\n✗ check:enum-filter-literals — enum catalog has no columns; it would check nothing and pass.");
  console.error("Regenerate it: bash scripts/refresh-enum-catalog.sh");
  process.exit(1);
}
// Every column must resolve to a member list. An unresolvable entry would make
// `allowed` undefined and throw mid-scan on whichever file happened to hit it.
for (const [col, enumName] of Object.entries(COLUMN_ENUM)) {
  if (!Array.isArray(ENUMS[enumName]) || ENUMS[enumName].length === 0) {
    console.error(`\n✗ check:enum-filter-literals — catalog maps ${col} to ${enumName}, which has no members.`);
    console.error("Regenerate it: bash scripts/refresh-enum-catalog.sh");
    process.exit(1);
  }
}

// CHECK vocabularies live in their own map because they fail differently and the
// report has to say so: a bad enum literal kills the whole request at plan time,
// a bad CHECK literal on a write is rejected by the row constraint, and a bad
// CHECK literal in a filter silently returns nothing at all.
const CHECK_VOCAB = CATALOG.check_vocab;
if (!CHECK_VOCAB || typeof CHECK_VOCAB !== "object") {
  console.error("\n✗ check:enum-filter-literals — catalog has no check_vocab map.");
  console.error("Regenerate it: bash scripts/refresh-enum-catalog.sh");
  process.exit(1);
}

// One lookup for both kinds. `source` is carried through to the report so a
// finding never claims the wrong failure mode.
const VOCAB = new Map();
for (const [col, enumName] of Object.entries(COLUMN_ENUM)) {
  VOCAB.set(col, { allowed: ENUMS[enumName], source: "enum", name: enumName });
}
for (const [col, info] of Object.entries(CHECK_VOCAB)) {
  if (!Array.isArray(info?.members) || info.members.length === 0) {
    console.error(`\n✗ check:enum-filter-literals — check_vocab entry ${col} has no members.`);
    console.error("Regenerate it: bash scripts/refresh-enum-catalog.sh");
    process.exit(1);
  }
  // The generator asserts these sets are disjoint. If that ever stops being true
  // the guard would grade against whichever map was written last — stop instead.
  if (VOCAB.has(col)) {
    console.error(`\n✗ check:enum-filter-literals — ${col} is both enum-typed and CHECK-constrained; grading rule undefined.`);
    process.exit(1);
  }
  VOCAB.set(col, { allowed: info.members, source: "check", name: info.constraint });
}

// Findings that are REAL and are not fixed here, because the right value is a
// product decision rather than a typo. Baselined so the guard can run in
// pre-commit without blocking every commit — never to make them invisible: each
// one is printed on every run, and an entry that stops matching is an ERROR, so
// the list can only shrink. Surfaced 2026-08-30 the first time this guard was
// pointed at supabase/functions.
const KNOWN_DEAD_WRITES = [
  {
    file: "supabase/functions/confirm-agent-removal/index.ts",
    column: "agents.deactivation_reason",
    literal: "removed_from_system",
    why: "written with `as any`, which is why nothing objected. The enum holds bad_business/inactive/switched_teams — none of them means 'removed via the removal-request flow'. Picking one, or adding a member, is Sam's call.",
  },
  {
    file: "supabase/functions/detect-ghosted-applicants/index.ts",
    column: "applications.license_progress",
    literal: "need_follow_up",
    why: "the day-14 auto-move for ghosted applicants. license_progress has no follow-up member, so this UPDATE has raised 22P02 and moved nobody since it shipped.",
  },
  {
    file: "supabase/functions/run-licensing-checkups/index.ts",
    column: "applications.license_progress",
    literal: "need_follow_up",
    why: "the day-60 twin of the same dead auto-move. Both want a state the enum does not have; adding one is a migration plus a decision about who reads it.",
  },
];
const knownKey = (v) => `${v.file}|${v.table}.${v.column}|${v.literal}`;
const KNOWN_SET = new Set(KNOWN_DEAD_WRITES.map((k) => `${k.file}|${k.column}|${k.literal}`));

const GENERIC = String.raw`(?:<[^(]*>)?`;
const FROM_RX = new RegExp(
  String.raw`[A-Za-z_$][\w$]*\s*\.\s*from\s*${GENERIC}\s*\(\s*["'\`]([a-z_]+)["'\`]`,
  "g",
);
// .eq("col", "val") / .neq(...) / .not("col", "in", "(a,b)") / .in("col", ["a","b"])
const EQ_RX = /\.\s*(eq|neq)\s*\(\s*["'`]([a-z_]+)["'`]\s*,\s*["'`]([^"'`]*)["'`]/g;
const NOT_IN_RX = /\.\s*not\s*\(\s*["'`]([a-z_]+)["'`]\s*,\s*["'`]in["'`]\s*,\s*["'`]\(([^)]*)\)["'`]/g;
const IN_RX = /\.\s*in\s*\(\s*["'`]([a-z_]+)["'`]\s*,\s*\[([^\]]*)\]/g;
// `.in("col", SOME_CONST)` — the list is a named array somewhere else in the file.
// MP-343 handled this shape by hand-registering one const name (CONST_ENUM below),
// which is the same "whoever last copied a list" failure the generated catalog was
// built to remove: the SECOND const of this shape, TelegramBot.tsx's
// PRE_AGENT_HQ_TYPES, was never registered and carried four dead literals. Resolve
// the identifier instead of naming it — the write path already does exactly this
// for payload identifiers.
const IN_IDENT_RX = /\.\s*in\s*\(\s*["'`]([a-z_]+)["'`]\s*,\s*([A-Za-z_$][\w$]*)\b/g;
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
  APPLICATION_STATUS_OPTIONS: "public.application_status",
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
      source: "enum",
    });
  }
}

// `const NAME = [...] as const` / `let NAME = [...]`. Returns null when the name
// resolves to something that is not a flat array of string literals — a spread, a
// computed value, a function call — because grading half a list would report a
// clean pass on the half it could not see.
// Elements of an inline `[...]`, or null when any element is not a plain quoted
// string (spread, identifier, call, template with substitution).
function literalArrayElements(body) {
  const parts = body.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (!parts.every((x) => /^["'`][^"'`$]*["'`]$/.test(x))) return null;
  return parts;
}

function resolveArrayConst(text, ident) {
  const esc = ident.replace(/[$]/g, "\\$&");
  const rx = new RegExp(String.raw`\b(?:const|let|var)\s+${esc}\b[^=\n]*=\s*\[([^\]]*)\]`, "g");
  const m = rx.exec(text);
  if (!m) return null;
  return literalArrayElements(m[1]);
}

function check(file, text, table, segment, offset) {
  const record = (column, raw, at = offset) => {
    const key = `${table}.${column}`;
    const vocab = VOCAB.get(key);
    if (!vocab) return;
    const { allowed, source, name: enumName } = vocab;
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
        source,
      });
    }
  };

  for (const m of segment.matchAll(EQ_RX)) record(m[2], [m[3]]);
  for (const m of segment.matchAll(NOT_IN_RX)) record(m[1], m[2].split(","));
  for (const m of segment.matchAll(IN_RX)) {
    // `[...SOME_CONST, "x"]` — a spread is not a literal, and splitting the body on
    // commas turns it into one. Two edge functions produced exactly that finding
    // ("...VALID_DEAL_STATUSES" reported as an invalid deals.status) the first time
    // this guard was pointed at supabase/functions. Half a list graded is worse than
    // none: skip the site, do not invent a literal from the syntax around it.
    const lits = literalArrayElements(m[2]);
    if (lits) record(m[1], lits);
  }
  for (const m of segment.matchAll(IN_IDENT_RX)) {
    const lits = resolveArrayConst(text, m[2]);
    if (lits) record(m[1], lits, offset + m.index);
  }

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

// supabase/functions is scanned too. The bug that motivated the CHECK half of this
// guard is IN an edge function — telegram-webhook writes type:"lobby" to
// telegram_groups on every bot-add, which the CHECK has never accepted — and a
// guard that cannot see its own motivating bug is the inline-only mistake MP-341
// already made once.
const SCAN_ROOTS = ["src", path.join("supabase", "functions")];
for (const file of SCAN_ROOTS.flatMap((r) => walk(path.join(repoRoot, r)))) {
  const raw = fs.readFileSync(file, "utf8");
  if (ALLOW_RX.test(raw)) continue;
  const text = stripComments(raw);
  for (const m of text.matchAll(FROM_RX)) {
    const table = m[1];
    if (![...VOCAB.keys()].some((k) => k.startsWith(`${table}.`))) continue;
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

const known = violations.filter((v) => KNOWN_SET.has(knownKey(v)));
const fresh = violations.filter((v) => !KNOWN_SET.has(knownKey(v)));

// A baseline entry that no longer matches means the site was fixed (good) or moved
// (needs re-checking). Either way the list is now describing code that is not there,
// which is how a ratchet quietly stops measuring. Fail rather than drift.
const matchedKeys = new Set(known.map(knownKey));
const staleBaseline = KNOWN_DEAD_WRITES.filter(
  (k) => !matchedKeys.has(`${k.file}|${k.column}|${k.literal}`),
);
if (staleBaseline.length) {
  console.error(
    `\n✗ check:enum-filter-literals — ${staleBaseline.length} baselined finding(s) no longer match any site.`,
  );
  for (const k of staleBaseline) console.error(`  ${k.file} — ${k.column} = "${k.literal}"`);
  console.error("\nIf they were fixed, delete them from KNOWN_DEAD_WRITES in this file.");
  process.exit(1);
}

function printKnown() {
  if (!known.length) return;
  console.log(`\n  ${known.length} known-dead write(s) carried in the baseline, not fixed:`);
  for (const v of known) {
    const k = KNOWN_DEAD_WRITES.find((x) => `${x.file}|${x.column}|${x.literal}` === knownKey(v));
    console.log(`    ${v.file}:${v.line}  ${v.table}.${v.column} = "${v.literal}"`);
    console.log(`      ${k.why}`);
  }
}

if (fresh.length === 0) {
  console.log(
    `✓ check:enum-filter-literals — ${chainsScanned} supabase chains, ${literalsChecked} literals ` +
      `against ${VOCAB.size} closed vocabularies (${Object.keys(COLUMN_ENUM).length} enum-typed, ` +
      `${Object.keys(CHECK_VOCAB).length} CHECK-constrained), ${known.length} known-dead, 0 new.`,
  );
  printKnown();
  process.exit(0);
}

const enumViolations = fresh.filter((v) => v.source !== "check");
const checkViolations = fresh.filter((v) => v.source === "check");

console.error(
  `\n✗ check:enum-filter-literals — ${fresh.length} literal(s) are not members of their column's ` +
    `closed vocabulary (${enumViolations.length} enum-typed, ${checkViolations.length} CHECK-constrained).\n`,
);

if (enumViolations.length) {
  console.error("ENUM-TYPED COLUMNS");
  console.error(
    "PostgREST coerces filter literals at query-plan time, so ONE bad label fails the WHOLE",
  );
  console.error(
    "request with 400/22P02. If the caller swallows the error, the surface renders empty and",
  );
  console.error("looks like a cleared queue. That is exactly how 73 licensed applicants went");
  console.error("invisible for three days.\n");
  for (const v of enumViolations) {
    console.error(`  ${v.file}:${v.line}`);
    const site = v.column ? `${v.table}.${v.column}` : v.table;
    console.error(`    ${site} — "${v.literal}" is not a ${v.enumName} member`);
    console.error(`    valid: ${v.allowed.join(", ")}\n`);
  }
}

if (checkViolations.length) {
  console.error("CHECK-CONSTRAINED TEXT COLUMNS");
  console.error("The column's CHECK is a closed list, so this literal fails in one of two ways and");
  console.error("NEITHER of them is loud: on a write the row constraint rejects it (23514) and the");
  console.error("statement rolls back; in a filter it does not error at all — the constraint is");
  console.error("VALIDATED, so no row can hold this value and the query returns nothing, forever.\n");
  for (const v of checkViolations) {
    console.error(`  ${v.file}:${v.line}`);
    const site = v.column ? `${v.table}.${v.column}` : v.table;
    console.error(`    ${site} — "${v.literal}" is not allowed by ${v.enumName}`);
    console.error(`    valid: ${v.allowed.join(", ")}\n`);
  }
}

console.error("Fix the literal. If a migration genuinely changed the vocabulary, regenerate the");
console.error("catalog in the SAME commit: bash scripts/refresh-enum-catalog.sh");
printKnown();
process.exit(1);
