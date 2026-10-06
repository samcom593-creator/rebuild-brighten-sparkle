#!/usr/bin/env node
// scripts/check-roster-segment-placeholders.mjs
//
// Behavioural ratchet on the CRM roster's segment chips: every worklist chip on
// DashboardCRM must declare, and then actually honour, whether it admits a
// SYNC-ONLY placeholder seat.
//
// WHY THIS EXISTS
//   crm_agent_roster() projects is_sync_only = (agent_code like 'GHOST\_%' and
//   user_id is null) for the placeholder seats ingest_ayro_sales_deal() and
//   ingest_discord_production_deal() mint when a Discord-posted sale names an
//   author they cannot match to an agent. The flag was projected by the
//   function, typed at RosterRow.is_sync_only, counted by crm_roster_segments()
//   as `sync_only` — and read by NOTHING on the page. ProducerProfile.tsx:277
//   badged it. The list where Sam actually does the work did not.
//
//   Measured live on 2026-10-06, 6 placeholder seats were sitting inside:
//     New hires            6 of 27  (22.2%) <- the DEFAULT landing segment
//     All agents           6 of 26  (23.1%)
//     Producing            4 of 10  (40.0%)
//     Unlicensed           6 of 22  (27.3%)
//   wearing every marker a real hire wears, with no login, no email, no phone
//   and no onboarding path to act on.
//
//   This is NOT a regex guard. It lifts the shipped ROSTER_SEGMENTS array out of
//   DashboardCRM.tsx and runs the real `match` predicates, so the predicate
//   under test and the predicate that ships are the same text.
//
// WHAT IT GRADES — the declaration against the BEHAVIOUR, in both directions:
//   admitsSyncOnly: false -> a sync-only row that otherwise matches must NOT match.
//   admitsSyncOnly: true  -> that same row MUST still match.
//   The second half matters as much as the first. Without it, `true` becomes a
//   silent opt-out: a chip could claim it counts placeholders (to stay
//   reconciled with the server-side ProductionMetricsCard tiles) while quietly
//   filtering them out, and the screen would hold two answers to one question
//   with nothing going red.
//
// A missing `admitsSyncOnly` is a FAILURE, not a default. A new chip must state
// its position; a chip that forgets is exactly how the 6 got in.

import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "src/pages/DashboardCRM.tsx");
const src = fs.readFileSync(FILE, "utf8");

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1; };

// ── lift the real array ──────────────────────────────────────────────────────
const startMarker = "const ROSTER_SEGMENTS: Array<{";
const si = src.indexOf(startMarker);
if (si === -1) {
  console.error("FAIL  ROSTER_SEGMENTS not found in src/pages/DashboardCRM.tsx — the guard cannot grade what it cannot locate.");
  process.exit(1);
}
const openBracket = src.indexOf("> = [", si);
if (openBracket === -1) {
  console.error("FAIL  ROSTER_SEGMENTS declaration shape changed; refusing to guess at its body.");
  process.exit(1);
}
const bodyStart = src.indexOf("[", openBracket);
// brace/bracket match from bodyStart
let depth = 0, end = -1;
for (let i = bodyStart; i < src.length; i++) {
  const c = src[i];
  if (c === "[") depth++;
  else if (c === "]") { depth--; if (depth === 0) { end = i; break; } }
}
if (end === -1) {
  console.error("FAIL  could not bracket-match the ROSTER_SEGMENTS literal.");
  process.exit(1);
}
let literal = src.slice(bodyStart, end + 1);

// The literal references lucide icon components and TS types. Neutralise only
// the icon identifiers — the match predicates and admitsSyncOnly flags are left
// byte-for-byte as shipped.
const ICON_RE = /icon:\s*[A-Za-z0-9_$]+/g;
const iconCount = (literal.match(ICON_RE) ?? []).length;
literal = literal.replace(ICON_RE, "icon: null");

// Assert the slice really is the shipped set, not a silently empty cut
// (a harness that slices nothing passes every test while proving none).
for (const needle of ["new_hires", "free_leads", "free_leads_close", "all", "producing",
                      "never_produced", "no_longer_here", "unlicensed", "inactive",
                      "terminated", "sync_only", "admitsSyncOnly", "match:"]) {
  if (!literal.includes(needle)) {
    console.error(`FAIL  extracted ROSTER_SEGMENTS literal is missing "${needle}" — the slice is wrong, so no verdict below would mean anything.`);
    process.exit(1);
  }
}
if (iconCount < 10) {
  console.error(`FAIL  only ${iconCount} icon fields in the extracted literal; expected one per segment. The slice is partial.`);
  process.exit(1);
}

// ── the helpers the shipped predicates close over ────────────────────────────
const isSyncOnly = (r) => r.is_sync_only === true;
const num = (v) => Number(v ?? 0) || 0;
const daysSince = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
};

