import { stripComments } from "./lib/strip-comments.mjs";
import fs from "node:fs";
import path from "node:path";

// website-integrity-bot — unbounded `select("*")` on a growing table ratchet.
//
// Class-of-fix. Same family as the other commit-time ratchets
// (check-maybesingle-nonunique, check-stale-key-in-list, check-empty-catch):
// a per-site-key baseline the floor only ever ratchets DOWN.
//
// THE FAILURE PATTERN (payload + PII leak that grows silently):
//   supabase.from("applications").select("*")        // 159 columns, no filter
//     ... then .map(r => ({ name: r.first_name, ... }))  // uses 12 fields
//   An admin page mounts, pulls EVERY column of EVERY row of a wide, growing
//   table into the browser, renders a handful of fields, and throws the rest
//   away. The waste compounds on two axes at once: every new row AND every new
//   column the schema gains. `applications` already carries PII that is never
//   rendered (consent_ip_address, consent_user_agent, nipr_data, nipr_number,
//   fingerprints_submitted_at, resume_url) plus large free-text / JSON columns
//   (motivation, notes, attribution_json, owner_alert_meta) — all shipped to
//   the client on mount and discarded.
//
//   This is the 465-fake-success class in spirit (memory:
//   project_apex_2026_05_18_insuracloud_auth_dead): GREEN in the tested
//   small-data state, degrading silently as the agency grows. A status check
//   and a render check both stay green while the payload (and the PII exposure)
//   balloons with the table.
//
//   Shipped 2026-11-20 `ebc7ec9c` (MP-WIB-SELECT-STAR-ALLLEADS):
//   AllLeadsPanel.tsx — the admin daily-driver — went from select("*") (159
//   cols) to the 12 rendered columns. This guard locks that gain in and stops
//   the next one re-shipping.
//
// DETECTION (regex scanner — deterministic, tolerant via the keyed baseline):
//   A violation is a single-statement supabase chain that:
//     • reads a LITERAL table name   .from("<table>")
//     • selects the whole row        .select("*")  /  .select('*')
//     • carries NO row-bounding method IN THE SAME CHAIN — none of
//       limit range single maybeSingle eq neq in is not gt gte lt lte
//       like ilike match filter or contains containedBy overlaps textSearch.
//   `.select("*", { count: "exact", head: true })` is a head request that
//   downloads ZERO rows, so its `("*", {…})` form never matches the
//   select-star pattern and is correctly ignored.
//
//   KNOWN, STABLE false positives live in the baseline on purpose (a
//   regex scanner cannot see a filter applied to a REASSIGNED query var):
//     let q = from("x").select("*");  q = q.eq("owner", me);   // multi-stmt
//   The filter is on `q`, not on the literal chain, so the chain reads as
//   unbounded. These are real code, correctly row-scoped, and tolerated —
//   the baseline's whole job is to tolerate the stable ones and fail only on
//   a NEW one. (e.g. AgentPipeline.tsx builds its filter on a reassigned var.)
//
//   Table name that is a variable / template literal -> `unprovable`: reported
//   as its own verdict, never silently counted safe, never counted a hit.
//
//   VIEWS are excluded. A `select("*")` on `v_xxx` asks for exactly the
//   columns the view author chose to expose — the view IS the projection, so
//   the client is not over-fetching. The relation kind is read from the
//   relation-kind snapshot (scripts/data/unique-index-catalog.json, same
//   source as check-maybesingle-nonunique). kind r/p -> a base table (gradeable
//   leak); kind v -> the view projection (safe); NOT in the snapshot ->
//   `unprovable` (reported, never fabricated into a violation from a stale
//   snapshot — the conservative direction for a commit gate; a newly-created
//   base table absent from the snapshot is reported, not failed, until the
//   catalog is refreshed).
//
//   Comments are stripped (shared lexer) before scanning, so prose that quotes
//   `.from("x").select("*")` in a header like this one never false-positives —
//   the MP-277 "a guard that counts its own footnotes" trap.
//
// THE RIGHT FIX:
//   Project to the columns the component actually renders:
//     .select("id, first_name, last_name, email, status, created_at")
//   Zero behaviour change when every field access is already 1:1 (no `...row`
//   spread, no bracket access, no raw-row child pass-through). For a path that
//   legitimately needs the whole row (a user-triggered CSV export, a one-time
//   admin setup), either keep it in EXCLUDE_FILES or annotate the line (or the
//   line above) with `select-star-allow:<why>`.
//
// GRADING — per site-key (file::table), NOT a single integer. MP-356 (recorded
//   in check-maybesingle-nonunique's header) proved a bare count is fungible:
//   a regression in one file silently offsets a pay-down in another and the
//   floor never moves. Keyed on file+table (NO line number — line numbers
//   shift under unrelated edits above a site and would make this the
//   permanently-red guard this repo has ten costumes of), a new or grown key
//   fails; a shrunk key must be re-baselined so the ground cannot be given back.
//
//   Regenerate the baseline with:  node scripts/check-select-star-unbounded.mjs --write-baseline
//
// Cost when fired: ~80-150ms (single-pass scan over ~530 src files).

