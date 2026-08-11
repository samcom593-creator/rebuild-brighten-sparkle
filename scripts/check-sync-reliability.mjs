#!/usr/bin/env node
// scripts/check-sync-reliability.mjs
//
// Static guardrail. Catches regressions that have already burned us once.
// Run via `npm run check:sync-reliability` and gated through
// `npm run verify:core`.
//
// Each rule explains:
//   - what it looks for
//   - which past bug it prevents from regressing

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const violations = [];

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), "utf8");
}

function fileExists(rel) {
  try { fs.accessSync(path.join(repoRoot, rel)); return true; } catch { return false; }
}

function walk(dir, exts, fn) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(child, exts, fn); continue; }
    if (!exts.some((e) => child.endsWith(e))) continue;
    fn(child);
  }
}

// 1. deploy-supabase.yml must NOT use a blanket --no-verify-jwt on every
//    function deploy (that overrides config.toml's per-function security).
//    Prevents the bug where `seminar-reminder-tick` got verify_jwt=true in
//    config.toml but was still deployed with JWT verification disabled.
{
  const deployYml = "/.github/workflows/deploy-supabase.yml".slice(1);
  if (fileExists(deployYml)) {
    const src = read(deployYml);
    if (/supabase functions deploy[^\n]*--no-verify-jwt/.test(src)) {
      violations.push(
        `${deployYml}: function-deploy command still uses --no-verify-jwt blanket. ` +
        `Remove it so config.toml's per-function verify_jwt setting is respected.`,
      );
    }
    // Migration step must not silently exit 0 when SUPABASE_DB_PASSWORD is missing.
    if (/SUPABASE_DB_PASSWORD[^\n]*\n[^\n]*skipping db push[\s\S]{0,80}exit 0/.test(src)) {
      violations.push(
        `${deployYml}: migrations step silently exits 0 when SUPABASE_DB_PASSWORD is missing. ` +
        `That's the false-success bug — make it exit 1 with an ::error::.`,
      );
    }
    // The function-deploy step must NOT have `set +e` followed by `exit 0`.
    if (/set \+e[\s\S]{0,500}exit 0/.test(src)) {
      violations.push(
        `${deployYml}: function-deploy step disables errexit (\`set +e\`) and exits 0. ` +
        `Aggregate failures and exit 1 when any function fails.`,
      );
    }
    // No `continue-on-error: true` on any deploy-critical step. GitHub rewrites
    // a continue-on-error step's *conclusion* to "success", so the run's own
    // step list reports green for a command that exited non-zero. That is how
    // "Link project" lied from 2026-07-30 to 2026-08-07: link failed for want
    // of a password, was reported success, and the real breakage surfaced 4
    // steps later as `db push` → "Cannot find project ref". 16 migrations were
    // applied by hand while CI claimed to own deploys. Only the optional
    // config.toml sync-back push may tolerate failure (it races Lovable).
    for (const m of src.matchAll(/- name: (.+)\n(?:\s+id: .+\n)?\s+continue-on-error: true/g)) {
      const step = m[1].trim();
      if (/config\.toml sync/i.test(step)) continue;
      violations.push(
        `${deployYml}: step "${step}" carries continue-on-error: true. GitHub reports such a ` +
        `step as SUCCESS even when the command fails, which is exactly how the link/db-push ` +
        `outage stayed invisible for 8 days. Let deploy-critical steps fail loudly.`,
      );
    }
    // `db push` needs a linked project; the link step must actually authenticate.
    if (/supabase link --project-ref "\$PROJECT_REF"\s*$/m.test(src)) {
      violations.push(
        `${deployYml}: \`supabase link\` runs without --password, which cannot authenticate ` +
        `non-interactively in CI. Pass --password "$SUPABASE_DB_PASSWORD".`,
      );
    }
  }
}

