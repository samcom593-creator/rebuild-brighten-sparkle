#!/usr/bin/env node

import { readFileSync } from "node:fs";

const webVitals = readFileSync("src/shared/lib/webVitals.ts", "utf8");
const migrations = readFileSync(
  "supabase/migrations/20260904224000_supabase_usage_drain_controls.sql",
  "utf8",
);

const failures = [];
const requireMatch = (source, pattern, message) => {
  if (!pattern.test(source)) failures.push(message);
};

requireMatch(webVitals, /new Map<string, VitalEntry>\(\)/, "web vitals are not coalesced by name");
requireMatch(webVitals, /new Set<string>\(\)/, "web vitals do not remember page-level reports");
requireMatch(webVitals, /session_id:\s*sessionId/, "web vitals have no session observability");
if (/queue\.push\(entry\)/.test(webVitals)) {
  failures.push("per-interaction web-vital queue.push regression found");
}

requireMatch(
  migrations,
  /create or replace function public\.run_apex_outbox_dispatch_if_pending\(\)/i,
  "pending-aware outbox gate is missing",
);
requireMatch(
  migrations,
  /if not exists \([\s\S]*?from public\.outbox_events[\s\S]*?return null;/i,
  "outbox gate does not suppress empty Edge launches",
);
requireMatch(
  migrations,
  /command := 'select public\.run_apex_outbox_dispatch_if_pending\(\);'/i,
  "the one-minute cron is not wired to the pending-aware gate",
);
requireMatch(
  migrations,
  /template_key like 'reissue-40d-%'[\s\S]*?last_attempted_at is null/i,
  "stale one-time reissue campaigns are not narrowly quarantined",
);
requireMatch(
  migrations,
  /create or replace function public\.supabase_usage_drain_health\(\)/i,
  "aggregate usage health RPC is missing",
);
requireMatch(
  migrations,
  /session_user <> 'postgres'[\s\S]*?coalesce\(auth\.role\(\), ''\) <> 'service_role'[\s\S]*?apex_is_admin/i,
  "usage health RPC is not operator/service-role/admin gated",
);

if (failures.length > 0) {
  console.error("check:supabase-usage-drains FAILED");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("check:supabase-usage-drains OK — page-level vitals, empty-outbox suppression, campaign quarantine, and aggregate health are pinned.");
