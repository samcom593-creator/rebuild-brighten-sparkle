#!/usr/bin/env node
/**
 * check:view-window-vs-threshold — MP-412
 *
 * Catches one specific, silent class: a view whose verdict branch is UNREACHABLE
 * because the row window is tighter than the threshold that branch tests.
 *
 * The motivating bug (public.automation_health, live for ~4 months):
 *
 *     WHERE triggered_at > now() - interval '24 hours'   <-- row window
 *     ...
 *     CASE WHEN last_run < now() - interval '2 days' THEN 'stale'
 *
 * Every row the CTE can produce has last_run inside 24h, so it can never be
 * older than 2 days. 'stale' was dead code. That is not cosmetic: it means a job
 * that STOPS running leaves the view entirely instead of being reported stale,
 * and an empty result reads as "nothing wrong" on every surface downstream.
 * Absence rendered as health -- the same shape as v_stripe_event_health going
 * blank-green the moment Stripe went dark.
 *
 * WHERE TRUTH LIVES (this repo has paid for getting this wrong before):
 *   - This guard reads ONLY migration SQL, and only each view's LAST definition,
 *     so a superseded broken definition in history can never make it red. A
 *     permanently-red guard is one everybody learns to skip.
 *   - Migrations do NOT model this database -- views and functions are routinely
 *     hand-applied via bot-sql. So this guard is NOT the authority on deployed
 *     state. Nothing here should be read as "prod is clean".
 *
 * DELIBERATELY NARROW, and narrowed again after its FIRST live run accused an
 * innocent view. The obvious rule -- "the tightest window in the view bounds
 * every row it can emit" -- is a proxy at the wrong grain. v_telegram_dashboard
 * is a flat list of INDEPENDENT scalar subqueries: one counts users active
 * within 24h, a sibling counts users idle beyond 7 days. Neither bounds the
 * other and stale_7d is perfectly reachable. Matching on "same column name"
 * would not have saved it either -- both siblings read last_active_at.
 *
 * The discriminator that actually separates the bug from the bystander is
 * DERIVATION: in the real defect the threshold is evaluated over rows PRODUCED
 * BY the window. So this guard grades exactly one shape:
 *
 *     WITH <cte> AS (SELECT ..., agg(<col>) AS <alias> ... WHERE <col> > now() - X)
 *     SELECT ... CASE WHEN <alias> < now() - Y ...   FROM <cte>
 *
 * and fails only when Y >= X. Sibling subqueries, unrelated tables and
 * self-contained filters are structurally out of scope, not merely tolerated.
 *
 * Everything it cannot place in that shape is reported `unprovable` and PRINTED
 * -- never laundered into a pass, never failed on. Coverage is published, not
 * graded: grading coverage pins the guard yellow over how many views happen to
 * use a CTE, which is the permanently-yellow failure mode this repo keeps paying
 * for.
 *
 * NOT COVERED, and the header says so rather than implying otherwise:
 *   - windows built from a column, a GUC, or a function call rather than a literal
 *   - thresholds in a WHERE rather than a projection/CASE
 *   - derivation through more than one CTE hop
 *   - calendar units (month/year), which are not a fixed number of seconds
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = "supabase/migrations";

// Postgres interval literals we can compare. Deliberately no month/year: those
// are calendar-relative and not a fixed number of seconds, so ordering them
// against an hour count would be a guess wearing a number's clothes.
const UNIT_SECONDS = {
  second: 1, seconds: 1, sec: 1, secs: 1,
  minute: 60, minutes: 60, min: 60, mins: 60,
  hour: 3600, hours: 3600, hr: 3600, hrs: 3600,
  day: 86400, days: 86400,
  week: 604800, weeks: 604800,
};

/** '2 days' -> 172800.  '24:00:00' -> 86400.  Anything else -> null (unprovable). */
export function intervalSeconds(lit) {
  if (!lit) return null;
  const s = String(lit).trim().toLowerCase();
  const clock = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (clock) return +clock[1] * 3600 + +clock[2] * 60 + +clock[3];
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);
  if (!m) return null;
  const unit = UNIT_SECONDS[m[2]];
  return unit === undefined ? null : Math.round(parseFloat(m[1]) * unit);
}

/** Strip -- line comments and block comments so prose about a bug is never parsed as SQL. */
export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

// `now() - interval 'X'` and the equivalent `now() - 'X'::interval`.
const NOW_MINUS = String.raw`now\(\)\s*-\s*(?:interval\s*'([^']+)'|'([^']+)'::interval)`;