// 2. external-cron-backup.yml must not parse pg_cron gap as "None" and treat
//    it as zero. The python parser must coerce non-numeric values to a large
//    number so a stalled cron is visible.
{
  const cronYml = "/.github/workflows/external-cron-backup.yml".slice(1);
  if (fileExists(cronYml)) {
    const src = read(cronYml);
    // Looking for the safer parser that returns 99999 on failure.
    if (!/(99999|isinstance.*int.*float)/i.test(src)) {
      violations.push(
        `${cronYml}: pg_cron gap parser must coerce non-numeric/None to a large number ` +
        `(e.g. 99999) so stale heartbeats are visible. Don't print "None" and let arithmetic silently truthify.`,
      );
    }
    // insuracloud-sync must still be *reached for*, but as an hourly revival
    // probe, not a per-tick sync. Its upstream 404s all three endpoints, so
    // calling it every tick wrote ~200 error rows a day into
    // insuracloud_sync_log while agentlink-cookie-sync did the real work.
    // Keeping the call means we learn the hour the endpoints come back.
    if (!/insuracloud-sync/.test(src)) {
      violations.push(
        `${cronYml}: must still probe the insuracloud-sync edge function so we detect the hour ` +
        `its upstream endpoints come back. Keep the hourly probe even while it 404s.`,
      );
    }
    // Every call in "Fire critical jobs" is non-critical and `|| true`, so the
    // step cannot fail on its own. Run 31323354187 (2026-08-09) had
    // insuracloud-sync return HTTP 502 with {"ok":false} and still reported
    // SUCCESS. This workflow is the backup for a pg_cron that dies every 1-2
    // days, so a green tick that does not prove the pipelines moved is worse
    // than no workflow at all: when the bot-sql token died on 2026-08-07,
    // all six calls would have failed and every run would still have been
    // green. Require an explicit gate that exits non-zero on any failure
    // outside a named allowlist.
    if (!/KNOWN_DEGRADED=\(/.test(src) || !/\$\{#UNEXPECTED\[@\]\}"?\s*-gt 0/.test(src)) {
      violations.push(
        `${cronYml}: "Fire critical jobs" collects failures into FAILED but never exits non-zero. ` +
        `Every call is non-critical and \`|| true\`, so the step reports SUCCESS even when every ` +
        `sync fails — the same fake-success class as the 465 InsuraCloud rows. Declare a ` +
        `KNOWN_DEGRADED allowlist and \`exit 1\` when any UNEXPECTED failure remains.`,
      );
    }
    // `[ test ] && arr+=(x)` returns non-zero when the test is false. This step
    // runs under GitHub's default `bash -e`, so the terse form aborts the step
    // mid-loop — an accidental exit that makes the run's colour meaningless.
    if (/\[\s*"\$(expected|f)"\s*=\s*"?\$?\{?[a-z]*\}?"?\s*\]\s*&&\s*\w+\+?=/.test(src)) {
      violations.push(
        `${cronYml}: uses \`[ test ] && var+=…\` inside the failure-triage loop. Under \`bash -e\` ` +
        `a false test makes the AND-list return 1 and aborts the step early. Use an explicit ` +
        `\`if\` block so a non-match is not an error.`,
      );
    }
    if (!/refresh_sync_health/.test(src)) {
      violations.push(
        `${cronYml}: must call public.refresh_sync_health() each tick so the v_sync_health ` +
        `view has a fresh heartbeat for github_external_cron.`,
      );
    }
    // The honest-green gate above is only as truthful as the signal it judges.
    // agentlink-cookie-sync ran under curl's default `--max-time 90` while its
    // successful runs took a median of 143s and a max of 192s (measured over
    // 20h on 2026-08-10), so HALF of all SUCCESSFUL syncs were cut off
    // mid-flight, recorded status=000, and were turned by the new gate into a
    // red run plus a priority-5 push telling Sam the pipelines were not
    // moving — while the sync went on to update 1202 deals. That is the
    // fake-success disease inverted into a fake FAILURE, and it is just as
    // corrosive: an alarm that cries wolf ~36 times a day trains Sam to ignore
    // the one channel that is supposed to be loud. A gate nobody believes is
    // not a gate. The call must be given at least the same 300s that
    // fn_agentlink_reap_stuck uses to declare a run stuck, so curl and the
    // reaper cannot disagree about the same run.
    const cookieCall = src.match(/call_edge\s+"agentlink-cookie-sync"[^\n]*/);
    if (cookieCall) {
      const timeoutArg = cookieCall[0].match(/\bno\s+(\d+)/);
      if (!timeoutArg || Number(timeoutArg[1]) < 300) {
        violations.push(
          `${cronYml}: agentlink-cookie-sync must be called with an explicit curl timeout of at ` +
          `least 300s (fn_agentlink_reap_stuck's own "stuck" threshold). At the default 90s, half ` +
          `of all SUCCESSFUL syncs (median 143s, max 192s) time out as status=000 and the ` +
          `honest-green gate reports a real success as a failure — a fake FAILURE, and 36 ` +
          `false priority-5 pushes a day is how a loud channel gets ignored.`,
        );
      }
    }
    // …and when curl does give up, the verdict must come from the pipeline's
    // own record, not from how long curl was willing to wait. Green must mean
    // "the pipelines moved"; red must mean "they didn't". Both directions are
    // decided by agentlink_sync_log.
    if (!/agentlink_sync_log/.test(src) || !/acquit/.test(src)) {
      violations.push(
        `${cronYml}: a curl timeout on agentlink-cookie-sync must be reconciled against ` +
        `agentlink_sync_log before it counts as a failure. Judging the tick on curl's exit code ` +
        `alone reports slow-but-successful syncs as failures. Query the log's status and only ` +
        `keep the run red when it is genuinely 'stuck', past the reap threshold, or never ` +
        `registered at all.`,
      );
    }
    // …and the row it reconciles against must be one the reaper has already
    // RULED on. 843c6164 judged the row the tick had just created. Supabase's
    // gateway forces that verdict at its own 150s idle timeout and
    // fn_agentlink_reap_stuck does not call a run stuck until 300s, so the row
    // was always 'running', always under the threshold, and always acquitted:
    // the cookie-sync leg could not go red at all. Run 31413717796 logged
    // "verdict: status=running age=151s" and reported SUCCESS while the row it
    // judged (ab407e97) died and was reaped 'stuck' at 485s. A gate that cannot
    // fail is the 465-fake-success-row disease with the sign flipped.
    if (/started_at\s*>=\s*to_timestamp/.test(src)) {
      violations.push(
        `${cronYml}: the cookie-sync verdict is anchored on the CURRENT tick ` +
        `(started_at >= to_timestamp(...)). That row is only ~150s old when the gateway forces ` +
        `the verdict and the reaper needs 300s, so it is always 'running' and always acquitted — ` +
        `the leg can never go red. Judge the newest row OLDER than the reap threshold instead, ` +
        `whose status is final.`,
      );
    }
    // …and it must be reconciled on the question the ALERT claims to answer:
    // is the book still being refreshed? a3fa21b4 judged the newest settled
    // row's status — correct about the row, wrong about the system. It sent 9
    // reds in 39 runs (~39 priority-5 pages/day) reading "the pipelines are not
    // moving" while they were moving: at the two moments it paged (runs
    // 31446750097/31443587597, 31441868477) the book had been refreshed 3500s
    // and 1235s earlier, and 100 ok syncs in 48h had moved 120,236 deal
    // updates. Every stuck row carries upstream_status=NULL, policies_seen=0
    // and dies in the 'deals' phase — AgentLink's API hanging, which Apex
    // cannot fix and should not be paged about per occurrence. True-but-
    // misleading at 39/day costs exactly what false at 36/day cost.
    if (!/WHERE l\.status = 'ok'/.test(src) || !/max\(COALESCE\(l\.finished_at/.test(src)) {
      violations.push(
        `${cronYml}: the cookie-sync verdict must measure how long since the last SUCCESSFUL sync ` +
        `(max(COALESCE(finished_at, started_at)) over status='ok'), not the status of whichever row ` +
        `happens to be newest. A single stuck row inside a fresh stream is upstream weather; paging ` +
        `on it sends a push whose sentence is false as it is being sent.`,
      );
    }
    const acquitTest = src.match(/if \[ "\$ok_age" -le "\$STALE_MAX" \][^\n]*/);
    if (!acquitTest) {
      violations.push(
        `${cronYml}: the cookie-sync acquit must be gated on $ok_age vs $STALE_MAX. Without that ` +
        `bound a pipeline that stops writing rows altogether keeps acquitting on an ancient success ` +
        `and the gate goes quiet permanently.`,
      );
    } else if (/last_status/.test(acquitTest[0])) {
      violations.push(
        `${cronYml}: last_status is diagnostic and must never vote in the acquit. Letting the newest ` +
        `row's status red a fresh book is exactly the a3fa21b4 regression: ~39 true-about-the-row, ` +
        `false-about-the-system pages a day, which is how Sam learns to ignore the one loud channel.`,
      );
    }
    // The push body must say what is actually wrong. The old text asserted
    // "pg_cron's backup is not moving the pipelines" on every red, including
    // the ones where it was moving them.
    if (!/STALE_DETAIL/.test(src) || /not moving the pipelines/.test(src)) {
      violations.push(
        `${cronYml}: the failure push must carry the measured reason (STALE_DETAIL) rather than ` +
        `asserting "pg_cron's backup is not moving the pipelines" on every red. An alert that ` +
        `overstates its own finding burns the channel just as fast as a false one.`,
      );
    }
    // Fail-safe parsing. The old code coerced a non-numeric age to 0, which
    // ACQUITTED a stale 'ok' — fail-open, in the one place that exists to fail
    // loud. The pg_cron gap parser above already set the correct precedent:
    // coerce an unparseable value to "very stale", never to "brand new".
    if (/case "\$ok_age" in ''\|\*\[!0-9\]\*\) ok_age=0 ;; esac/.test(src)) {
      violations.push(
        `${cronYml}: a non-numeric freshness age coerces to 0, which makes a garbled response ACQUIT. ` +
        `Coerce it to a very-stale sentinel instead, matching the pg_cron gap parser's 99999 ` +
        `precedent, so a broken parse fails loud rather than silent.`,
      );
    }
  }
}

// 3. Automation bearer tokens must be environment-backed only. A fallback
//    literal keeps a leaked credential valid even after the environment is
//    rotated and is therefore forbidden in every function that accepts it.
{
  const tokenConsumers = [
    "supabase/functions/bot-sql/index.ts",
    "supabase/functions/apex-exec/index.ts",
    "supabase/functions/agentlink-import/index.ts",
    "supabase/functions/agentlink-cookie-sync/index.ts",
    "supabase/functions/insuracloud-sync/index.ts",
  ];
  for (const file of tokenConsumers) {
    if (!fileExists(file)) continue;
    const src = read(file);
    const hasEnvOverride = /Deno\.env\.get\(\s*['"]BOT_SQL_PERSISTENT_TOKEN['"]\s*\)/.test(src);
    const secretLikeLiteral = /['"][A-Fa-f0-9]{48,}['"]/.test(src);
    if (!hasEnvOverride || secretLikeLiteral) {
      violations.push(
        `${file}: BOT_SQL_PERSISTENT_TOKEN must come from Deno.env only; ` +
        `secret-like fallback literals are forbidden.`,
      );
    }
  }
}

// 4. refresh_sync_health() must not be granted to anon/authenticated. It
//    writes a heartbeat to system_settings — only service_role + bot tokens
//    should be allowed to invoke it.
{
  // Look at the latest migration that defines the grants. The hardened one
  // explicitly REVOKE FROM anon/authenticated. The older migration that
  // GRANT EXECUTE … TO authenticated, anon must NOT be the most recent.
  const migDir = "supabase/migrations";
  let latestGrantState = null; // 'open' or 'locked'
  if (fs.existsSync(path.join(repoRoot, migDir))) {
    const files = fs.readdirSync(path.join(repoRoot, migDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      const text = fs.readFileSync(path.join(repoRoot, migDir, f), "utf8");
      if (/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.refresh_sync_health\(\)\s+TO\s+[^;]*\b(anon|authenticated)\b/i.test(text)) {
        latestGrantState = "open";
      }
      if (/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.refresh_sync_health\(\)\s+FROM\s+[^;]*\b(anon|authenticated)\b/i.test(text)) {
        latestGrantState = "locked";
      }
    }
  }
  if (latestGrantState === "open") {
    violations.push(
      `supabase/migrations: most recent grant on refresh_sync_health() includes anon/authenticated. ` +
      `Lock it down — only service_role should invoke a heartbeat writer.`,
    );
  }
}

// 5. Dashboards must read from the canonical sync_health_summary()/v_sync_health,
//    not directly from agentlink_sync_log. If we find a dashboard reading the
//    raw log table, flag it — scattered freshness math is exactly what
//    v_sync_health exists to replace.
{
  const directReaders = [];
  walk("src/pages", [".tsx"], (rel) => {
    const text = read(rel);
    if (/\.from\(["']agentlink_sync_log["']\)/.test(text)) {
      directReaders.push(rel);
    }
  });
  walk("src/components/dashboard", [".tsx"], (rel) => {
    const text = read(rel);
    if (/\.from\(["']agentlink_sync_log["']\)/.test(text)) {
      directReaders.push(rel);
    }
  });
  if (directReaders.length > 0) {
    violations.push(
      `${directReaders.length} dashboard component(s) read agentlink_sync_log directly: ` +
      `${directReaders.slice(0, 5).join(", ")}${directReaders.length > 5 ? ", …" : ""}. ` +
      `Switch to sync_health_summary() / v_sync_health so transport-vs-upstream freshness ` +
      `is unified and operators see a single truth.`,
    );
  }
}

// 5b. api/sync-insuracloud.ts must not push placeholder client data. If it
//     ships with the old `clientPhone || "+10000000000"` or
//     `clientDateOfBirth || "1980-01-01"` defaults, the next deal with
//     missing fields lands in InsuraCloud as a corrupted carrier record.
{
  const f = "api/sync-insuracloud.ts";
  if (fileExists(f)) {
    const src = read(f);
    const banned = [
      { rx: /clientPhoneNumber:[^,]*\|\|\s*["']\+10000000000["']/, label: "phone placeholder" },
      { rx: /clientDateOfBirth:[^,]*\|\|\s*["']1980-01-01["']/,    label: "DOB placeholder"  },
      { rx: /clientFirstName:[^,]*\|\|\s*["']Unknown["']/,         label: "first-name placeholder" },
      { rx: /clientLastName:[^,]*\|\|\s*["']Client["']/,           label: "last-name placeholder"  },
      { rx: /productSold:[^,]*\|\|\s*["']Life Insurance["']/,      label: "product placeholder"    },
    ];
    for (const { rx, label } of banned) {
      if (rx.test(src)) {
        violations.push(
          `${f}: contains a ${label} that lets a deal with missing data ship a fake client record ` +
          `to InsuraCloud. Validate the field and return 422 instead of substituting a default.`,
        );
      }
    }
    // Also require an explicit 422 / INCOMPLETE_CLIENT_DATA path so removal
    // of the defaults can't be quietly swapped back to silent omission.
    if (!/INCOMPLETE_CLIENT_DATA|MISSING_DOB|MISSING_PHONE/.test(src)) {
      violations.push(
        `${f}: missing the explicit incomplete-client-data validation. Reject missing required ` +
        `fields with a 422 and a code like INCOMPLETE_CLIENT_DATA so callers see the problem.`,
      );
    }
  }
}

// 6. insuracloud-sync must authenticate callers — the function pulls fresh
//    data from upstream and writes to multiple tables. Bare verify_jwt=false
//    with no in-function check would let any internet caller trigger upstream
//    pulls. Require a Bearer/token check in the source.
{
  const f = "supabase/functions/insuracloud-sync/index.ts";
  if (fileExists(f)) {
    const src = read(f);
    const hasBearerCheck = /Authorization|authorization/.test(src) && /validTokens|presented|Bearer/.test(src);
    const has401 = /status:\s*401/.test(src);
    if (!hasBearerCheck || !has401) {
      violations.push(
        `${f}: insuracloud-sync must validate a Bearer token (bot or user JWT) and return 401 ` +
        `on missing/invalid auth. Don't let an unauthenticated caller trigger upstream pulls.`,
      );
    }
  }
}

// 7. PurchaseLeads / LeadCenter / CallCenter must not render the ReadyMode
//    inventory count without sourcing it from system_settings (live) AND
//    showing an "unavailable" path. Hardcoded 72,343 (Sam's example) or any
//    similar magic number is a fake-data violation.
{
  const surfaces = [
    "src/pages/PurchaseLeads.tsx",
    "src/pages/LeadCenter.tsx",
    "src/pages/CallCenter.tsx",
  ];
  for (const f of surfaces) {
    if (!fileExists(f)) continue;
    const text = read(f);
    if (/(72,?343|72343)/.test(text)) {
      violations.push(
        `${f}: contains the literal "72,343" — Sam's EXAMPLE value of ReadyMode inventory. ` +
        `Never hardcode an inventory count. Read from system_settings.readymode_available_leads ` +
        `or render an explicit "unavailable" state.`,
      );
    }
  }
}

if (violations.length === 0) {
  console.log(
    "Sync-reliability guardrail passed (17 rules checked: deploy fail-loud, " +
    "no continue-on-error masking, link must authenticate, " +
    "cron gap parser, insuracloud revival probe, cron tick must fail loud, " +
    "cookie-sync verdict must not judge the in-flight row, " +
    "verdict measures book freshness, last_status must not vote, " +
    "stale bound on ok_age, push carries the measured reason, fail-safe age coercion, " +
    "no errexit-aborting && appends, environment-only bot tokens, " +
    "refresh_sync_health grants, dashboard canonical source, insuracloud-sync " +
    "auth gate, insuracloud placeholder client data, ReadyMode hardcoding).",
  );
  process.exit(0);
}

console.error("Sync-reliability guardrail FAILED:");
for (const v of violations) console.error(` - ${v}`);
process.exit(1);
