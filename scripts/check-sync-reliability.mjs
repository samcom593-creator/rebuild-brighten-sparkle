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
    if (!/insuracloud-sync/.test(src)) {
      violations.push(
        `${cronYml}: must call insuracloud-sync edge function. It's the only auto-syncing ` +
        `transport (Bearer-token), the only one that works without manual cookie rotation.`,
      );
    }
    if (!/refresh_sync_health/.test(src)) {
      violations.push(
        `${cronYml}: must call public.refresh_sync_health() each tick so the v_sync_health ` +
        `view has a fresh heartbeat for github_external_cron.`,
      );
    }
  }
}

// 3. Hardcoded persistent bot token in supabase/functions/bot-sql/index.ts is
//    a security liability. The function MUST accept an env override
//    (BOT_SQL_PERSISTENT_TOKEN) so the literal becomes the LAST-RESORT
//    fallback that can be revoked by setting the env var and redeploying.
//    A bare hardcoded constant with no env path is rejected outright.
{
  const botSql = "supabase/functions/bot-sql/index.ts";
  if (fileExists(botSql)) {
    const src = read(botSql);
    const hasLiteral = /CLAUDE_PERSISTENT_TOKEN\s*=[^"]*['"][A-Za-z0-9_-]{20,}['"]/.test(src);
    const hasEnvOverride = /Deno\.env\.get\(\s*['"]BOT_SQL_PERSISTENT_TOKEN['"]\s*\)/.test(src);
    if (hasLiteral && !hasEnvOverride) {
      violations.push(
        `${botSql}: hardcoded CLAUDE_PERSISTENT_TOKEN with no env override. ` +
        `Wrap in \`Deno.env.get("BOT_SQL_PERSISTENT_TOKEN") || "<literal>"\` so the ` +
        `secret can be rotated by setting the env var. Bare literal is unrotatable.`,
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

// 6. PurchaseLeads / LeadCenter / CallCenter must not render the ReadyMode
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
    "Sync-reliability guardrail passed (6 rules checked: deploy fail-loud, " +
    "cron gap parser, insuracloud cron presence, bot-sql hardcoded token, " +
    "refresh_sync_health grants, ReadyMode hardcoding).",
  );
  process.exit(0);
}

console.error("Sync-reliability guardrail FAILED:");
for (const v of violations) console.error(` - ${v}`);
process.exit(1);
