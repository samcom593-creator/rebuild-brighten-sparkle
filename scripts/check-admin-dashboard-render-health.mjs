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
  // Retention/strikes cluster (MP-WIB-ADMIN-RENDER-HEALTH wave 5, 2026-11-18).
  // A dead conduct feed renders a clear record; a dead churn feed renders "everyone's active".
  "src/pages/AdminStrikes.tsx",                  // conduct desk — a dead v_strike_summary rendered 0 active/flagged tiles + "Nobody on the wrong side 🟢"; dead v_agent_strikes rendered a "Clear board"
  "src/pages/InactiveAgents.tsx",                // retention queue — the queryFn SWALLOWED its error and rendered "everyone's active" + 0 severity tiles (producer churn is the agency's core problem)
  "src/pages/MyStrikes.tsx",                     // agent-facing conduct record — a dead v_agent_strikes rendered "Clear" standing + confetti, telling an agent they're clean when the feed died
  "src/components/dashboard/LicensingDelegateSection.tsx", // applicant-detail delegate panel — BOTH queryFns SWALLOWED .error and rendered "No delegates assigned"
  // Money/production-ops cluster (MP-WIB-ADMIN-RENDER-HEALTH wave 6, 2026-11-19).
  // The 23:29 "lower-$ tail" framing missed these — they are the money/production
  // path, not training/course. A dead feed here hides the recruiting→income funnel.
  "src/components/deals/DealEntryForm.tsx",      // the deal-entry money path — the carriers queryFn SWALLOWED .error, so a dead carriers read rendered an empty dropdown (looked like "no carriers exist") with no signal the feed was down
  "src/pages/AdminStuckPool.tsx",                // stuck lead-spend recovery — a dead v_next_step_stuck_pool rendered "No stalled people match these filters. 🎉" (an all-clear while the pool feed was dead)
  "src/pages/AdminPolicyLeads.tsx",              // policy-review inbound leads — a dead phc_admin_leads rendered "No policy-review leads yet" (a false empty funnel)
  "src/pages/AdminMissingAlLink.tsx",            // production-attribution gap — a dead v_agents_missing_al_link rendered "Every active agent has an AgentLink link" (hides commission attribution holes)
  "src/pages/ManagerNextStepBoard.tsx",          // manager pipeline board — a dead v_next_step_manager_board rendered "No active people in your downline" (a false empty downline)
  "src/pages/admin/CompTiersSettings.tsx",       // comp-tier money config — the queryFn SWALLOWED both reads' errors, so a dead v_agents_full rendered an empty comp editor (looked like "no agents to pay")
  // Notifications/delivery cluster (MP-WIB-ADMIN-RENDER-HEALTH wave 7, 2026-11-19).
  // A delivery LOG rendering a dead feed as an empty all-clear is the exact
  // fake-success class this page exists to catch (bounces/failures hidden).
  "src/pages/EmailDeliveryLog.tsx",              // email delivery log — the queryFn SWALLOWED .error, so a dead email_delivery_log read rendered Total 0 · Sent 0 · Bounced 0 · Failed 0 + "No email logs" (a believable all-clear on the one page that exists to surface delivery failures)
  "src/pages/GettingStarted.tsx",                // onboarding tracker (recruiting→income funnel) — the progress queryFn SWALLOWED .error, so a dead getting_started_progress read rendered an empty board / "No agents match" — a false "nobody pending, all caught up" at the exact moment a hire could be stalled with the feed down
  // Recruiting-ops + infra-config cluster (MP-WIB-ADMIN-RENDER-HEALTH wave 9, 2026-11-19).
  // The highest-$ of the remaining tail: hire-routing (recruiting funnel) and the
  // integration credentials the bots/alerts run on.
  "src/pages/HiringManagerAssignments.tsx",      // hire-routing desk — the assignments queryFn SWALLOWED .error, so a dead hiring_manager_assignments read rendered a confident routing board + a false "Coverage gaps detected" amber card off an empty feed (new hires silently route to nobody). eligibleManagers is the Assign-dialog picker (secondary, whole-object)
  "src/pages/admin/IntegrationsSettings.tsx",    // bot-token + Discord-webhook config — BOTH queryFns SWALLOWED .error; a dead system_settings read rendered "⚠ NOT CONFIGURED" with an "Activate Bot Access" button that MINTS A NEW TOKEN over the live one (every bot breaks), and "Discord not configured yet" over a working webhook. Activate is now disabled on isError
  "src/pages/AdminBoardAccess.tsx",              // manager board-access grid — the managers queryFn SWALLOWED both inner reads' errors, so a dead user_roles/profiles read rendered "No managers yet" (an empty access board); grants is the per-cell toggle overlay (secondary, whole-object)
  // Delivery-log cluster (MP-WIB-ADMIN-RENDER-HEALTH wave 10, 2026-11-19).
  // A delivery LOG rendering a dead feed as an empty all-clear is the exact
  // fake-success class this guard exists for — same as EmailDeliveryLog (wave 7).
  "src/pages/NotificationHub.tsx",               // notification delivery log — the queryFn THREW on error, but the page destructured `data: logs = []` with NO error signal, so a dead v_notification_log_with_role read rendered the NotificationStats band as 0 today / 0 failed and an empty log table — a believable all-clear on the one page that exists to surface push/SMS/email delivery failures. Now takes isError/error/refetch; the stat band and the log table both render <QueryState error> with Retry instead of a fake 0
  // Compliance + sales-QA cluster (MP-WIB-ADMIN-RENDER-HEALTH wave 11, 2026-11-19).
  // Not pipeline boards, but surfaces where a false empty is a business lie Sam
  // or an upline acts on: "no license/E&O on file" and "no call QA history".
  "src/components/profile/AgentDocuments.tsx",   // producer compliance docs (license, E&O, voided check, ID, contracting forms) — destructured `data: docs = []` with isLoading but NO error signal, so a dead agent_documents read rendered "Nothing uploaded yet." — a false "this producer has no license on file" that an upline would act on. Now takes isError and renders a load-error line before the empty state
  "src/components/dashboard/CallTranscriptsSection.tsx", // call-QA transcripts — the WORSE variant: the queryFn SWALLOWED .error (`const { data } = await q`), so React Query never saw the failure and a dead call_transcripts read rendered "No transcripts yet" as a success. Now throws on error + takes isError + renders a load-error line
  // New money-surface cluster (MP-WIB-ADMIN-RENDER-HEALTH wave 12, 2026-11-20).
  // These shipped AFTER wave-11's full sweep (EthosCallSheet parts 1-6 + MP-303
  // goal tracker) and are render-health-clean today — but were UNPINNED, so a
  // future edit could silently reintroduce a dead-feed-as-empty-all-clear on a
  // $-bearing producer/manager surface with nothing to catch it. Pinned to lock
  // their current correct error handling (throw-on-error + isError branch) forever.
  "src/pages/EthosCallSheet.tsx",                 // producer call sheet (drives retention/reactivation calls = money) — queryFn throws on error + bad-shape, isError renders "This list is missing, not empty. Nobody has been cleared." Empty state is gated on !isError. A dead ethos_call_sheet RPC must never render as an empty "nobody to call" sheet.
  "src/components/dashboard/ManagerGoalBoard.tsx",// MP-303 manager track board (team goal, projected income, Sam's first-hop override $) — queryFn `if (error) throw error`, q.isError renders "Couldn't load the goal board right now." (not a silent $0). A dead fn_owner_goal_board must never render empty/zero income as fact.
  "src/components/dashboard/GoalTrackerCard.tsx", // MP-303 one-person goal + projected income card (projected_mgr_income/total_income/sam_override $) — queryFn `if (error) throw error`, q.isError branch. A dead fn_goal_scorecard must never render a false $0/no-goal all-clear.
  // MP-WIB-ADMIN-RENDER-HEALTH wave 13 (2026-11-20). The HallOfFame leaderboard
  // had two LIVE instances of the AdminFunnelHealth bug the deferred-census missed:
  // `data: plaques = []` and `data: topEarners = []` each took isLoading but NO
  // error signal, so a dead plaque_awards read rendered the podium as "No plaques
  // awarded yet" and the wall as "No plaques match these filters" — a recognition
  // board telling every agent nobody is winning at the exact moment the feed died.
  // Both now take isError + render an honest "didn't load" warning before the empty
  // state. Pinned so the silent-empty can never return to the production leaderboard.
  "src/pages/HallOfFame.tsx",                     // plaque/top-earner recognition leaderboard — plaques + topEarners destructures now take isError; podium + plaque wall render a load-error EmptyState (variant=warning) gated BEFORE the "empty board" state. A dead plaque_awards feed must never render as "nobody has won anything yet".
  // Course-curriculum cluster (MP-WIB-ADMIN-RENDER-HEALTH wave 14, 2026-11-20).
  // The deferred training/course tail: both surfaces render the SAME onboarding
  // feed and the SAME lie. The queryFns SWALLOWED the read error (CourseContent
  // via try/catch→[], CourseContentViewer via `const { data } = await`), so a
  // dead onboarding_modules read rendered "No Course Modules — content will
  // appear once configured" / "No course modules found": a believable "the
  // course isn't built yet" told to a licensed recruit who needs this course to
  // start writing business (CourseContent is agent-facing, gates the
  // recruiting→income funnel) and to an admin reviewing the curriculum. Both
  // queryFns now THROW on error, both destructures take isError, and both render
  // an honest "Course content didn't load" state with Retry, gated BEFORE the
  // empty state. Pinned so the swallow + silent-empty can never return.
  "src/pages/CourseContent.tsx",                  // agent-facing course curriculum — dead onboarding_modules/_questions feed must surface as a load error, never "No Course Modules" (blocks a licensed agent's training)
  "src/components/admin/CourseContentViewer.tsx", // admin course-content preview dialog — same feed, same twin fix; dead read must never render "No course modules found" as fact
  // MP-WIB-ADMIN-RENDER-HEALTH wave 15 (2026-11-20). The enroll dialog on the Course
  // Progress page was the WORSE variant of the same class: `data: eligibleAgents = []`
  // defaulted with NO error signal AND the queryFn SWALLOWED all three reads
  // (`const { data: agents } = await …`), so a dead agents/profiles/onboarding_progress
  // read rendered "No eligible agents found · No active agents available" — a false
  // "nobody to enroll" while the roster feed was down. Now every read THROWS, the
  // destructure takes isError, and the picker renders a load-error with Retry before
  // the empty state. Pinned so the swallow + silent-empty can never return.
  "src/components/dashboard/AddAgentToCourseDialog.tsx", // course-enroll picker — dead roster feed must surface a load error, never "No eligible agents found"
];

