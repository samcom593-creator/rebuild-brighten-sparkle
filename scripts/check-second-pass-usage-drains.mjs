#!/usr/bin/env node

import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260904224500_second_pass_usage_drain_controls.sql",
  "utf8",
);
const readyMode = readFileSync("supabase/functions/readymode-sync/index.ts", "utf8");
const externalCron = readFileSync(".github/workflows/external-cron-backup.yml", "utf8");

const failures = [];
const requireMatch = (source, pattern, message) => {
  if (!pattern.test(source)) failures.push(message);
};

requireMatch(
  migration,
  /create or replace function public\.agentlink_book_rebuild\(p_deals jsonb\)[\s\S]*?on conflict \(deal_key\) do update[\s\S]*?is distinct from/i,
  "AgentLink book rebuild is not change-only",
);
requireMatch(
  migration,
  /delete from public\.agentlink_book b[\s\S]*?where not exists/i,
  "AgentLink removals are not reconciled against the complete source snapshot",
);
requireMatch(
  migration,
  /create or replace function public\.agentlink_sync_snapshot_from_book\(\)[\s\S]*?on conflict \(id\) do update[\s\S]*?is distinct from/i,
  "legacy AgentLink snapshot mirror is not change-only",
);
if (/delete from public\.agentlink_book\s*;/i.test(migration)) {
  failures.push("wholesale AgentLink book delete regression found");
}
if (/delete from public\.agentlink_deals_snapshot\s*;/i.test(migration)) {
  failures.push("wholesale AgentLink snapshot delete regression found");
}
requireMatch(
  migration,
  /where jobname = 'apex-sync-health-refresh-1m'[\s\S]*?cron\.unschedule/i,
  "false internal external-cron heartbeat writer is still scheduled",
);
requireMatch(
  migration,
  /from cron\.job_run_details order by runid desc limit 1/i,
  "sync health still scans the full cron ledger for its heartbeat",
);
requireMatch(
  migration,
  /create or replace function public\.upsert_readymode_dialer_calls\(p_rows jsonb\)[\s\S]*?is distinct from/i,
  "ReadyMode upsert does not suppress exact repeats",
);
requireMatch(
  migration,
  /create or replace function public\.run_readymode_sync_if_due\(\)[\s\S]*?interval '55 minutes'/i,
  "ReadyMode dark-source recovery backoff is missing",
);
requireMatch(
  readyMode,
  /\.rpc\(\s*"upsert_readymode_dialer_calls"[\s\S]*?p_rows:\s*rows/i,
  "ReadyMode Edge worker bypasses the change-only RPC",
);
if (/\.from\("readymode_dialer_calls"\)[\s\S]{0,120}\.upsert\(rows/.test(readyMode)) {
  failures.push("direct repeated ReadyMode upsert regression found");
}
requireMatch(
  externalCron,
  /from cron\.job_run_details order by runid desc limit 1/i,
  "external cron heartbeat still scans all cron history",
);

if (failures.length) {
  console.error("check:second-pass-usage-drains FAILED");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  "check:second-pass-usage-drains OK — mirror diffs, ReadyMode no-ops/backoff, and O(1) heartbeats are pinned.",
);
