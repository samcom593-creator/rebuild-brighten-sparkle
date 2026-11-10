#!/usr/bin/env node
// check-human-contact-writers (WP3, 2026-11-10)
//
// "Contacted" became fiction because automated senders and humans shared one column:
// an automated 72h email stamped applications.contacted_at, so 707 applicants read
// 'Contacted' while 21 had any logged human touch. WP3 made the human truth its own
// columns (human_first/last_contact_at), written ONLY by the trigger on
// application_contact_log, which fn_log_human_contact() feeds.
//
// This ratchet stops NEW writers of the legacy columns contacted_at / last_contacted_at:
//   1. SQL: any migration NEWER than the WP3 anchor that assigns either column, outside
//      fn_contact_log_stamp_application, fails. Older migrations are history: a guard
//      that can go red on history is a guard everybody learns to skip.
//   2. TS (src/, supabase/functions/): value assignments of either key are counted per
//      file against a frozen baseline; a new file or a higher count fails. Type
//      declarations (`contacted_at: string | null`) are not writes and are not counted.
//
//   node scripts/check-human-contact-writers.mjs                 check
//   node scripts/check-human-contact-writers.mjs --write-baseline  refreeze (shrink only, by review)
//   node scripts/check-human-contact-writers.mjs --selftest        prove it can fail
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/data/human-contact-writers-baseline.json");
const ANCHOR_VERSION = "20261111100200";
const ALLOWED_SQL_FUNCTIONS = new Set(["fn_contact_log_stamp_application"]);

// key followed by ':' and NOT by a type name, optional marker or another declaration.
const TS_WRITE = /\b(?:last_)?contacted_at\s*:\s*(?!\s*(?:string|number|boolean|Date|unknown|any|never|null\s*[;|}]|[A-Z][A-Za-z0-9_]*\s*[;,|}\]>]))/g;
const SQL_WRITE = /\b(?:last_)?contacted_at\s*:?=\s*(?:now\(\)|coalesce|greatest|least|clock_timestamp|current_timestamp|new\.|v_\w+|p_\w+|statement_timestamp|transaction_timestamp|case\b|null\b|\$\d)/gi;

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}
function stripTsComments(src) {
  // Keep string bodies (a comment-only strip must not blank strings: MP-277's lesson).
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** Split SQL into [functionName|null, text] chunks so a write can be attributed. */
export function sqlWritesOutsideAllowed(sql) {
  const clean = stripSqlComments(sql);
  const hits = [];
  const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;
  const marks = [];
  let m;
  while ((m = fnRe.exec(clean))) marks.push({ at: m.index, name: m[1].toLowerCase() });
  const owner = (pos) => {
    let name = null;
    for (const mk of marks) if (mk.at <= pos) name = mk.name;
    return name;
  };
  SQL_WRITE.lastIndex = 0;
  while ((m = SQL_WRITE.exec(clean))) {
    const fn = owner(m.index);
    if (fn && ALLOWED_SQL_FUNCTIONS.has(fn)) continue;
    hits.push({ fn: fn ?? "(top level)", snippet: m[0].slice(0, 60) });
  }
  return hits;
}

export function countTsWrites(src) {
  const clean = stripTsComments(src);
  TS_WRITE.lastIndex = 0;
  return (clean.match(TS_WRITE) ?? []).length;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.includes("/tests/")
             && !p.endsWith("integrations/supabase/types.ts")) out.push(p);
  }
  return out;
}

function tsCounts() {
  const counts = {};
  for (const f of [...walk(join(ROOT, "src")), ...walk(join(ROOT, "supabase/functions"))]) {
    const n = countTsWrites(readFileSync(f, "utf8"));
    if (n > 0) counts[relative(ROOT, f)] = n;
  }
  return counts;
}

function newMigrations() {
  const dir = join(ROOT, "supabase/migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql") && f.slice(0, 14) > ANCHOR_VERSION).sort();
}

function compare(baseline, live) {
  const grew = [];
  for (const [file, n] of Object.entries(live)) {
    const was = baseline[file] ?? 0;
    if (n > was) grew.push(`${file}: ${was} -> ${n}`);
  }
  return grew;
}

function selftest() {
  const okSql = "create or replace function public.fn_contact_log_stamp_application() returns trigger as $$ begin update applications set contacted_at = coalesce(contacted_at, new.logged_at); end $$;";
  const badSql = "create or replace function public.fn_new_sender() returns void as $$ begin update applications set last_contacted_at = now(); end $$;";
  const commentSql = "-- update applications set contacted_at = now()\nselect 1;";
  const results = [
    ["allowed writer passes", sqlWritesOutsideAllowed(okSql).length === 0],
    ["new SQL writer fails", sqlWritesOutsideAllowed(badSql).length === 1],
    ["a comment is not a writer", sqlWritesOutsideAllowed(commentSql).length === 0],
    ["TS type declaration is not a write", countTsWrites("interface A { contacted_at: string | null; last_contacted_at?: string }") === 0],
    ["TS update payload is a write", countTsWrites("await sb.from('applications').update({ last_contacted_at: new Date().toISOString() })") === 1],
    ["TS comment is not a write", countTsWrites("// update({ contacted_at: now })\nconst x = 1;") === 0],
    ["count growth fails", compare({ "a.ts": 1 }, { "a.ts": 2 }).length === 1],
    ["new file fails", compare({}, { "b.ts": 1 }).length === 1],
    ["shrink passes", compare({ "a.ts": 3 }, { "a.ts": 1 }).length === 0],
  ];
  let bad = 0;
  for (const [name, ok] of results) { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) bad++; }
  if (bad) { console.error(`selftest: ${bad} case(s) failed: this guard cannot be trusted`); process.exit(1); }
  console.log("selftest: all cases behave; the guard can fail");
}

const args = new Set(process.argv.slice(2));
if (args.has("--selftest")) { selftest(); process.exit(0); }

const live = tsCounts();
if (args.has("--write-baseline")) {
  writeFileSync(BASELINE, JSON.stringify({ anchor_version: ANCHOR_VERSION, ts_write_counts: live }, null, 2) + "\n");
  console.log(`wrote ${relative(ROOT, BASELINE)}: ${Object.keys(live).length} files`);
  process.exit(0);
}
if (!existsSync(BASELINE)) { console.error("check-human-contact-writers: baseline missing; run with --write-baseline"); process.exit(1); }
const baseline = JSON.parse(readFileSync(BASELINE, "utf8")).ts_write_counts ?? {};

const failures = compare(baseline, live).map((s) => `TS writer grew: ${s}`);
for (const f of newMigrations()) {
  for (const h of sqlWritesOutsideAllowed(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"))) {
    failures.push(`SQL writer in ${f} (${h.fn}): ${h.snippet}`);
  }
}
if (failures.length) {
  console.error("check-human-contact-writers: new writes to contacted_at / last_contacted_at.");
  console.error("A human touch goes through public.fn_log_human_contact() (application_contact_log);");
  console.error("an automated touch writes last_automated_email_at. Never the legacy columns.");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
const total = Object.values(live).reduce((a, b) => a + b, 0);
console.log(`check-human-contact-writers: OK (${total} legacy TS writes across ${Object.keys(live).length} files, none new; ${newMigrations().length} migrations after ${ANCHOR_VERSION} clean)`);