// ── PRIMARY_FEED_MANIFEST: the SCANNER-BLIND downstream-coalesce variant ──
// offenders() (above) only fires on a destructure that DEFAULTS data (`data = []`)
// — because repo-wide, a bare `const { data } = useQuery()` yields `undefined` on
// error, which is not a convincing 0. But a feed can launder that undefined into a
// convincing empty AFTER the destructure: CourseProgress did
//   const { data: scoped, isLoading, refetch } = useQuery(…);   // no default, no isError
//   const agentProgress = scoped?.agents ?? [];                 // <- the lie is HERE
// so a dead my_course_progress() RPC → scoped undefined → agentProgress [] → the
// table renders "No agents match this filter": a false "nobody is on the course" at
// the exact moment the feed died (MP-WIB-ADMIN-RENDER-HEALTH wave 15, 2026-11-20).
//
// A repo-wide version of this rule is UNSAFE — 5 money/pipeline MANIFEST files above
// legitimately coalesce a SECONDARY/whole-object picker result to [] (the Assign
// manager picker, the board-access per-cell toggle overlay, activeProducerIds, …)
// and were deliberately classified benign in their waves. So offendersCoalesce()
// runs ONLY over this second CURATED list, where the coalesced query drives a
// DECEPTIVE PRIMARY empty-state, and is held at ZERO.
const PRIMARY_FEED_MANIFEST = [
  "src/pages/CourseProgress.tsx", // course-progress monitor — scoped?.agents ?? [] feeds the primary table + "No agents match this filter"
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

// `data` is extracted (with or without a default), capturing the alias it's bound
// to: `data` → "data", `data: scoped` → "scoped". Null if the destructure has no
// `data` key at all.
const DATA_ALIAS_RE = /(^|[^\w$])data\s*(?::\s*([A-Za-z_$][\w$]*))?/;

/**
 * The SCANNER-BLIND variant: a `useQuery`/`useSuspenseQuery` destructure that takes
 * NO error signal, whose `data` alias is later coalesced to an empty collection
 * (`alias ?? []` / `alias ?? {}`, incl. `alias?.x ?? []`). That `?? []` manufactures
 * a convincing empty from the undefined-on-error, which a primary feed then renders
 * as a believable all-clear. Returns [{ line, body }]. Pure; comments blanked first.
 * Run ONLY over PRIMARY_FEED_MANIFEST — see the note on that list for why repo-wide
 * is unsafe.
 */
export function offendersCoalesce(src) {
  const code = stripComments(src);
  const out = [];
  const openRe = /\bconst\s*\{/g;
  let m;
  while ((m = openRe.exec(code))) {
    const open = code.indexOf("{", m.index);
    if (open < 0) continue;
    const close = matchBrace(code, open);
    if (close < 0) continue;
    const after = code.slice(close + 1);
    if (!/^\s*=\s*(useQuery|useSuspenseQuery)\s*[<(]/.test(after)) continue;
    const body = code.slice(open + 1, close);
    if (ERROR_SIGNAL_RE.test(body)) continue; // takes an error signal → not deceptive
    const am = body.match(DATA_ALIAS_RE);
    if (!am) continue; // no data key in this destructure
    const alias = am[2] || "data";
    // the alias coalesced to an empty collection downstream (small window spans
    // `scoped?.agents ?? []`): the move that turns undefined-on-error into a fake 0.
    // The lookbehind requires the alias STANDALONE — never a `.property` access, so
    // a row's own field (`row.modules ?? {}`) can't be mistaken for the query alias
    // `modules`.
    const coalesce = new RegExp(`(?<![\\w$.])${alias}\\b[\\w$.?\\[\\]'"\\s]{0,40}?\\?\\?\\s*[\\[{]`);
    if (coalesce.test(code)) {
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

  // ── offendersCoalesce: the scanner-blind downstream-?? variant ──

  // THE BUG: no default, no error signal, alias coalesced to [] downstream (CourseProgress shape).
  const COAL_BUG = `const { data: scoped, isLoading, refetch } = useQuery({ queryKey: ["x"] });\nconst agentProgress = scoped?.agents ?? [];`;
  ok(offendersCoalesce(COAL_BUG).length === 1, "COALESCE BUG: scoped?.x ?? [] with no error signal → 1 offender");
  ok(offenders(COAL_BUG).length === 0, "COALESCE BUG is INVISIBLE to offenders() (no data default) — proves why the 2nd detector exists");

  // FIX via taking isError in the same braces.
  const COAL_FIX = `const { data: scoped, isLoading, isError, refetch } = useQuery({ queryKey: ["x"] });\nconst agentProgress = scoped?.agents ?? [];`;
  ok(offendersCoalesce(COAL_FIX).length === 0, "COALESCE FIX (isError present) → clean");

  // Plain-data alias coalesced to [] with no error → still caught.
  const COAL_PLAIN = `const { data, isLoading } = useQuery({ queryKey: ["x"] });\nconst rows = data ?? [];`;
  ok(offendersCoalesce(COAL_PLAIN).length === 1, "COALESCE: plain data ?? [] with no error → 1 offender");

  // Object coalesce (?? {}) is the same class.
  const COAL_OBJ = `const { data: cfg, isLoading } = useQuery({ queryKey: ["x"] });\nconst c = cfg ?? {};`;
  ok(offendersCoalesce(COAL_OBJ).length === 1, "COALESCE: alias ?? {} with no error → 1 offender");

  // NO downstream coalesce → not deceptive (undefined stays undefined; no fake 0 manufactured).
  const COAL_NONE = `const { data: scoped, isLoading } = useQuery({ queryKey: ["x"] });\nreturn scoped?.agents;`;
  ok(offendersCoalesce(COAL_NONE).length === 0, "no downstream ?? [] → not an offender (undefined is not a convincing 0)");

  // NOT a query: a plain object destructure coalesced downstream is out of scope.
  const COAL_NOTQ = `const { data: scoped } = someObject;\nconst rows = scoped ?? [];`;
  ok(offendersCoalesce(COAL_NOTQ).length === 0, "a non-useQuery destructure is out of scope for the coalesce detector");

  // A DIFFERENT variable that merely contains the alias as a substring must not match (word boundary).
  const COAL_WB = `const { data: scope, isLoading } = useQuery({ queryKey: ["x"] });\nconst scopedList = buildScopedList() ?? [];`;
  ok(offendersCoalesce(COAL_WB).length === 0, "word-boundary: `scopedList ?? []` does not match alias `scope`");

  // A `.property` access that shares the alias's name is NOT the query alias
  // (the real CourseProgress false positive: alias `modules`, unrelated `row.modules ?? {}`).
  const COAL_DOT = `const { data: modules = [], isLoading } = useQuery({ queryKey: ["x"] });\nfor (const v of Object.entries(row.modules ?? {})) {}`;
  ok(offendersCoalesce(COAL_DOT).length === 0, "`.property` access (row.modules ?? {}) is not the query alias `modules`");

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
  // Second pass: the scanner-blind downstream-coalesce variant, over the curated
  // PRIMARY_FEED_MANIFEST only. "could not read" is exit 2, never a quiet pass.
  const coalReport = [];
  for (const rel of PRIMARY_FEED_MANIFEST) {
    let src;
    try {
      src = readFileSync(resolve(REPO, rel), "utf8");
    } catch (e) {
      console.error(`check:admin-dashboard-render-health — COULD NOT READ ${rel}: ${e.message}`);
      console.error("  A primary-feed daily-driver in PRIMARY_FEED_MANIFEST is missing or was renamed.");
      process.exit(2);
    }
    const hits = offendersCoalesce(src);
    if (hits.length) { bad += hits.length; coalReport.push({ rel, hits }); }
  }

  if (bad) {
    if (report.length) {
      console.error(`check:admin-dashboard-render-health — ${report.reduce((n, r) => n + r.hits.length, 0)} money/pipeline feed(s) render a dead read as a healthy zero:`);
      for (const { rel, hits } of report) {
        for (const h of hits) {
          console.error(`  🔴 ${rel}:${h.line} — { ${h.body} }`);
          console.error(`        defaults data but takes no error signal (${ERROR_SIGNALS.join("/")}).`);
        }
      }
    }
    if (coalReport.length) {
      console.error(`check:admin-dashboard-render-health — ${coalReport.reduce((n, r) => n + r.hits.length, 0)} primary feed(s) coalesce a dead read to an empty all-clear (scanner-blind variant):`);
      for (const { rel, hits } of coalReport) {
        for (const h of hits) {
          console.error(`  🔴 ${rel}:${h.line} — { ${h.body} }`);
          console.error(`        data alias is coalesced to [] / {} downstream but the destructure takes no error signal.`);
        }
      }
    }
    console.error("  A failed read on these surfaces must show an error with Retry, not 0 / empty.");
    console.error("  Fix: route the query through <QueryState {...describeQuery(q)}>, or destructure an");
    console.error("  error signal and render it. See src/pages/AdminFunnelHealth.tsx for the pattern.");
    process.exit(1);
  }
  console.log(`check:admin-dashboard-render-health — OK: ${MANIFEST.length} money/pipeline daily-drivers + ${PRIMARY_FEED_MANIFEST.length} primary-feed coalesce surface(s) surface query errors (0 silent-zero feeds).`);
  process.exit(0);
}
