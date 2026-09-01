import fs from "node:fs";
import path from "node:path";

// Persistence-mandate guard for the feb05b97 / 86f8d98e truth-floor disease.
//
// What re-shipped twice: a landing surface used `liveStats?.<key> ?? <N>`
// with N set ABOVE current truth (104 vs truth=41). When the RPC came back
// honest, the fallback clamped UP and the public landing lied.
//
// This guard locks the fallback CEILING per landing_live_stats() key. Any
// surface that writes `?? <number>` against one of the tracked keys MUST be
// at or below the ceiling. Ceilings are intentionally above today's truth
// (gives margin for live numbers to climb) but below the historical lie
// values (104 / 95 / 123). When truth grows, ratchet the ceiling up in this
// file in the SAME PR that ships the truth growth.

const repoRoot = path.resolve(import.meta.dirname, "..");

// Surfaces that consume landing_live_stats() / public truth.
const TRACKED_FILES = [
  "src/components/landing/LiveStatsCounterStrip.tsx",
  "src/components/landing/CTASection.tsx",
  "src/components/landing/CareerPathwaySection.tsx",
  "src/components/landing/HeroSection.tsx",
  "src/components/landing/RecentHiresTicker.tsx",
  "src/pages/Landing.tsx",
  // 2026-08-02: Apply.tsx is the highest-intent conversion page and was the ONE
  // public surface missing here — it shipped a stale `?? 104` active-agent floor
  // while the DB said 41, and this guard never saw it. Track it.
  "src/pages/Apply.tsx",
  "src/pages/SeminarPage.tsx",
];

// MP-373: pre-commit carried its OWN hand list of which paths should fire this
// guard, and the two lists had come apart exactly where it mattered. The
// trigger matched src/components/landing/** plus src/pages/Landing.tsx -- a
// file that no longer exists -- while TRACKED_FILES also covers
// src/pages/Apply.tsx and src/pages/SeminarPage.tsx. Apply.tsx is the page that
// shipped the stale `?? 104` active-agent floor in the first place and was
// added here on 2026-08-02 for that reason; editing it never fired this guard
// at commit time. (verify:core still ran it on push, so nothing was unguarded
// outright -- the commit-time leg simply claimed reach it did not have.)
//
// The list is now published instead of duplicated: pre-commit asks the guard
// which files it tracks. One source, two callers.
if (process.argv.includes("--list-tracked")) {
  console.log(TRACKED_FILES.join("\n"));
  process.exit(0);
}

// Ceiling = max allowed `?? N` fallback per key. Truth as of 2026-06-19:
// active_agents=41, applications_30d=131, carriers_partnered=22.
// MP-370: the ceiling is no longer the only bound, because a hand-typed
// ceiling only ever moved UP. The instruction on this block used to read
// "ratchet the ceiling up when truth grows" -- but truth also falls, and when
// it does a ceiling set for the old number silently licenses a lie.
// applications_30d was 131 when the ceiling was written at 150; on 2026-09-01
// it was 35 and LiveStatsCounterStrip's floor of 131 had been passing every CI
// run while rendering 3.7x the real figure under a label reading "Live".
//
// A fallback must now be at or under BOTH the hand ceiling AND the last
// measured live value (scripts/data/landing-truth-snapshot.json, refreshed by
// scripts/refresh-landing-truth.sh). apex-doctor re-queries the database
// directly, so a snapshot that rots is caught there rather than trusted here.
const CEILINGS = {
  active_agents: 50,
  applications_30d: 150,
  carriers_partnered: 25,
  people_count: 50,
  total_people_count: 100,
  hires_this_week: 15,
};

