#!/usr/bin/env node
// scripts/check-cron-verdict-states.mjs
//
// Behavioural ratchet for the one step in this repo that decides whether
// Sam's phone rings every few minutes: "Fire critical jobs" inside
// .github/workflows/external-cron-backup.yml.
//
// This is not a regex guard. It extracts the SHIPPED bash of that step and
// executes it, with a stub `curl` first on PATH, against every outcome the
// legs can produce. It asserts the exit code, every ntfy push the step tries
// to send, and every URL it tries to call. The script under test cannot drift
// from the script that ships, because they are the same text.
//
// HISTORY. Until 2026-10-17 this file proved one decision: the
// agentlink-cookie-sync freshness verdict. Four waves landed on that gate in
// three days (710b27c3 cried wolf 36x/day, 843c6164 could not cry at all,
// a3fa21b4 sent ~39 true-but-misleading pages/day, c91f82b7 judged book
// freshness). Its states are in git history.
//
// PL-WIB-CRON-AGENTLINK-RETIRED retired that leg. AgentLink stopped
// delivering deals (0 inserted by any successful sync from 2026-09-25, the
// upstream book frozen at 1384 policies from 10-02), pg_cron no longer
// scheduled the sync, and after the cookie died on 10-15 every tick paged
// Sam at priority 5 that the book was stale: 34/34 runs red on 10-16, 40/40
// on 10-17, 26 of the 55 pushes on his topic in the 12h ntfy keeps. True,
// and nothing anyone could act on.
//
// What this guard holds now:
//   1. The retired leg is never called. Re-adding it without restoring a
//      verdict brings the storm back on the next dead cookie.
//   2. The red path still works for every other leg. A failed SQL job, or
//      bot-sql itself down (the 2026-08-07 token death), must exit 1 and
//      push exactly one "External cron backup FAILED" page naming the leg.
//      Retiring a noisy leg must not become a step that cannot fail.
//   3. The allowlist does not widen. Only edge:insuracloud-sync may fail
//      without colouring the run.
//   4. The book-age read that replaced the verdict is diagnostic. Down,
//      garbled or fresh, it cannot change the exit code or send a page.
//
// Proofs this guard can fail, run against real files: M1 runs it on the
// pre-retirement workflow (47f48a10), M2 widens KNOWN_DEGRADED, M3 lets the
// diagnostic read vote. All three go red; see the commit message.
//
// Usage: node scripts/check-cron-verdict-states.mjs [--workflow <path>]

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const DEFAULT_WORKFLOW = ".github/workflows/external-cron-backup.yml";
const STEP_NAME = "Fire critical jobs";
const RETIRED_EDGE = "agentlink-cookie-sync";
const FAILED_TITLE = "External cron backup FAILED";
const BACK_TITLE = "InsuraCloud endpoints are BACK";

const argIdx = process.argv.indexOf("--workflow");
const WORKFLOW = argIdx > 0 ? process.argv[argIdx + 1] : DEFAULT_WORKFLOW;
const abs = path.isAbsolute(WORKFLOW) ? WORKFLOW : path.join(repoRoot, WORKFLOW);
if (!fs.existsSync(abs)) {
  console.error(`check:cron-verdict-states FAILED: ${WORKFLOW} is missing.`);
  process.exit(1);
}

