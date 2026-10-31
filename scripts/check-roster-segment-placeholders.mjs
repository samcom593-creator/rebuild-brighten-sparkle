#!/usr/bin/env node
// scripts/check-roster-segment-placeholders.mjs
//
// Behavioural ratchet on My Team's lists: every list must declare, and then
// actually honour, whether it admits a SYNC-ONLY placeholder seat.
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
// OVERHAUL-myteam (2026-10-31) moved the lists out of the page into
// src/lib/teamList.ts (TEAM_LISTS), where the four numbers, the list rows and
// the More lists menu all read them. This guard follows them there, and it is
// still NOT a regex guard: it bundles the shipped module with esbuild and runs
// the real `match` predicates, so the predicate under test and the predicate
// that ships are the same code, helpers and all.
//
// WHAT IT GRADES — the declaration against the BEHAVIOUR, in both directions:
//   admitsSyncOnly: false -> a sync-only row that otherwise matches must NOT match.
//   admitsSyncOnly: true  -> that same row MUST still match.
//   The second half matters as much as the first. Without it, `true` becomes a
//   silent opt-out: a list could claim it counts placeholders while quietly
//   filtering them out, and the screen would hold two answers to one question
//   with nothing going red.
//
// A missing `admitsSyncOnly` is a FAILURE, not a default. A new list must state
// its position; a list that forgets is exactly how the 6 got in.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// ESM module: esbuild is CJS, so reach it through createRequire (the same way check-metric-truth does).
const nodeRequire = createRequire(import.meta.url);
const root = process.cwd();
const LIB = "src/lib/teamList.ts";
const LIST_UI = "src/components/team/TeamList.tsx";

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1; };

if (!fs.existsSync(path.join(root, LIB))) {
  console.error(`FAIL  ${LIB} not found — the guard cannot grade what it cannot locate.`);
  process.exit(1);
}

// ── bundle the real module ───────────────────────────────────────────────────
// "@/..." resolves into src/. The Supabase client is stubbed: teamStage.ts imports it at the top for its writers,
// and nothing graded here talks to the database (constructing the real client needs the browser's env).
const atAlias = {
  name: "at-alias",
  setup(build) {
    build.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: "supabase-client", namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const supabase = {};", loader: "js" }));
    build.onResolve({ filter: /^@\// }, (args) => {
      const base = path.join(root, "src", args.path.slice(2));
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (fs.existsSync(candidate)) return { path: candidate };
      }
      return { errors: [{ text: `cannot resolve ${args.path}` }] };
    });
  },
};

