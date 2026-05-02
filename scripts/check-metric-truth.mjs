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

if (violations.length > 0) {
  console.error("Metric truth guardrail failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`Metric truth guardrail passed for ${filesToCheck.length} files.`);
