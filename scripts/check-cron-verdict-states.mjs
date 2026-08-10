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
// WHY THIS EXISTS — three waves on the same gate in three days:
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
//   this one  judges the newest run the reaper has already RULED on.
//
// A gate that cannot fail is the same disease as the 465 InsuraCloud
// fake-success rows. A gate that fails constantly is the same disease wearing
// its coat inside out. Both end with Sam ignoring the one channel that is
// supposed to be loud. These states are the proof that neither has returned.

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
const start = lines.findIndex((l) => l.includes('if [ -z "$verdict" ]'));
const anchor = lines.findIndex((l) => l.includes("real failure, keeping it red"));
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
  // Green must mean the pipeline actually moved.
  ["ok:100", "ACQUIT", "fresh ok"],
  ["ok:449", "ACQUIT", "live value observed on 2026-08-10 while writing this"],
  [`ok:${STALE_MAX}`, "ACQUIT", "stale bound is inclusive"],

  // The 843c6164 hole. Every one of these was acquitted by the previous gate.
  ["stuck:2723", "RED", "REAL CASE: row ab407e97 as-of the 18:08:18Z tick"],
  ["stuck:485", "RED", "the same row at the duration it actually died on"],
  ["running:400", "RED", "running past the reap threshold — the reaper itself is dead"],
  ["running:100", "RED", "young running row must NOT acquit (843c6164's exact hole)"],

  // Every other status agentlink_sync_log has ever held.
  ["error:500", "RED", "error (2560 rows all-time)"],
  ["no_cookie:500", "RED", "no_cookie (42 rows all-time)"],
  ["pending:500", "RED", "pending (1 row all-time)"],
  ["none:0", "RED", "no settled row at all — the function never registered"],

  // A stale 'ok' that never gets superseded is the acquit-forever hole.
  [`ok:${STALE_MAX + 1}`, "RED", "one second past STALE_MAX"],
  ["ok:86400", "RED", "a full day of silence"],

  // Malformed input must fail safe. The old code coerced a bad age to 0,
  // which ACQUITTED — fail-open, in the one place whose job is to fail loud.
  ["", "RED", "empty verdict (jq printed nothing and still exited 0)"],
  ["ok:abc", "RED", "non-numeric age on an ok"],
  ["ok:", "RED", "empty age on an ok"],
  ["garbage:xyz", "RED", "unparseable status and age"],
];

function runState(verdict, extraFailed) {
  const extra = extraFailed ? ` "${extraFailed}"` : "";
  const script = `
set -euo pipefail
STALE_MAX=${STALE_MAX}
verdict=${JSON.stringify(verdict)}
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
  const res = runState("ok:100", "agentlink-watchdog");
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
    `shipped block in ${WORKFLOW} (green only on a settled 'ok' inside ${STALE_MAX}s; ` +
    `stuck / error / no_cookie / pending / over-threshold running / no-row / malformed all stay red).`,
  );
  process.exit(0);
}

console.error("check:cron-verdict-states FAILED:");
for (const f of failures) console.error(` - ${f}`);
process.exit(1);
