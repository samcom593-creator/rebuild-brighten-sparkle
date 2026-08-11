#!/usr/bin/env node
// scripts/check-cron-verdict-states.mjs
//
// Behavioural ratchet for the one decision in this repo that decides whether
// Sam's phone rings: the agentlink-cookie-sync verdict inside
// .github/workflows/external-cron-backup.yml.
//
// This is not a regex guard. It extracts the SHIPPED bash decision block out
// of the workflow file and executes it against every verdict state the
// pipeline can actually produce, asserting acquit-vs-red for each one. The
// block cannot drift from the block under test, because they are the same
// text.
//
// WHY THIS EXISTS — four waves on the same gate in three days:
//   710b27c3 (08-09) made the tick's green honest. Under live traffic it then
//            cried wolf 36x/day on syncs that had SUCCEEDED (curl --max-time 90
//            against a median sync of 143s).
//   843c6164 (08-10) fixed the false reds by reconciling against
//            agentlink_sync_log — but judged the row the tick had JUST created.
//            Supabase's gateway forces that verdict at ~151s and
//            fn_agentlink_reap_stuck does not call a run stuck until 300s, so
//            the row was always 'running', always under threshold, always
//            acquitted. The cookie-sync leg could not go red AT ALL.
//            Proven in production: run 31413717796 logged
//            "verdict: status=running age=151s" and reported SUCCESS while the
//            row it judged (ab407e97) died and was reaped 'stuck' at 485s.
//   a3fa21b4 (08-10) judged the last SETTLED row. Right about the row, wrong
//            about the system: 9 reds in 39 runs (~39 pages/day) all saying
//            "the pipelines are not moving" while the book was 3500s and 1235s
//            fresh at the two moments it paged.
//   this one  asks whether the BOOK IS FRESH — the question the alert claims to
//            answer. A stuck row inside a healthy stream is weather.
//
// A gate that cannot fail is the same disease as the 465 InsuraCloud
// fake-success rows. A gate that fails constantly is the same disease wearing
// its coat inside out. A gate that fires a TRUE red under a FALSE sentence is
// the third face of it. All three end with Sam ignoring the one channel that
// is supposed to be loud. These states are the proof that none has returned.
//
// The verdict string is "<ok_age>:<last_status>". ok_age decides; last_status
// is diagnostic and must never change the outcome — several pairs below differ
// only in last_status precisely to hold that line.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const WORKFLOW = ".github/workflows/external-cron-backup.yml";
const STALE_MAX = 14400;

const abs = path.join(repoRoot, WORKFLOW);
if (!fs.existsSync(abs)) {
  console.error(`check:cron-verdict-states FAILED: ${WORKFLOW} is missing.`);
  process.exit(1);
}
const raw = fs.readFileSync(abs, "utf8");

// ---- Extract the shipped decision block -----------------------------------
// Bounded by the `verdict` normalisation on one end and the `fi` that closes
// the whole reconciliation `if` (10-space indent, i.e. the step's base level)
// on the other. Parsed off the raw text so this script needs no YAML
// dependency of its own.
const lines = raw.split("\n");
const start = lines.findIndex((l) => l.includes('if [ -z "$freshness" ]'));
const anchor = lines.findIndex((l) => l.includes("The book is stale."));
let end = -1;
if (anchor >= 0) {
  for (let i = anchor; i < lines.length; i++) {
    if (/^ {10}fi\s*$/.test(lines[i])) { end = i; break; }
  }
}
if (start < 0 || anchor < 0 || end < 0) {
  console.error(
    `check:cron-verdict-states FAILED: could not locate the cookie-sync verdict block in ${WORKFLOW} ` +
    `(start=${start} anchor=${anchor} end=${end}). If you restructured that block, update this ` +
    `extractor — do NOT delete the check. It is the only thing proving the gate can still go red.`,
  );
  process.exit(1);
}
const block = lines.slice(start, end).map((l) => l.replace(/^ {12}/, "")).join("\n");

const blockFile = path.join(os.tmpdir(), "cron-verdict-block.sh");
fs.writeFileSync(blockFile, block + "\n");