let mod;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-lists-"));
try {
  const esbuild = nodeRequire("esbuild");
  const out = await esbuild.build({
    entryPoints: [path.join(root, LIB)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [atAlias],
  });
  const file = path.join(tmpDir, "teamList.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  mod = await import(pathToFileURL(file).href);
} catch (e) {
  console.error(`FAIL  ${LIB} does not bundle or load: ${String(e?.message ?? e).split("\n")[0]}`);
  process.exit(1);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const LISTS = mod.TEAM_LISTS;
if (!Array.isArray(LISTS) || LISTS.length < 10) {
  console.error(`FAIL  TEAM_LISTS evaluated to ${Array.isArray(LISTS) ? `${LISTS.length} lists` : "nothing"}; expected the full set. The export moved or was cut.`);
  process.exit(1);
}

// ── fixtures: a row that MATCHES each list, in both identity states ──────────
const long_ago = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
const recent = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

const baseRow = {
  agent_id: "fixture", full_name: "Fixture Person", email: null, phone: "+16025550123", status: "active",
  license_status: "licensed", license_progress: "licensed", tenure_days: 5, lifetime_deals: 4, l30_deals: 2,
  mtd_alp: 1000, l30_alp: 1000, lifetime_alp: 9000, last_posted_date: recent, free_leads_qualified: false,
  free_leads_needed_for_qual: null, is_sync_only: false, manager_id: null, manager_name: null,
};
const baseFacts = { agent_id: "fixture", stage: "training", stage_label: "Training", stage_source: "staff", schedule_set: true, weekdays: [1, 2, 3], next_schedule: null, access: { has_login: true, invitation: "accepted" } };

// Per-list override that makes the NON-placeholder member match: { row, facts }.
const MATCHING = {
  everyone:         { row: {} },
  no_sale:          { row: { lifetime_deals: 0, l30_deals: 0, license_status: "licensed" } },
  quiet:            { row: { lifetime_deals: 4, l30_deals: 0, last_posted_date: long_ago } },
  licensing:        { row: { lifetime_deals: 0, l30_deals: 0, license_status: "unlicensed" } },
  selling:          { row: { l30_deals: 2 } },
  new_hires:        { row: { tenure_days: 9 } },
  free_leads:       { row: { free_leads_qualified: true } },
  free_leads_close: { row: { free_leads_qualified: false, free_leads_needed_for_qual: 2500 } },
  no_login:         { row: {}, facts: { access: { has_login: false, invitation: "none" } } },
  stage_unset:      { row: {}, facts: { stage: null } },
  no_schedule:      { row: {}, facts: { schedule_set: false, weekdays: null } },
  not_active:       { row: { status: "inactive" } },
  sync_only:        { row: { is_sync_only: true } },
};

const member = (override, ghost) => ({
  row: { ...baseRow, ...override.row, is_sync_only: ghost },
  facts: { ...baseFacts, ...(override.facts ?? {}) },
});

let pass = 0;
const keys = new Set();

for (const list of LISTS) {
  keys.add(list.key);

  if (typeof list.admitsSyncOnly !== "boolean") {
    fail(`list "${list.key}" does not declare admitsSyncOnly. State its position: false for a list that implies a human action on a real person (call, coach, route leads), true for a list that sorts the roster by status alone.`);
    continue;
  }
  if (typeof list.match !== "function") { fail(`list "${list.key}" has no match predicate.`); continue; }

  const override = MATCHING[list.key];
  if (!override) {
    fail(`list "${list.key}" is new and this guard has no fixture for it. Add one to MATCHING in scripts/check-roster-segment-placeholders.mjs — an ungraded list is how the 6 placeholders got into the New hires queue.`);
    continue;
  }

  const real = member(override, false);
  const ghost = member(override, true);

  // The fixture must be load-bearing: a real person has to match, or the placeholder verdict below proves nothing.
  if (list.key !== "sync_only" && !list.match(real)) {
    fail(`fixture for "${list.key}" does not match a REAL person, so its placeholder verdict is vacuous. Fix the fixture.`);
    continue;
  }

  const ghostMatches = list.match(ghost);
  if (list.admitsSyncOnly && !ghostMatches) {
    fail(`list "${list.key}" declares admitsSyncOnly: true but its predicate EXCLUDES a sync-only row. Either drop the exclusion or declare false — a list that claims to count placeholders while filtering them out puts two answers to one question on the same screen.`);
    continue;
  }
  if (!list.admitsSyncOnly && ghostMatches) {
    fail(`list "${list.key}" declares admitsSyncOnly: false but its predicate ADMITS a sync-only row. Exclude placeholder seats in its match. This is the exact defect that put 6 placeholder seats into Sam's New hires queue (6 of 27) and Unlicensed queue (6 of 22).`);
    continue;
  }
  pass++;
}

// The placeholder list itself must exist: excluding placeholders from every worklist and showing them nowhere hides
// them instead of labelling them.
if (!keys.has("sync_only")) {
  fail(`no "sync_only" list. Placeholders excluded from every worklist and shown nowhere are hidden, not labelled — and a hidden placeholder is how its production goes unexplained.`);
}

// The row says what a placeholder is: its step reads "Placeholder seat", graded on the real function, and the list
// draws that step on every row.
const stage = typeof mod.teamStage === "function" ? mod.teamStage(member(MATCHING.sync_only, true), "2026-10-31") : null;
if (!stage || !/placeholder/i.test(stage.label ?? "")) {
  fail(`teamStage() does not name a placeholder seat on its row (got ${JSON.stringify(stage?.label ?? null)}). The Placeholder seats list mixes nothing else in, so the row-level marker is what tells Sam a row is not a person.`);
}
let uiSrc = "";
try { uiSrc = fs.readFileSync(path.join(root, LIST_UI), "utf8"); }
catch { fail(`${LIST_UI} could not be read, so the row-level marker cannot be graded.`); }
if (uiSrc && (!uiSrc.includes("teamStage(member") || !uiSrc.includes("<TeamStageMark stage={stage}"))) {
  fail(`${LIST_UI} no longer draws teamStage() on each row, so a placeholder seat would carry no marker.`);
}

if (process.exitCode === 1) {
  console.error(`\n${pass} list(s) graded clean before the first failure above.`);
  process.exit(1);
}
console.log(`OK  team lists: ${pass}/${LISTS.length} lists declare and honour their sync-only position; "sync_only" list present; row marker present.`);
