#!/usr/bin/env node
/**
 * check-admin-dashboard-render-health — the money/pipeline DAILY-DRIVER admin
 * dashboards must surface a dead feed as an error, never as a healthy zero.
 *
 * WHY THIS EXISTS (MP-WIB-ADMIN-RENDER-HEALTH, 2026-11-18). AdminFunnelHealth —
 * the recruiting pipeline health board Sam reads to see where recruits are stuck
 * — ran two React-Query feeds that each destructured `data = []` and took NO
 * isError. React Query's queryFn threw on a failed read, but with the result
 * defaulted to `[]` and no error handle, a dead v_next_step_funnel_health
 * rendered:  In funnel: 0 · Stalled: 0 · Active stages: 0, and the "Biggest
 * concentrated leak" card simply vanished. A clean, quiet, all-clear pipeline —
 * at the exact moment 915 recruits were stalled and the feed had just died. The
 * msgStats fallback went one worse: `const { data: rows } = await supabase…`
 * discarded the error outright, so a dead next_step_messages read printed "No
 * messages dispatched in the last 24h." This is the same fake-success class that
 * burned the landing counter, the hero ticker, the carrier-dormancy monitor and
 * the CFO snapshot: an ERROR rendered as a believable, healthy-looking number.
 *
 * DashboardToday was immunised against this (it routes every section through
 * <QueryState>, and money() returns "Unavailable" not "$0"), but nothing stopped
 * a sibling money/ops dashboard from re-shipping the silent-zero. This guard is
 * that stop, on the surfaces where a false 0 is a business lie.
 *
 * WHAT IT ASSERTS (static, no browser, no network — gates in verify:core):
 *   In each MANIFEST file, every `const { … } = useQuery(…)` /
 *   `= useSuspenseQuery(…)` destructure that gives `data` a DEFAULT value
 *   (`data = X` or `data: alias = X`) MUST also destructure an error signal
 *   (isError / isLoadingError / status / error) in the SAME braces. Defaulting
 *   data is exactly what hides the failure; taking an error signal is the handle
 *   that lets the component render the error. A destructure that defaults data
 *   and takes NO error signal is the AdminFunnelHealth bug → exit 1.
 *
 * Scope is a CURATED MANIFEST, not the whole repo, and held at ZERO — not a
 * frozen baseline. A repo-wide census on 2026-11-18 found ~60 destructures of
 * this shape across training/roster/course pages; most are lower-$ than a money
 * or pipeline board and are logged as a named follow-on, NOT silently frozen
 * here (a baseline of 60 reads as "covered" when it is not). New money/ops
 * daily-drivers are added to MANIFEST as they ship. A MANIFEST file that goes
 * missing is a FAIL, not a quiet pass: coverage can never silently drop because
 * a page was renamed.
 *
 * `--selftest` proves the pure scanner both directions with no fs. "could not
 * read a manifest file" is exit 2 and is NEVER laundered into a pass.
 *
 * Exit: 0 all manifest files clean | 1 a defaulted-data feed takes no error
 *       signal | 2 a manifest file is missing/unreadable (structural).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/strip-comments.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The money/pipeline daily-driver dashboards. A false 0 on any of these is a
// business lie Sam would act on (or fail to act on). Held at ZERO.
const MANIFEST = [
  "src/pages/AdminFunnelHealth.tsx",     // recruiting pipeline health — the 2026-11-18 instance
  "src/pages/DashboardToday.tsx",        // the one-screen money daily-driver (revenue + CFO snapshot)
  "src/pages/DashboardCommandCenter.tsx",// the admin command center (production stats, roster money)
  "src/pages/admin/RecruitFunnel.tsx",   // month-by-month recruiting conversion
  // Production-dashboard cluster (MP-WIB-ADMIN-RENDER-HEALTH wave 2, 2026-11-18).
  "src/components/dashboard/ProducerPulse.tsx",          // per-leg production pulse — dead v_leg_production used to VANISH the whole card
  "src/components/dashboard/BuilderProgressDashboard.tsx",// Sam's primary widget — dead feed rendered "No direct recruits yet"
  "src/components/dashboard/ImoByAgency.tsx",            // IMO/agency ALP + owner override — dead secondary feeds silently dropped attribution exceptions
  // Money/ops daily-driver cluster (MP-WIB-ADMIN-RENDER-HEALTH wave 3, 2026-11-18).
  "src/components/admin/InsuraCloudOutbox.tsx",  // deal→InsuraCloud sync — dead feeds rendered "Synced 0 · Pending 0 · Errored 0" (an all-clear outbox) and vanished both error lists; queryFns also swallowed the error
  "src/pages/LeadManager.tsx",                   // lead spend desk — dead RPCs rendered empty pools, empty closers board and "Nothing dropped yet"
  "src/pages/AutomationHealth.tsx",              // cron/automation health — a dead automation_run_log rendered "No runs logged yet" (the queryFn swallowed its error)
  "src/pages/HiringPipeline.tsx",                // recruiting kanban — a dead applications feed rendered an empty board, every stage reading 0
  "src/pages/AgentManagement.tsx",               // roster + production — a dead agents read rendered "no agents" as fact (the queryFn swallowed its error)
  // Licensing-pipeline cluster (MP-WIB-ADMIN-RENDER-HEALTH wave 4, 2026-11-18).
  // Unlicensed/pre-licensing producers can't write business; a false "clear" here hides the recruiting→income funnel stalling.
  "src/pages/admin/UnlicensedAll.tsx",           // unlicensed queue — a dead v_unlicensed_all rendered "No unlicensed record matches" (pile clear) + totals 0; mp257Kpis queryFn SWALLOWED its error → false 0/0 recovered/suppressed
  "src/pages/XcelPipeline.tsx",                  // paid pre-licensing students — a dead v_xcel_pipeline rendered Total 0, every state tile 0, "No students"
  "src/pages/PrelicensingManager.tsx",           // pre-licensing manager board — a dead applications feed rendered "0 agents" + a green ✓ "No applicants match" (a cheerful lie the pipeline is empty)
];

const ERROR_SIGNALS = ["isError", "isLoadingError", "status", "error"];

// ── pure core (no fs / no network; every branch driven by --selftest) ──

// Index of the brace that closes the '{' at openIndex. STRING-AWARE so braces
// inside a string default ('' / "" / ``) never miscount, and so an OBJECT
// default (`data = {}`) balances correctly. Run on stripComments() output.
export function matchBrace(text, openIndex) {
  let depth = 0;
  let inStr = null;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// `data` is given a default: `data =` or `data: alias =`, where the `=` is a real
// assignment (not `==`, `===`, or `=>`). The token must be a whole word so
// `metadata`/`dataUpdatedAt` never match.
const DATA_DEFAULT_RE = /(^|[^\w$])data\s*(?::\s*[A-Za-z_$][\w$]*\s*)?=(?![=>])/;
// any error signal present in the destructure body, whole-word.
const ERROR_SIGNAL_RE = new RegExp(`\\b(${ERROR_SIGNALS.join("|")})\\b`);

/**
 * Every offending destructure in a source string: a `const { … } = useQuery(…)`
 * / `useSuspenseQuery(…)` whose body defaults data but surfaces no error signal.
 * Returns [{ line, body }]. Pure; comments are blanked first so a token in prose
 * can never trip it (the MP-277 footnote lesson), strings are left intact.
 */