const repoRoot = path.resolve(import.meta.dirname, "..");
const ROOTS = ["src"];
const MARKER = "select-star-allow:";
const SITE_BASELINE = "scripts/data/select-star-unbounded-baseline.json";
const CATALOG = "scripts/data/unique-index-catalog.json";

const EXCLUDE_FILES = new Set([
  // The guard itself (its header quotes the pattern).
  "scripts/check-select-star-unbounded.mjs",
  // User-triggered CSV export legitimately needs the full row (memory:
  // admin_select_star_wide_table). Not a mount-time leak; a deliberate dump.
  "src/components/dashboard/LeadExporter.tsx",
]);

const EXCLUDE_PATTERNS = [/\.test\.(tsx?|jsx?)$/, /\.spec\.(tsx?|jsx?)$/, /__tests__\//];

const TEXT_EXTS = new Set([".tsx", ".jsx", ".ts", ".js"]);

// Row-bounding methods: either cap row count or filter rows. `.order()` does
// NOT bound and is intentionally absent. Matched as `.name(` anywhere in the
// chain slice.
const BOUND_METHODS = [
  "limit", "range", "single", "maybeSingle",
  "eq", "neq", "in", "is", "not",
  "gt", "gte", "lt", "lte",
  "like", "ilike", "match", "filter", "or",
  "contains", "containedBy", "overlaps", "textSearch",
];
const BOUND_RE = new RegExp(`\\.(?:${BOUND_METHODS.join("|")})\\(`);

// .select("*") / .select('*') / .select(`*`) with only whitespace inside the
// parens. The `("*", {…})` head-count form has a comma and never matches.
const SELECT_STAR_RE = /\.select\(\s*(["'`])\*\1\s*\)/g;

function walk(rel, out = []) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return out;
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    if (TEXT_EXTS.has(path.extname(rel))) out.push(rel);
    return out;
  }
  for (const entry of fs.readdirSync(abs)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    walk(path.join(rel, entry), out);
  }
  return out;
}

function isExcluded(rel) {
  if (EXCLUDE_FILES.has(rel)) return true;
  return EXCLUDE_PATTERNS.some((re) => re.test(rel));
}

// From an index at an opening "(", return the index just past the matching
// ")", skipping over string literals so a paren inside a string arg does not
// unbalance the count. All three quote kinds are skipped opaquely.
function skipBalancedParens(src, openIdx) {
  const n = src.length;
  let depth = 0;
  let i = openIdx;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") i += 2;
        else i++;
      }
      i++; // past closing quote (or EOL)
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

// From `startIdx` (just after the select's closing paren), walk forward over
// chained `.method(...)` calls (whitespace / newlines allowed between them,
// string-aware paren matching) and return the index where the chain ends.
function forwardChainEnd(src, startIdx) {
  const n = src.length;
  let i = startIdx;
  for (;;) {
    while (i < n && /\s/.test(src[i])) i++;
    if (src[i] !== ".") return i;
    let j = i + 1;
    while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
    let k = j;
    while (k < n && /\s/.test(src[k])) k++;
    if (src[k] !== "(") return i; // `.prop` with no call -> chain ends
    const after = skipBalancedParens(src, k);
    if (after === -1) return n;
    i = after;
  }
}

// Scan one file's RAW text. `relKind` is table -> "r"|"p"|"v" (base/partition/
// view). Returns hits/unprovable/bounded/marked. Used by BOTH the live scan and
// the selftest (no duplicated logic — the harness exercises the real predicates).
function scanText(raw, relKind = {}) {
  const src = stripComments(raw);
  const rawLines = raw.split("\n");
  const hits = [];
  const unprovable = [];
  let bounded = 0;
  let marked = 0;

  for (const m of src.matchAll(SELECT_STAR_RE)) {
    const i = m.index;
    const lineNo = src.slice(0, i).split("\n").length;

    // Marker lives in a comment, so read it from RAW (stripComments blanks it).
    const here = rawLines[lineNo - 1] ?? "";
    const above = rawLines[lineNo - 2] ?? "";
    if (here.includes(MARKER) || above.includes(MARKER)) {
      marked++;
      continue;
    }

    const fromIdx = src.lastIndexOf(".from(", i);
    const rpcIdx = src.lastIndexOf(".rpc(", i);
    if (fromIdx === -1) {
      bounded++; // a select("*") with no .from() root is not a table read
      continue;
    }
    if (rpcIdx > fromIdx) {
      bounded++; // nearer .rpc() -> this chain is an RPC, not a table read
      continue;
    }

    const selectEnd = i + m[0].length;
    const chainEnd = forwardChainEnd(src, selectEnd);
    const chain = src.slice(fromIdx, chainEnd);

    const tm = chain.match(/^\.from\(\s*["'`]([A-Za-z0-9_]+)["'`]/);
    const table = tm ? tm[1] : null;

    if (BOUND_RE.test(chain)) {
      bounded++;
      continue;
    }
    if (!table) {
      unprovable.push({ lineNo, why: "table name is a variable or template literal" });
      continue;
    }
    const kind = relKind[table];
    if (kind === "v") {
      bounded++; // a view IS the projection — select("*") is not over-fetching
      continue;
    }
    if (kind === undefined) {
      unprovable.push({ lineNo, why: `${table} is not in the relation-kind snapshot` });
      continue;
    }
    hits.push({ lineNo, table });
  }
  return { hits, unprovable, bounded, marked };
}

// ---------- selftest ----------
function selftest() {
  // Stub relation-kind map so the selftest exercises the REAL classification
  // (base table -> gradeable, view -> safe, absent -> unprovable).
  const rk = { applications: "r", leads: "r", x: "r", agents: "r", deals: "r", v_foo: "v" };
  const cases = [
    ['const { data } = await supabase.from("applications").select("*");', 1, "applications", "unbounded on a base table -> HIT"],
    ['supabase.from("applications").select("*").eq("id", id)', 0, null, "filter after select -> bounded"],
    ['supabase.from("x").select("*").limit(10)', 0, null, ".limit after -> bounded"],
    ['supabase.from("x").select("*").maybeSingle()', 0, null, ".maybeSingle after -> bounded"],
    ['supabase.from("x").select("*").order("created_at")', 1, "x", ".order does NOT bound -> HIT"],
    ['supabase.from("deals").select("*", { count: "exact", head: true })', 0, null, "head-count form never matches select-star"],
    ['const q = supabase.from("leads").select("*");\nq = q.eq("owner", me);', 1, "leads", "multi-stmt reassigned filter -> HIT (stable false positive, baselined)"],
    ['supabase.from("v_foo").select("*")', 0, null, "view is the projection -> bounded (safe)"],
    ['supabase.from("some_uncatalogued_table").select("*")', 0, null, "table absent from snapshot -> unprovable, not a hit"],
    ['supabase.from(tableVar).select("*")', 0, null, "variable table -> unprovable, not a hit"],
    ['supabase.rpc("get_rows").select("*")', 0, null, "nearer .rpc() -> not a table read"],
    ['// supabase.from("applications").select("*") in prose', 0, null, "comment is stripped -> not a hit"],
    ['supabase\n  .from("agents")\n  .select("*")\n  .in("id", ids)', 0, null, "multi-line chain, .in after -> bounded"],
    ['supabase.from("x").select(\'*\').is("terminated_at", null)', 0, null, ".is() null-filter -> bounded"],
    ['x.select("*")', 0, null, "no .from() root -> not a table read"],
  ];
  let pass = 0;
  for (const [snippet, expectHits, expectTable, label] of cases) {
    const { hits, unprovable } = scanText(snippet, rk);
    const gotHits = hits.length;
    const gotTable = hits[0]?.table ?? null;
    let ok = gotHits === expectHits;
    if (ok && expectHits === 1) ok = gotTable === expectTable;
    // the variable / uncatalogued-table cases must land in unprovable, not hits
    if (snippet.includes("tableVar") || snippet.includes("some_uncatalogued_table"))
      ok = gotHits === 0 && unprovable.length === 1;
    console.log(`  ${ok ? "PASS" : "FAIL"} — ${label} (hits ${gotHits}${expectHits ? `/${expectHits} table=${gotTable}` : ""})`);
    if (ok) pass++;
  }
  const allPass = pass === cases.length;
  console.log(`\n[check:select-star-unbounded --selftest] ${pass}/${cases.length} ${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

if (process.argv.includes("--selftest")) selftest();

// ---------- live scan ----------
let relKind = {};
try {
  relKind = JSON.parse(fs.readFileSync(path.join(repoRoot, CATALOG), "utf8")).relation_kind ?? {};
} catch (e) {
  console.error(`❌ ${CATALOG} is missing or unreadable (${e.message}).`);
  console.error("It distinguishes base tables (gradeable) from views (the projection). Run: bash scripts/refresh-unique-index-catalog.sh");
  process.exit(1);
}

let totalFiles = 0;
const allHits = [];
const allUnprovable = [];
let totalBounded = 0;
let totalMarked = 0;

for (const dir of ROOTS) {
  for (const rel of walk(dir)) {
    if (isExcluded(rel)) continue;
    totalFiles++;
    const { hits, unprovable, bounded, marked } = scanText(fs.readFileSync(path.join(repoRoot, rel), "utf8"), relKind);
    totalBounded += bounded;
    totalMarked += marked;
    for (const h of hits) allHits.push({ rel, ...h });
    for (const u of unprovable) allUnprovable.push({ rel, ...u });
  }
}

const keyOf = (h) => `${h.rel}::${h.table}`;
const observed = new Map();
for (const h of allHits) observed.set(keyOf(h), (observed.get(keyOf(h)) ?? 0) + 1);

if (process.argv.includes("--write-baseline")) {
  const sites = Object.fromEntries([...observed.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
  fs.writeFileSync(
    path.join(repoRoot, SITE_BASELINE),
    JSON.stringify(
      {
        _why:
          "Floor for check-select-star-unbounded.mjs, keyed per file::table so a regression " +
          "in one file cannot be offset by a pay-down in another (MP-356). No line numbers: " +
          "they shift under unrelated edits. See the guard header.",
        total: allHits.length,
        sites,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${SITE_BASELINE}: ${observed.size} site-keys, ${allHits.length} hits`);
  process.exit(0);
}

let baseline;
try {
  baseline = new Map(Object.entries(JSON.parse(fs.readFileSync(path.join(repoRoot, SITE_BASELINE), "utf8")).sites));
} catch (e) {
  console.error(`❌ ${SITE_BASELINE} is missing or unreadable (${e.message}).`);
  console.error("It is the floor this guard grades against — without it nothing is measured.");
  process.exit(1);
}

const baselineTotal = [...baseline.values()].reduce((a, b) => a + b, 0);
console.log(
  `[check:select-star-unbounded] ${totalFiles} files · unbounded:${allHits.length} (baseline ${baselineTotal})  ` +
    `bounded:${totalBounded}  marked:${totalMarked}  unprovable:${allUnprovable.length}`,
);
console.log(`  grading ${observed.size} site-keys against ${baseline.size} baselined · unprovable is its own verdict, not a pass`);

const regressions = [];
const paydowns = [];
for (const [k, n] of observed) {
  const b = baseline.get(k) ?? 0;
  if (n > b) regressions.push({ k, b, n });
}
for (const [k, b] of baseline) {
  const n = observed.get(k) ?? 0;
  if (n < b) paydowns.push({ k, b, n });
}

if (regressions.length) {
  console.error(`\n❌ ${regressions.length} new/grown unbounded select("*") site-key(s) on a growing table.\n`);
  console.error('An admin page pulling `.from("<table>").select("*")` with no filter/limit');
  console.error("downloads every column of every row (incl. PII never rendered) to the browser");
  console.error("and discards most of it. The waste grows with every new row AND column.");
  console.error("");
  console.error("Fix: project to the columns the component renders —");
  console.error('  .select("id, first_name, last_name, email, status, created_at")');
  console.error(`Or, for a legitimate full-row path, annotate the line (or line above) with`);
  console.error(`  ${MARKER}<why-the-whole-row-is-needed>  (or add the file to EXCLUDE_FILES).\n`);
  for (const { k, b, n } of regressions) {
    console.error(`  ${k}: ${b} -> ${n}`);
    for (const h of allHits) if (keyOf(h) === k) console.error(`    at ${h.rel}:${h.lineNo}`);
  }
  if (paydowns.length) {
    console.error(`\n  (${paydowns.length} unrelated site-key(s) were paid down in the same tree.`);
    console.error("   They do NOT offset the above — that is the whole point of this baseline.)");
  }
  console.error("");
  console.error("Green-in-small-data, broken-as-you-grow is the 465 fake-success class. No fake success.");
  process.exit(1);
}

if (paydowns.length) {
  console.error(`\n❌ ${paydowns.length} site-key(s) were paid down. Update ${SITE_BASELINE} so the ground cannot be given back:\n`);
  for (const { k, b, n } of paydowns) console.error(`  ${k}: ${b} -> ${n}`);
  console.error(`\nRegenerate with: node scripts/check-select-star-unbounded.mjs --write-baseline`);
  process.exit(1);
}

console.log("✅ No new unbounded select(\"*\") on a growing table.");
