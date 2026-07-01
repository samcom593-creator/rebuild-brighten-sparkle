import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const filesToCheck = [
  "src/pages/Dashboard.tsx",
  "src/pages/Today.tsx",
  "src/pages/Leaderboard.tsx",
  "src/pages/MyTeam.tsx",
  "src/pages/AgentManagement.tsx",
  "src/pages/AgentPipelineSimple.tsx",
  "src/pages/AgentDetail.tsx",
  "src/components/dashboard/AgentRankBadge.tsx",
  "src/components/dashboard/TeamHierarchyManager.tsx",
  "src/components/dashboard/LeaderboardTabs.tsx",
  "src/components/dashboard/ExtendedStatsStrip.tsx",
];

const criticalRecruitingFiles = [
  "src/App.tsx",
  "src/pages/GetLicensed.tsx",
  "src/pages/ScheduleCall.tsx",
  "src/pages/ApplySuccessLicensed.tsx",
  "src/pages/ApplySuccessUnlicensed.tsx",
  "src/components/callcenter/CallCenterVoiceRecorder.tsx",
  "src/components/dashboard/QuickEmailMenu.tsx",
  "supabase/functions/discord-webhook-notify/index.ts",
  "supabase/functions/discord-leaderboards/index.ts",
  "supabase/functions/send-course-enrollment-email/index.ts",
  "supabase/functions/send-unlicensed-process-update/index.ts",
  "supabase/functions/send-daily-checkin-prompt/index.ts",
  "supabase/functions/send-whatsapp-onboarding-blast/index.ts",
  "supabase/functions/send-followup-emails/index.ts",
  "supabase/functions/send-post-call-followup/index.ts",
  "supabase/functions/send-licensing-instructions/index.ts",
];

const forbiddenPatterns = [
  {
    regex: /\.from\("deals"\)[\s\S]{0,600}\.(?:eq|gt|gte|lt|lte|order)\("effective_date"/m,
    message: "truth-critical deals queries must not use deals.effective_date",
  },
  {
    regex: /\.from\("deals"\)[\s\S]{0,600}\.(?:eq|gt|gte|lt|lte|order)\("created_at"/m,
    message: "truth-critical deals queries must not use deals.created_at",
  },
  {
    regex: /\.from\("daily_production"\)[\s\S]{0,600}\bselect\([^)]*\baop\b/m,
    message: "truth-critical ALP widgets must not read daily_production.aop",
  },
];

const violations = [];

for (const relativePath of filesToCheck) {
  const absolutePath = path.join(repoRoot, relativePath);
  // Skip if file no longer exists (deleted upstream — do not block commits repo-wide)
  if (!fs.existsSync(absolutePath)) continue;
  const source = fs.readFileSync(absolutePath, "utf8");

  for (const { regex, message } of forbiddenPatterns) {
    if (regex.test(source)) {
      violations.push(`${relativePath}: ${message}`);
    }
  }
}

for (const relativePath of criticalRecruitingFiles) {
  const absolutePath = path.join(repoRoot, relativePath);
  // Skip if file no longer exists (deleted upstream — do not block commits repo-wide)
  if (!fs.existsSync(absolutePath)) continue;
  const source = fs.readFileSync(absolutePath, "utf8");

  if (/rebuild-brighten-sparkle\.lovable\.app/.test(source)) {
    violations.push(`${relativePath}: critical recruiting flows must not point at the legacy lovable.app domain`);
  }

  if (/https:\/\/calendly\.com\/apexfinancialmarketing\/|https:\/\/calendly\.com\/apex-financial\/|licensed-prospect-call-clone-1/.test(source)) {
    violations.push(`${relativePath}: critical recruiting flows must use the canonical Apex Calendly links`);
  }
}

const appSource = fs.readFileSync(path.join(repoRoot, "src/App.tsx"), "utf8");
if (!appSource.includes('path="/checkin"') || !appSource.includes('path="/daily-checkin"')) {
  violations.push("src/App.tsx: applicant check-in routes must remain mounted");
}

const discordNotifySource = fs.readFileSync(
  path.join(repoRoot, "supabase/functions/discord-webhook-notify/index.ts"),
  "utf8",
);
if (/daily_production/.test(discordNotifySource)) {
  violations.push("supabase/functions/discord-webhook-notify/index.ts: Discord milestones must not read daily_production");
}

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    if (!absolutePath.endsWith(".ts") && !absolutePath.endsWith(".tsx")) continue;
    const source = fs.readFileSync(absolutePath, "utf8");
    if (/https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/.test(source)) {
      violations.push(`${path.relative(repoRoot, absolutePath)}: real Discord webhook must not live in frontend source`);
    }
  }
}