// ---- Extract the shipped step ---------------------------------------------
// Parsed off the raw text so this script needs no YAML dependency. A YAML
// block scalar's indent is set by its first non-blank line, and the block ends
// at the first non-blank line indented less than that.
const lines = fs.readFileSync(abs, "utf8").split("\n");
const nameAt = lines.findIndex((l) => new RegExp(`^\\s*- name: ${STEP_NAME}\\s*$`).test(l));
let runAt = -1;
for (let i = nameAt + 1; nameAt >= 0 && i < lines.length; i++) {
  if (/^\s*- name:/.test(lines[i])) break;
  if (/^\s*run: \|\s*$/.test(lines[i])) { runAt = i; break; }
}
if (nameAt < 0 || runAt < 0) {
  console.error(
    `check:cron-verdict-states FAILED: could not find the "${STEP_NAME}" step's run block in ${WORKFLOW} ` +
    `(name=${nameAt} run=${runAt}). If you renamed or restructured the step, update this extractor and ` +
    `.github/prod-write-census.json. Do NOT delete the check: it is the only thing proving the step can still go red.`,
  );
  process.exit(1);
}
const body = [];
let indent = -1;
for (let i = runAt + 1; i < lines.length; i++) {
  const l = lines[i];
  if (l.trim() === "") { body.push(""); continue; }
  const n = l.length - l.trimStart().length;
  if (indent < 0) indent = n;
  if (n < indent) break;
  body.push(l.slice(indent));
}
while (body.length && body[body.length - 1] === "") body.pop();
const script = body.join("\n") + "\n";
if (script.includes("${{")) {
  console.error(
    `check:cron-verdict-states FAILED: the "${STEP_NAME}" step now contains a GitHub expression (\${{ }}), ` +
    `which this harness cannot evaluate. Move it to the step's env: block, or teach the harness to substitute it.`,
  );
  process.exit(1);
}

// ---- Sandbox ----------------------------------------------------------------
// Fake hosts throughout: if the stub were ever bypassed, a real curl fails on
// .invalid instead of reaching prod or Sam's phone.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cron-step-"));
const stubDir = path.join(tmp, "bin");
fs.mkdirSync(stubDir);
const stepFile = path.join(tmp, "step.sh");
fs.writeFileSync(stepFile, script);
const NTFY = "https://stub.invalid/ntfy-topic";
const BOT_SQL = "https://stub.invalid/functions/v1/bot-sql";