// Live truth as last measured. Absent/rotten snapshot degrades to the hand
// ceilings and says so -- it never silently stops bounding.
let TRUTH = null, TRUTH_AGE_DAYS = null, TRUTH_NOTE = "";
// apex-doctor passes LIVE values here so the doctor and this guard share one
// implementation of "which fallbacks exist in the code". Two parsers for one
// question is how curl's --max-time and fn_agentlink_reap_stuck drifted into
// 36 false pages a day.
const truthArg = process.argv.find((a) => a.startsWith("--truth-json="));
if (truthArg) {
  try {
    TRUTH = JSON.parse(truthArg.slice("--truth-json=".length));
    TRUTH_AGE_DAYS = 0;
    TRUTH_NOTE = "truth supplied live by caller";
  } catch {
    console.error("check:landing-truth-floor — --truth-json was not valid JSON; refusing to grade against an unparsable operand");
    process.exit(2);
  }
}
if (!TRUTH) try {
  const snapPath = path.join(repoRoot, "scripts/data/landing-truth-snapshot.json");
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  TRUTH = snap.truth ?? null;
  TRUTH_AGE_DAYS = Math.floor((Date.now() - Date.parse(snap.measured_at)) / 86400000);
} catch {
  TRUTH_NOTE = "no landing-truth snapshot found — bounded by hand ceilings only; run scripts/refresh-landing-truth.sh";
}
if (TRUTH && TRUTH_AGE_DAYS > 30) {
  TRUTH_NOTE = `landing-truth snapshot is ${TRUTH_AGE_DAYS}d old — refresh it (scripts/refresh-landing-truth.sh); apex-doctor is the live authority`;
}
/** The tightest defensible bound for a key: never above the last measured truth. */
function boundFor(key) {
  const ceiling = CEILINGS[key];
  const measured = TRUTH && typeof TRUTH[key] === "number" ? TRUTH[key] : null;
  if (measured === null) return ceiling === undefined ? null : ceiling;
  return ceiling === undefined ? measured : Math.min(ceiling, measured);
}

// MP-373: the graded key set used to be Object.keys(CEILINGS) -- a hand list,
// maintained separately from the RPC whose numbers it claims to bound. Measured
// 2026-09-01, the two had already come apart in BOTH directions:
//
//   * three CEILINGS entries -- people_count, total_people_count,
//     hires_this_week -- are not keys of landing_live_stats() and occur ZERO
//     times anywhere in src/. They can never match a line, so they cost the
//     scanner nothing and earned the OK line a coverage number ("6 keys") that
//     was really 3.
//   * two keys the RPC genuinely returns -- applications_total (777) and
//     hires_recent (12) -- had no ceiling entry at all, so a `?? 777` fallback
//     on the public landing would have been invisible to this guard. A
//     cumulative all-time counter is the loudest possible number to render
//     stale under a label reading "Live".
//
// Neither is a lie today: no surface currently writes a fallback for either
// ungraded key (verified across all of src/, not just the tracked files). This
// is prevention of a blind spot, and the OK line no longer overstates reach.
//
// The key set is now DERIVED from the operand: every numeric key present in
// live truth, unioned with the hand ceilings so a non-RPC surface can still be
// bounded by hand. One source for "which numbers exist", so a new RPC key is
// graded the day it ships instead of the day someone remembers this file.
const KEY_NAMES = [...new Set([
  ...Object.keys(TRUTH ?? {}).filter((k) => typeof TRUTH[k] === "number"),
  ...Object.keys(CEILINGS),
])].filter((k) => boundFor(k) !== null);

// Ceilings that bound nothing: reported, never graded. A dead entry is noise in
// the coverage count, not a rendered lie -- going red on it would be the
// permanently-red guard this repo keeps closing.
const UNBOUND_KEYS = Object.keys(CEILINGS).filter(
  (k) => !(TRUTH && typeof TRUTH[k] === "number")
);


/**
 * Blank out comment bodies, preserving line count and column positions.
 *
 * MP-370: this guard scanned RAW source, so the comment explaining WHICH number
 * was removed ("the floor was applications_30d: 131") tripped the guard that
 * removal was meant to satisfy. Every wave that documents a killed number would
 * have re-armed it, and the only way to keep CI green would have been to stop
 * writing down what was fixed. Same footnote bug MP-277 found in the
 * maybeSingle ratchet. String literals are deliberately left intact -- a
 * fabricated number can live in a string, and blanking those would blind the
 * guard to the very thing it hunts.
 */