// Deeper truth-scan across every backend surface: edge functions, api routes,
// and SQL migrations. Forbids leaderboard/reward queries that still rely on
// `deals.effective_date`, `daily_production.aop`, or the dead InsuraCloud
// fallback user id. Catches regressions before they ship.
const backendForbidden = [
  {
    regex: /(?:leaderboard|reward|top_producer|payout|award)[\s\S]{0,400}?(?:FROM|JOIN)\s+(?:public\.)?deals\b[\s\S]{0,400}?\beffective_date\b/i,
    message: "leaderboard/reward SQL must use deals.posted_at, not effective_date",
  },
  {
    regex: /(?:leaderboard|reward|top_producer|payout|award)[\s\S]{0,400}?\bdaily_production\.aop\b/i,
    message: "leaderboard/reward SQL must not read daily_production.aop (use deals.posted_at)",
  },
  {
    regex: /DEFAULT_USER_ID\s*=\s*211\b/,
    message: "InsuraCloud DEFAULT_USER_ID (211 — Sam fallback) must not exist; require explicit agent_insuracloud_id",
  },
  {
    regex: /sam(uel)?_james_id\s*=\s*['"]7c3c5581-3544-437f-bfe2-91391afb217d['"]/i,
    message: "hardcoded SAMUEL_JAMES_ID must be resolved dynamically (admin role lookup)",
  },
];

function deepWalk(dir, extensions) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      deepWalk(absolutePath, extensions);
      continue;
    }
    if (!extensions.some((ext) => absolutePath.endsWith(ext))) continue;
    const source = fs.readFileSync(absolutePath, "utf8");
    for (const { regex, message } of backendForbidden) {
      if (regex.test(source)) {
        violations.push(`${path.relative(repoRoot, absolutePath)}: ${message}`);
      }
    }
  }
}

walk(path.join(repoRoot, "src"));
walk(path.join(repoRoot, "supabase/functions"));

deepWalk(path.join(repoRoot, "supabase/functions"), [".ts", ".tsx"]);
deepWalk(path.join(repoRoot, "api"), [".ts", ".tsx", ".js", ".mjs"]);
// Migrations are historical and append-only. We don't scan them with the
// leaderboard regex — old definitions are superseded by later CREATE OR
// REPLACE migrations. We DO scan migrations only for the InsuraCloud Sam-
// fallback constant since that should never appear at all.
function migrationsHardScan() {
  const dir = path.join(repoRoot, "supabase/migrations");
  if (!fs.existsSync(dir)) return;
  const hardRules = backendForbidden.filter((r) => /DEFAULT_USER_ID|sam(uel)?_james_id/i.test(r.regex.source));
  if (hardRules.length === 0) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() || !entry.name.endsWith(".sql")) continue;
    const abs = path.join(dir, entry.name);
    const source = fs.readFileSync(abs, "utf8");
    for (const { regex, message } of hardRules) {
      if (regex.test(source)) {
        violations.push(`${path.relative(repoRoot, abs)}: ${message}`);
      }
    }
  }
}
migrationsHardScan();

if (violations.length > 0) {
  console.error("Metric truth guardrail failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`Metric truth guardrail passed (${filesToCheck.length} explicit files + recursive scan of src/, supabase/functions, api/, supabase/migrations).`);