export function offenders(src) {
  const code = stripComments(src);
  const out = [];
  const openRe = /\bconst\s*\{/g;
  let m;
  while ((m = openRe.exec(code))) {
    const open = code.indexOf("{", m.index);
    if (open < 0) continue;
    const close = matchBrace(code, open);
    if (close < 0) continue;
    // What immediately follows the destructure's closing brace?
    const after = code.slice(close + 1);
    if (!/^\s*=\s*(useQuery|useSuspenseQuery)\s*[<(]/.test(after)) continue;
    const body = code.slice(open + 1, close);
    const defaultsData = DATA_DEFAULT_RE.test(body);
    const takesError = ERROR_SIGNAL_RE.test(body);
    if (defaultsData && !takesError) {
      const line = code.slice(0, m.index).split("\n").length;
      out.push({ line, body: body.replace(/\s+/g, " ").trim().slice(0, 90) });
    }
  }
  return out;
}

// ── selftest: prove the scanner both directions, NO fs ──
function selftest() {
  let pass = 0, total = 0;
  const ok = (cond, name) => { total++; if (cond) { pass++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

  // THE BUG: defaults data, no error signal (AdminFunnelHealth line 29 shape).
  const BUG = `const { data: funnel = [], isLoading: funnelLoading } = useQuery<FunnelRow[]>({ queryKey: ["x"], queryFn: async () => { const { data, error } = await supabase.from("v").select("*"); if (error) throw error; return data; } });`;
  const bugHits = offenders(BUG);
  ok(bugHits.length === 1, "BUG direction: data=[] with no error signal → 1 offender");

  // FIXED via whole-object (no destructure default) — the shape AdminFunnelHealth now uses.
  const FIX_OBJ = `const funnelQuery = useQuery<FunnelRow[]>({ queryKey: ["x"], queryFn: async () => [] }); const funnel = funnelQuery.data ?? [];`;
  ok(offenders(FIX_OBJ).length === 0, "FIX direction (whole object): no destructure default → clean");

  // FIXED via taking isError in the same braces.
  const FIX_ISERROR = `const { data = [], isError, refetch } = useQuery({ queryKey: ["x"], queryFn: async () => [] });`;
  ok(offenders(FIX_ISERROR).length === 0, "FIX direction (isError present) → clean");

  // FIXED via bare error.
  const FIX_ERROR = `const { data: rows = [], error } = useQuery({ queryKey: ["x"], queryFn: async () => [] });`;
  ok(offenders(FIX_ERROR).length === 0, "FIX direction (bare error present) → clean");

  // NO default at all is not the deceptive case (data is undefined on error, not a fake 0).
  const NO_DEFAULT = `const { data, isLoading } = useQuery({ queryKey: ["x"], queryFn: async () => [] });`;
  ok(offenders(NO_DEFAULT).length === 0, "no data default → not an offender (undefined is not a convincing 0)");

  // OBJECT default must still be caught, and matchBrace must balance the inner {}.
  const OBJ_DEFAULT = `const { data: m = {}, isLoading } = useQuery({ queryKey: ["x"], queryFn: async () => ({}) });`;
  const objHits = offenders(OBJ_DEFAULT);
  ok(objHits.length === 1, "object default (data = {}) with no error signal → 1 offender (brace balanced)");

  // useSuspenseQuery is the same class.
  const SUSPENSE = `const { data = [], isLoading } = useSuspenseQuery({ queryKey: ["x"] });`;
  ok(offenders(SUSPENSE).length === 1, "useSuspenseQuery with defaulted data + no error → offender");

  // COMMENT TRAP: the bug shape inside a comment must NOT count (stripComments blanks it).
  const COMMENT = `// const { data = [] } = useQuery({}) <- example in prose\nconst { data, isError } = useQuery({ queryKey: ["x"] });`;
  ok(offenders(COMMENT).length === 0, "bug shape inside a comment does not count");

  // WORD-BOUNDARY: metadata / dataUpdatedAt must not read as a `data` default.
  const LOOKALIKE = `const { metadata = [], dataUpdatedAt } = useQuery({ queryKey: ["x"] });`;
  ok(offenders(LOOKALIKE).length === 0, "metadata / dataUpdatedAt are not the `data` key");

  // NOT a query: a plain destructure with the same body must be ignored.
  const NOT_QUERY = `const { data = [], foo } = someObject;`;
  ok(offenders(NOT_QUERY).length === 0, "a non-useQuery destructure is out of scope");

  console.log(`\ncheck:admin-dashboard-render-health --selftest — ${pass}/${total} assertions pass (both directions).`);
  if (pass !== total) { console.error("SELFTEST FAILED — the render-health scanner is wrong."); process.exit(1); }
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

// Run the live check ONLY when invoked directly, never on import (so a unit test
// can import offenders()/matchBrace() without the file reading the tree).
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  let bad = 0;
  const report = [];
  for (const rel of MANIFEST) {
    let src;
    try {
      src = readFileSync(resolve(REPO, rel), "utf8");
    } catch (e) {
      console.error(`check:admin-dashboard-render-health — COULD NOT READ ${rel}: ${e.message}`);
      console.error("  A money/pipeline daily-driver in the manifest is missing or was renamed.");
      console.error("  Point MANIFEST at its new path, or remove it if the surface is gone — coverage");
      console.error("  must never silently drop because a file moved.");
      process.exit(2);
    }
    const hits = offenders(src);
    if (hits.length) {
      bad += hits.length;
      report.push({ rel, hits });
    }
  }
  if (bad) {
    console.error(`check:admin-dashboard-render-health — ${bad} money/pipeline feed(s) render a dead read as a healthy zero:`);
    for (const { rel, hits } of report) {
      for (const h of hits) {
        console.error(`  🔴 ${rel}:${h.line} — { ${h.body} }`);
        console.error(`        defaults data but takes no error signal (${ERROR_SIGNALS.join("/")}).`);
      }
    }
    console.error("  A failed read on these surfaces must show an error with Retry, not 0 / empty.");
    console.error("  Fix: route the query through <QueryState {...describeQuery(q)}>, or destructure an");
    console.error("  error signal and render it. See src/pages/AdminFunnelHealth.tsx for the pattern.");
    process.exit(1);
  }
  console.log(`check:admin-dashboard-render-health — OK: ${MANIFEST.length} money/pipeline daily-drivers surface query errors (0 silent-zero feeds).`);
  process.exit(0);
}