function stripComments(src) {
  let out = "", i = 0, mode = "code", quote = "";
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { mode = "str"; quote = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (mode === "str") {
      if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === quote) mode = "code";
      out += c; i += 1; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; } else out += " ";
      i += 1; continue;
    }
    // block
    if (c === "*" && n === "/") { mode = "code"; out += "  "; i += 2; continue; }
    out += c === "\n" ? c : " "; i += 1;
  }
  return out;
}

const violations = [];

// MP-373: a tracked file that no longer exists was silently `continue`d, so the
// OK line counted 8 surfaces while scanning 7 -- src/pages/Landing.tsx has been
// gone from this repo for some time. Absent is REPORTED, never graded: a
// renamed surface is a stale list, not a rendered lie, and failing on it is the
// permanently-red guard this repo keeps closing. What it must never do again is
// count toward coverage.
const MISSING_FILES = TRACKED_FILES.filter(
  (rel) => !fs.existsSync(path.join(repoRoot, rel))
);
const SCANNED_FILES = TRACKED_FILES.filter((rel) => !MISSING_FILES.includes(rel));

for (const rel of SCANNED_FILES) {
  const abs = path.join(repoRoot, rel);
  // Comments are documentation, not rendered numbers.
  const src = stripComments(fs.readFileSync(abs, "utf8"));
  const lines = src.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const key of KEY_NAMES) {
      // Match: <anything>.<key>\s*\?\?\s*<digits>
      // Captures the fallback number after the ?? operator.
      const re = new RegExp(`\\.${key}\\s*\\?\\?\\s*(\\d+)`);
      const m = line.match(re);
      if (m) {
        const fallback = Number.parseInt(m[1], 10);
        if (fallback > boundFor(key)) {
          violations.push(
            `${rel}:${i + 1}: ?? ${fallback} fallback for landing_live_stats.${key} exceeds ${boundFor(key)} (hand ceiling ${CEILINGS[key] ?? "none"}, last measured live ${TRUTH?.[key] ?? "unknown"}) — clamps truth UP and lies on the public landing. Lower the fallback; raising the ceiling does not make the number true.`
          );
        }
      }

      // Also catch: const FLOOR = { <key>: N, ... }
      const objRe = new RegExp(`\\b${key}\\s*:\\s*(\\d+)`);
      const m2 = line.match(objRe);
      if (m2 && /HARDCODED|FLOOR|FALLBACK|DEFAULT/i.test(line + (lines[i - 1] || ""))) {
        const fallback = Number.parseInt(m2[1], 10);
        if (fallback > boundFor(key)) {
          violations.push(
            `${rel}:${i + 1}: HARDCODED_FLOOR.${key}=${fallback} exceeds ${boundFor(key)} (hand ceiling ${CEILINGS[key] ?? "none"}, last measured live ${TRUTH?.[key] ?? "unknown"}) — pick() will clamp truth UP. Lower the floor. Raising the ceiling does NOT clear this when live truth is the binding side.`
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("check:landing-truth-floor — landing surfaces would clamp truth UPWARD:");
  for (const v of violations) console.error("  " + v);
  console.error("");
  console.error("Why this exists: feb05b97 dropped live agent count 123 -> 41. 86f8d98e then");
  console.error("found 4 landing surfaces still clamping the new truth back up to 104 via ??");
  console.error("fallbacks above the new floor. This guard prevents the same lie re-shipping.");
  process.exit(1);
}

console.log(
  `check:landing-truth-floor OK — ${SCANNED_FILES.length} surface(s) scanned × ${KEY_NAMES.length} bindable key(s) (${KEY_NAMES.join(", ")}), no fallback exceeds its bound.` +
    (MISSING_FILES.length
      ? ` NOTE: ${MISSING_FILES.length} tracked surface(s) do not exist and were NOT scanned (${MISSING_FILES.join(", ")}) — remove them from TRACKED_FILES or restore the file.`
      : "") +
    (UNBOUND_KEYS.length
      ? ` NOTE: ${UNBOUND_KEYS.length} hand ceiling(s) bound nothing live (${UNBOUND_KEYS.join(", ")}) — bounded by hand ceiling only, not by measured truth.`
      : "")
);