// The stub routes on URL and payload, appends one tab-separated line per call
// to $STUB_LOG (a file, so calls made inside $(...) subshells are still
// counted) and answers the way curl would, including the -w HTTPSTATUS
// trailer. Plain bash, not node: one process per call, nothing to warm up,
// and the same interpreter the ubuntu runner has.
fs.writeFileSync(path.join(stubDir, "curl"), `#!/usr/bin/env bash
url="" data="" title="" haveW=no
while [ $# -gt 0 ]; do
  case "$1" in
    -d|--data|--data-binary) data="$2"; shift 2; continue ;;
    -w) haveW=yes; shift 2; continue ;;
    -H) case "$2" in [Tt]itle:*) title="\${2#*: }" ;; esac; shift 2; continue ;;
    -X|--max-time|-o) shift 2; continue ;;
    http://*|https://*) url="$1" ;;
  esac
  shift
done
sc="\${STUB_SCENARIO:-}"
log() { printf '%s\\t%s\\t%s\\t%s\\n' "$1" "$2" "$url" "$(printf '%s' "$data" | tr '\\t\\n' '  ' | cut -c1-400)" >> "$STUB_LOG"; }
out() { printf '%s' "$2"; if [ "$haveW" = yes ]; then printf '\\nHTTPSTATUS:%s' "$1"; fi; exit "\${3:-0}"; }
down() { echo "curl: (7) Failed to connect" >&2; out 000 "" 7; }
if [ "$url" = "$NTFY" ]; then log page "$title"; out 200 ""; fi
case "$url" in
  */bot-sql)
    if [ "$sc" = botsql_down ]; then log botsql_down ""; down; fi
    case "$data" in
      *agentlink_sync_log*)
        log diag ""
        if [ "$sc" = diag_down ]; then down; fi
        if [ "$sc" = diag_garbage ]; then out 200 '<!DOCTYPE html>'; fi
        age=192936; if [ "$sc" = diag_fresh ]; then age=120; fi
        out 200 "{\\"ok\\":true,\\"rows\\":[{\\"age\\":$age,\\"ok_age\\":$age,\\"last_status\\":\\"error\\"}]}" ;;
      *insuracloud_sync_log*)
        log probe_gap ""
        gap=4000; if [ "$sc" = probe_recent ]; then gap=100; fi
        out 200 "{\\"ok\\":true,\\"rows\\":[{\\"gap\\":$gap}]}" ;;
    esac
    fn=$(printf '%s' "$data" | sed -n 's/.*SELECT \\(public\\.[a-z_]*\\)().*/\\1/p')
    if [ -n "$fn" ]; then
      log fire "$fn"
      if [ "$sc" = "fire_fail:$fn" ]; then out 200 '{"ok":false,"error":"stub failure"}'; fi
      out 200 '{"ok":true,"rows":[{"r":"ok"}]}'
    fi
    log unexpected ""; exit 99 ;;
  */functions/v1/*)
    fn="\${url##*/functions/v1/}"
    log edge "$fn"
    if [ "$fn" = ${RETIRED_EDGE} ]; then out 401 '{"message":"Unauthorized"}'; fi
    if [ "$fn" = insuracloud-sync ]; then
      if [ "$sc" = insuracloud_back ]; then out 200 '{"ok":true}'; fi
      out 502 '{"ok":false,"error":"API endpoint not found"}'
    fi
    out 200 '{"ok":true}' ;;
esac
log unexpected ""; exit 99
`, { mode: 0o755 });
// The step sleeps nowhere today; a future retry loop should not slow the guard.
fs.writeFileSync(path.join(stubDir, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

function runScenario(sc) {
  const stubLog = path.join(tmp, `log-${sc.replace(/[^a-z0-9]/gi, "_")}.jsonl`);
  const summary = path.join(tmp, `summary-${sc.replace(/[^a-z0-9]/gi, "_")}.md`);
  fs.writeFileSync(stubLog, "");
  fs.writeFileSync(summary, "");
  const env = {
    PATH: `${stubDir}:${process.env.PATH}`,
    HOME: process.env.HOME ?? tmp,
    BOT_SQL, BOT_TOKEN: "stub-token", NTFY,
    GITHUB_STEP_SUMMARY: summary,
    STUB_LOG: stubLog, STUB_SCENARIO: sc,
  };
  // GitHub's default for `run:` on Linux: bash --noprofile --norc -eo pipefail {0}
  // A scenario takes ~0.5s. The timeout only stops a hang, and a killed run is
  // not an answer: exit null used to be graded as "a failed leg is being
  // swallowed", which blamed the workflow for a laptop deep in swap (two of
  // three local runs on 2026-10-18). Retry a killed run on a fresh log; if it
  // never finishes, the caller reports "could not run", never a verdict.
  let r;
  for (const ms of [30_000, 60_000, 120_000]) {
    fs.writeFileSync(stubLog, "");
    fs.writeFileSync(summary, "");
    r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", stepFile], {
      env, encoding: "utf8", timeout: ms,
    });
    if (r.status !== null) break;
  }
  const calls = fs.readFileSync(stubLog, "utf8").split("\n").filter(Boolean).map((l) => {
    const [kind, name, url, data] = l.split("\t");
    return { kind, fn: name, title: name, url, data: data ?? "" };
  });
  return {
    code: r.status, killed: r.status === null, signal: r.signal ?? r.error?.code ?? "",
    stdout: r.stdout ?? "", stderr: r.stderr ?? "", calls,
  };
}

// The stub must be the curl the step resolves, or every case below is vacuous.
{
  const r = spawnSync("bash", ["-c", "command -v curl"], {
    env: { PATH: `${stubDir}:${process.env.PATH}` }, encoding: "utf8",
  });
  if (r.stdout.trim() !== path.join(stubDir, "curl")) {
    console.error(`check:cron-verdict-states FAILED: stub curl is not first on PATH (resolved '${r.stdout.trim()}').`);
    process.exit(1);
  }
}

const FIRED = [
  "public.agentlink_watchdog",
  "public.deal_sync_queue_promote_dead",
  "public.auto_assign_hiring_manager",
  "public.refresh_sync_health",
];