let SEGMENTS;
try {
  // eslint-disable-next-line no-new-func
  SEGMENTS = new Function("isSyncOnly", "num", "daysSince", `return ${literal};`)(isSyncOnly, num, daysSince);
} catch (e) {
  console.error(`FAIL  the extracted ROSTER_SEGMENTS literal does not evaluate: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(SEGMENTS) || SEGMENTS.length < 10) {
  console.error(`FAIL  evaluated ${Array.isArray(SEGMENTS) ? SEGMENTS.length : "non-array"} segments; expected the full set.`);
  process.exit(1);
}

// ── fixtures: a row that MATCHES each segment, in both identity states ───────
const long_ago = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
const recent = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

const base = {
  agent_id: "fixture", full_name: "Fixture Person", status: "active",
  license_status: "licensed", tenure_days: 5, lifetime_deals: 4,
  mtd_alp: 1000, l30_alp: 1000, lifetime_alp: 9000,
  last_posted_date: recent, free_leads_qualified: false,
  free_leads_needed_for_qual: null, is_sync_only: false,
};

// Per-segment override that makes the NON-placeholder row match.
const MATCHING = {
  new_hires:        { tenure_days: 9 },
  free_leads:       { free_leads_qualified: true },
  free_leads_close: { free_leads_qualified: false, free_leads_needed_for_qual: 2500 },
  all:              { lifetime_deals: 13 },
  producing:        { mtd_alp: 8888 },
  never_produced:   { lifetime_deals: 0, mtd_alp: 0 },
  no_longer_here:   { lifetime_deals: 4, last_posted_date: long_ago },
  unlicensed:       { license_status: "unlicensed" },
  inactive:         { status: "inactive" },
  terminated:       { status: "terminated" },
  sync_only:        { is_sync_only: true },
};

let pass = 0;
const keys = new Set();

for (const seg of SEGMENTS) {
  keys.add(seg.key);

  if (typeof seg.admitsSyncOnly !== "boolean") {
    fail(`segment "${seg.key}" does not declare admitsSyncOnly. State its position: false for a worklist chip that implies a human action on a real person, true for a chip that must stay reconciled with a crm_roster_segments() tile (and say which tile in a comment).`);
    continue;
  }
  if (typeof seg.match !== "function") { fail(`segment "${seg.key}" has no match predicate.`); continue; }

  const override = MATCHING[seg.key];
  if (!override) {
    fail(`segment "${seg.key}" is new and this guard has no fixture for it. Add one to MATCHING in scripts/check-roster-segment-placeholders.mjs — an ungraded chip is how the 6 placeholders got into the New hires queue.`);
    continue;
  }

  const real = { ...base, ...override, is_sync_only: false };
  const ghost = { ...base, ...override, is_sync_only: true };

  // The fixture must be load-bearing: a real row has to match, or the
  // placeholder verdict below proves nothing.
  if (seg.key !== "sync_only" && !seg.match(real)) {
    fail(`fixture for "${seg.key}" does not match a REAL row, so its placeholder verdict is vacuous. Fix the fixture.`);
    continue;
  }

  const ghostMatches = seg.match(ghost);
  if (seg.admitsSyncOnly && !ghostMatches) {
    fail(`segment "${seg.key}" declares admitsSyncOnly: true but its predicate EXCLUDES a sync-only row. Either drop the exclusion or declare false — a chip that claims to count placeholders while filtering them out puts two answers to one question on the same screen.`);
    continue;
  }
  if (!seg.admitsSyncOnly && ghostMatches) {
    fail(`segment "${seg.key}" declares admitsSyncOnly: false but its predicate ADMITS a sync-only row. Add "!isSyncOnly(r)" to the match. This is the exact defect that put 6 placeholder seats into Sam's New hires queue (6 of 27) and Unlicensed queue (6 of 22).`);
    continue;
  }
  pass++;
}

// The sync-only chip itself must exist: excluding placeholders from the
// worklists without giving them a home hides them instead of labelling them.
if (!keys.has("sync_only")) {
  fail(`no "sync_only" segment. Placeholders excluded from every worklist and shown nowhere are hidden, not labelled — and a hidden placeholder is how its production goes unexplained.`);
}

// The badge is half the fix: the chip separates them, the badge identifies one
// inside a mixed list (All agents and Producing deliberately still carry them).
// Anchored on the JSX opener, NOT on "isSyncOnly(r) && (" — the first cut of
// this check used the loose form and passed M5 (badge deleted) because
// `!isSyncOnly(r) && (r.lifetime_deals ?? 0)` inside two segment predicates
// contains that substring. A detector that matches its own neighbours is not a
// detector. The `{` opener and the absence of a `!` are both load-bearing.
const BADGE_GUARD = "{isSyncOnly(r) && (";
if (!src.includes(BADGE_GUARD) || !src.includes("Sync only")) {
  fail(`the roster row does not render a "Sync only" badge. All agents and Producing admit placeholders on purpose, so a row-level marker is the only thing telling Sam which of them is not a person.`);
}

if (process.exitCode === 1) {
  console.error(`\n${pass} segment(s) graded clean before the first failure above.`);
  process.exit(1);
}
console.log(`OK  roster segments: ${pass}/${SEGMENTS.length} chips declare and honour their sync-only position; "Sync only" chip present; row badge present.`);