/** Split `WITH a AS (...), b AS (...) <tail>` into named CTE bodies plus the tail. */
export function splitCtes(body) {
  const ctes = new Map();
  const m = /^\s*with\s+/i.exec(body);
  if (!m) return { ctes, tail: body };
  let i = m[0].length;
  while (i < body.length) {
    const name = /\s*([a-z0-9_"]+)\s+as\s*\(/iy;
    name.lastIndex = i;
    const nm = name.exec(body);
    if (!nm) break;
    let depth = 1, j = name.lastIndex;
    for (; j < body.length && depth > 0; j++) {
      if (body[j] === "(") depth++;
      else if (body[j] === ")") depth--;
    }
    ctes.set(nm[1].replace(/"/g, "").toLowerCase(), body.slice(name.lastIndex, j - 1));
    const rest = /\s*,\s*/y;
    rest.lastIndex = j;
    if (rest.exec(body)) { i = rest.lastIndex; continue; }
    return { ctes, tail: body.slice(j) };
  }
  return { ctes, tail: body };
}

/**
 * Remove `FILTER (WHERE ...)` clauses. An aggregate FILTER narrows ONE COUNTER;
 * it does not bound the rows the CTE emits. Caught live: automation_health's real
 * row window is 3 days, but its counters carry FILTER (WHERE ... > now() - '24
 * hours'), and reading those as the row window made this guard accuse the very
 * view it was written to protect.
 */
export function stripAggregateFilters(sql) {
  let out = "", i = 0;
  const re = /\bfilter\s*\(/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    out += sql.slice(i, m.index);
    let depth = 1, j = re.lastIndex;
    for (; j < sql.length && depth > 0; j++) {
      if (sql[j] === "(") depth++;
      else if (sql[j] === ")") depth--;
    }
    i = j;
    re.lastIndex = j;
  }
  return out + sql.slice(i);
}

/** In a CTE body: which column is the row window applied to, and how wide is it? */
function windowOf(rawBody) {
  const cteBody = stripAggregateFilters(rawBody);
  const re = new RegExp(String.raw`([a-z0-9_]+)\.?([a-z0-9_]*)\s*>\s*\(?\s*` + NOW_MINUS, "gi");
  let best = null;
  for (const m of cteBody.matchAll(re)) {
    const col = (m[2] || m[1]).toLowerCase();
    const secs = intervalSeconds(m[3] ?? m[4]);
    if (secs === null) return { unprovable: true };
    if (!best || secs < best.secs) best = { col, secs, lit: m[3] ?? m[4] };
  }
  return best;
}

/** Output aliases of the CTE that carry the windowed column, e.g. max(t) AS last_run. */
function aliasesCarrying(cteBody, col) {
  const out = new Set([col]);
  const re = new RegExp(String.raw`(?:max|min)\s*\(\s*[a-z0-9_]*\.?` + col + String.raw`\s*\)\s*as\s+([a-z0-9_]+)`, "gi");
  for (const m of cteBody.matchAll(re)) out.add(m[1].toLowerCase());
  return out;
}

/** Replay every migration, keeping only each view's LAST definition. */
export function latestViewDefs(dir) {
  const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
  const latest = new Map();
  for (const f of files) {
    const sql = stripSqlComments(readFileSync(join(dir, f), "utf8"));
    const re = /create\s+(?:or\s+replace\s+)?view\s+([a-z0-9_."]+)\s+as\b/gi;
    let m;
    while ((m = re.exec(sql)) !== null) {
      const name = m[1].replace(/"/g, "");
      let depth = 0, end = sql.length;
      for (let i = re.lastIndex; i < sql.length; i++) {
        const c = sql[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === ";" && depth <= 0) { end = i; break; }
      }
      latest.set(name, { file: f, body: sql.slice(re.lastIndex, end) });
    }
  }
  return latest;
}

const views = latestViewDefs(MIG_DIR);

const graded = [], unprovable = [], violations = [];

for (const [name, { file, body }] of views) {
  const { ctes, tail } = splitCtes(body);
  if (ctes.size === 0) continue; // not the derived shape at all — out of scope by design

  for (const [cteName, cteBody] of ctes) {
    // The tail must actually READ this CTE, or the threshold is not evaluated
    // over the windowed rows and the whole comparison is meaningless.
    if (!new RegExp(String.raw`\bfrom\b[^;]*?\b${cteName}\b`, "i").test(tail)) continue;

    const w = windowOf(cteBody);
    if (!w) continue;
    if (w.unprovable) { unprovable.push({ name, file, why: `row window in CTE ${cteName} uses an interval this guard cannot order` }); continue; }

    const carriers = aliasesCarrying(cteBody, w.col);
    const thresholdRe = new RegExp(String.raw`([a-z0-9_]+)\.?([a-z0-9_]*)\s*<\s*\(?\s*` + NOW_MINUS, "gi");
    let sawThreshold = false;
    for (const m of tail.matchAll(thresholdRe)) {
      const col = (m[2] || m[1]).toLowerCase();
      if (!carriers.has(col)) continue; // threshold on some unrelated column
      const secs = intervalSeconds(m[3] ?? m[4]);
      if (secs === null) { unprovable.push({ name, file, why: `threshold on ${col} uses an interval this guard cannot order` }); continue; }
      sawThreshold = true;
      if (secs >= w.secs) {
        violations.push({ name, file, cte: cteName, col, alias: col, window: w.lit, windowSecs: w.secs, threshold: m[3] ?? m[4], thresholdSecs: secs });
      }
    }
    if (sawThreshold) graded.push(`${name}.${cteName}`);
  }
}

console.log(`check:view-window-vs-threshold — ${graded.length} view(s) graded, ${unprovable.length} unprovable, ${views.size} view definition(s) seen`);
for (const u of unprovable) console.log(`  · unprovable: ${u.name} (${u.file}) — ${u.why}`);
for (const g of graded) console.log(`  · graded: ${g}`);

if (violations.length > 0) {
  console.error(`\n✗ ${violations.length} unreachable verdict branch(es):\n`);
  for (const v of violations) {
    console.error(`  ${v.name}  [${v.file}]  — CTE ${v.cte}, column ${v.col}`);
    console.error(`    row window : now() - '${v.window}'  (${v.windowSecs}s)`);
    console.error(`    threshold  : now() - '${v.threshold}'  (${v.thresholdSecs}s)`);
    console.error(`    Every row is newer than the window, so it can never be older than the`);
    console.error(`    threshold. That branch is dead, and a subject that goes quiet LEAVES the`);
    console.error(`    view instead of tripping it — an absence that reads as health downstream.`);
    console.error(`    Fix: widen the row window past the threshold, or drop the dead branch.\n`);
  }
  process.exit(1);
}
console.log("✓ every graded view can reach the branch it tests for");