// [scenario, expected exit, expected page titles in order, must-name, why]
const CASES = [
  ["healthy", 0, [], null, "every SQL leg ok, InsuraCloud probe due and still 404ing (allowlisted)"],
  ["probe_recent", 0, [], null, "every leg ok, InsuraCloud probed under an hour ago so not called"],
  ["fire_fail:public.refresh_sync_health", 1, [FAILED_TITLE], "refresh-sync-health", "one SQL leg returns ok:false"],
  ["fire_fail:public.agentlink_watchdog", 1, [FAILED_TITLE], "agentlink-watchdog", "the leg that sits beside the retired one still reds"],
  ["fire_fail:public.auto_assign_hiring_manager", 1, [FAILED_TITLE], "auto-assign-hiring-manager", "applicant assignment fails"],
  ["botsql_down", 1, [FAILED_TITLE], "deal-sync-queue-promote-dead", "bot-sql unreachable: every SQL leg fails (the 2026-08-07 token death)"],
  ["diag_down", 0, [], null, "book-age read cannot reach bot-sql: diagnostic, never votes"],
  ["diag_garbage", 0, [], null, "book-age read returns HTML: diagnostic, never votes"],
  ["diag_fresh", 0, [], null, "something synced AgentLink 120s ago: a notice, never a page"],
  ["insuracloud_back", 0, [BACK_TITLE], null, "InsuraCloud answers ok: the existing priority-4 revival push, no failure page"],
];

const failures = [];
for (const [sc, wantCode, wantPages, mustName, why] of CASES) {
  const r = runScenario(sc);
  const tag = `${sc} (${why})`;
  const pages = r.calls.filter((c) => c.kind === "page");
  const titles = pages.map((p) => p.title);
  const fires = r.calls.filter((c) => c.kind === "fire").map((c) => c.fn);
  const retired = r.calls.filter((c) => c.kind === "edge" && c.fn === RETIRED_EDGE);
  const unexpected = r.calls.filter((c) => c.kind === "unexpected");

  if (r.killed) {
    failures.push(
      `${tag}: COULD NOT RUN: the step was killed (${r.signal}) on 3 attempts (30s, 60s, 120s; a normal run takes ~0.5s). ` +
      "This is not a verdict on the workflow. Check the machine (swap, sleep, load) and re-run.",
    );
    continue;
  }
  if (r.calls.length === 0) {
    failures.push(`${tag}: the step made no calls at all, so this case proves nothing. stderr: ${r.stderr.trim().slice(0, 300)}`);
    continue;
  }
  if (retired.length) {
    failures.push(
      `${tag}: the step called ${RETIRED_EDGE} ${retired.length}x. That leg is retired (PL-WIB-CRON-AGENTLINK-RETIRED); ` +
      "with a dead cookie it reds every tick and pages Sam at priority 5. Restore a verdict and this guard's old states before re-adding it.",
    );
  }
  if (unexpected.length) {
    failures.push(`${tag}: the step called something this harness does not model: ${unexpected.map((c) => c.url).join(", ")}. Teach the stub, do not drop the case.`);
  }
  if (sc !== "botsql_down") {
    const missing = FIRED.filter((f) => !fires.includes(f));
    if (missing.length) failures.push(`${tag}: these SQL legs were not fired: ${missing.join(", ")}.`);
  }
  if (r.code !== wantCode) {
    failures.push(
      `${tag}: exit ${r.code}, expected ${wantCode}.` +
      (wantCode === 1
        ? " A failed leg is being swallowed: this is how a gate stops being able to cry."
        : " A healthy tick is being reported as broken: this is how a loud channel gets ignored.") +
      ` stderr: ${r.stderr.trim().slice(-300)}`,
    );
  }
  if (JSON.stringify(titles) !== JSON.stringify(wantPages)) {
    failures.push(`${tag}: pushed [${titles.join(" | ")}], expected [${wantPages.join(" | ")}].`);
  }
  if (mustName) {
    const failPage = pages.find((p) => p.title === FAILED_TITLE);
    const pushedBody = r.calls.find((c) => c.kind === "page" && c.title === FAILED_TITLE)?.data ?? "";
    if (failPage && !pushedBody.includes(mustName)) {
      failures.push(`${tag}: the failure page does not name '${mustName}'. Body: ${pushedBody.slice(0, 200)}`);
    }
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

if (failures.length === 0) {
  console.log(
    `✓ check:cron-verdict-states — ${CASES.length} outcomes run through the shipped "${STEP_NAME}" step in ${WORKFLOW}: ` +
    `${RETIRED_EDGE} never called; any failed SQL leg or a dead bot-sql exits 1 with one page naming it; ` +
    `only insuracloud-sync is allowlisted; the book-age read never votes.`,
  );
  process.exit(0);
}

console.error("check:cron-verdict-states FAILED:");
for (const f of failures) console.error(` - ${f}`);
process.exit(1);