// ---- The states -----------------------------------------------------------
// ACQUIT = the run is allowed to be green. RED = the run must fail and page Sam.
const CASES = [
  // A fresh book acquits. Green must mean the pipelines actually moved.
  ["100:ok", "ACQUIT", "just synced"],
  ["765:ok", "ACQUIT", "p50 of 352 ok-to-ok gaps measured over 7 days"],
  ["4124:ok", "ACQUIT", "p90 — routine GitHub throttling must never page"],
  ["11417:ok", "ACQUIT", "p99 — still normal operation, still green"],
  [`${STALE_MAX}:ok`, "ACQUIT", "stale bound is inclusive"],

  // THE HEADLINE: a stuck row inside a fresh stream. Every one of these was a
  // priority-5 page under a3fa21b4, ~39 times a day, saying "the pipelines are
  // not moving" while they were moving.
  ["3500:stuck", "ACQUIT", "REAL: book freshness when runs 31446750097/31443587597 paged"],
  ["1235:stuck", "ACQUIT", "REAL: book freshness when run 31441868477 paged"],
  ["4022:stuck", "ACQUIT", "REAL: live value measured 2026-08-11T02:12Z"],
  ["100:stuck", "ACQUIT", "AgentLink hung on one pull; the book is seconds old"],

  // last_status must never be able to vote. These mirror the acquits above.
  ["100:error", "ACQUIT", "diagnostic status cannot red a fresh book"],
  ["100:no_cookie", "ACQUIT", "diagnostic status cannot red a fresh book"],
  ["100:running", "ACQUIT", "diagnostic status cannot red a fresh book"],
  ["100:none", "ACQUIT", "no newest row at all, but the book is fresh"],

  // A stale book reds — whatever the newest row claims.
  [`${STALE_MAX + 1}:ok`, "RED", "one second past STALE_MAX"],
  ["31913:ok", "RED", "REAL: the 7d max gap, 08-06 15:37 -> 08-07 00:29 (8.9h)"],
  ["86400:ok", "RED", "a full day without a successful sync"],
  ["20000:stuck", "RED", "stale AND stuck — the genuinely dead pipeline"],
  ["99999999:none", "RED", "no successful sync has ever been recorded"],

  // Unreachable / malformed must fail LOUD. Coercing a bad age to 0 would
  // acquit — fail-open, in the one place whose entire job is to fail loud.
  ["99999999:unreachable", "RED", "bot-sql itself did not answer"],
  ["", "RED", "empty verdict (jq printed nothing and still exited 0)"],
  ["abc:ok", "RED", "non-numeric age"],
  [":ok", "RED", "empty age"],
  ["garbage:xyz", "RED", "unparseable age and status"],
];

function runState(verdict, extraFailed) {
  const extra = extraFailed ? ` "${extraFailed}"` : "";
  const script = `
set -euo pipefail
STALE_MAX=${STALE_MAX}
STALE_DETAIL=""
freshness=${JSON.stringify(verdict)}
FAILED=("edge:agentlink-cookie-sync"${extra})
. ${JSON.stringify(blockFile)} >/dev/null 2>&1
printf '%s\\n' \${FAILED[@]+"\${FAILED[@]}"}
`;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  if (r.status !== 0) return { aborted: true, stderr: (r.stderr || "").trim() };
  const remaining = (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return {
    aborted: false,
    remaining,
    outcome: remaining.includes("edge:agentlink-cookie-sync") ? "RED" : "ACQUIT",
  };
}

const failures = [];
for (const [verdict, expected, label] of CASES) {
  const res = runState(verdict);
  if (res.aborted) {
    failures.push(`verdict='${verdict}' (${label}): the block ABORTED under \`set -e\`. ${res.stderr}`);
    continue;
  }
  if (res.outcome !== expected) {
    failures.push(
      `verdict='${verdict}' (${label}): got ${res.outcome}, expected ${expected}.` +
      (res.outcome === "ACQUIT"
        ? " A state that should page Sam is being swallowed — this is how a gate stops being able to cry."
        : " A healthy pipeline is being reported as broken — this is how a loud channel gets ignored."),
    );
  }
}

// Acquitting cookie-sync must never swallow an unrelated failed job.
{
  const res = runState("100:ok", "agentlink-watchdog");
  if (res.aborted) {
    failures.push(`widening check: the block ABORTED under \`set -e\`. ${res.stderr}`);
  } else if (res.outcome !== "ACQUIT" || !res.remaining.includes("agentlink-watchdog")) {
    failures.push(
      "acquitting agentlink-cookie-sync must remove ONLY its own entry from FAILED; " +
      `agentlink-watchdog must stay red. Got remaining=[${res.remaining.join(", ")}].`,
    );
  }
}

if (failures.length === 0) {
  console.log(
    `✓ check:cron-verdict-states — ${CASES.length + 1} verdict states proven against the ` +
    `shipped block in ${WORKFLOW} (green only when the book was refreshed within ${STALE_MAX}s, ` +
    `whatever the newest row says; stale / never-synced / unreachable / malformed all stay red).`,
  );
  process.exit(0);
}

console.error("check:cron-verdict-states FAILED:");
for (const f of failures) console.error(` - ${f}`);
process.exit(1);
