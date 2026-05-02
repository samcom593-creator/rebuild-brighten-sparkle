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
  "src/components/dashboard/LiveLeaderboard.tsx",
  "src/components/dashboard/ClosingRateLeaderboard.tsx",
  "src/components/dashboard/TeamOverviewDashboard.tsx",
  "src/components/dashboard/TeamHierarchyManager.tsx",
  "src/components/dashboard/LeaderboardTabs.tsx",
  "src/components/dashboard/ExtendedStatsStrip.tsx",
  "src/components/dashboard/ForecastCard.tsx",
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
  const source = fs.readFileSync(absolutePath, "utf8");

  for (const { regex, message } of forbiddenPatterns) {
    if (regex.test(source)) {
      violations.push(`${relativePath}: ${message}`);
    }
  }
}

for (const relativePath of criticalRecruitingFiles) {
  const absolutePath = path.join(repoRoot, relativePath);
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

walk(path.join(repoRoot, "src"));
walk(path.join(repoRoot, "supabase/functions"));

if (violations.length > 0) {
  console.error("Metric truth guardrail failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`Metric truth guardrail passed for ${filesToCheck.length} files.`);
