import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// ESM module: esbuild is CJS, so reach it through createRequire.
const nodeRequire = createRequire(import.meta.url);

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

// wave-wow-source-mismatch 2026-08-07 — class-of-fix ratchet.
// Every production bucket on the Dashboard snapshot must resolve its source through
// the SAME `alTruthAvailable` gate. When one bucket silently kept reading the legacy
// `deals` table while its sibling read v_agentlink_book_truth, the "Vs prior matched
// week" tile divided a truth numerator by a legacy denominator and rendered -1.66%
// where the honest same-source figure was -26.79%. A ratio built from two tables is
// not a growth rate. This blocks any future bucket from being added ungated.
const SOURCE_GATED_PRODUCTION_KEYS = [
  "todayAlp",
  "todayDeals",
  "weekAlp",
  "weekDeals",
  "monthAlp",
  "monthDeals",
  "previousWeekAlp",
];
function dashboardSnapshotSourceParity() {
  const relativePath = "src/pages/Dashboard.tsx";
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  const source = fs.readFileSync(absolutePath, "utf8");

  // Scope to the runtime object literal, not the DashboardSnapshot type declaration
  // above it (which legitimately reads `previousWeekAlp: number;`).
  const objectStart = source.indexOf("sourceGeneratedAt: new Date().toISOString(),");
  if (objectStart === -1) {
    violations.push(
      `${relativePath}: could not locate the snapshot object literal (anchor \`sourceGeneratedAt: new Date().toISOString(),\`) — update scripts/check-metric-truth.mjs so the source-parity ratchet keeps running`,
    );
    return;
  }
  const objectSource = source.slice(objectStart);

  for (const key of SOURCE_GATED_PRODUCTION_KEYS) {
    const match = objectSource.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"));
    if (!match) {
      violations.push(
        `${relativePath}: production bucket \`${key}\` not found — if it was renamed, update SOURCE_GATED_PRODUCTION_KEYS in scripts/check-metric-truth.mjs so it stays source-gated`,
      );
      continue;
    }
    if (!match[1].includes("alTruthAvailable")) {
      violations.push(
        `${relativePath}: production bucket \`${key}\` must resolve its source via \`alTruthAvailable ? … : …\` — mixing v_agentlink_book_truth with the legacy deals table in one snapshot produces false week-over-week percentages`,
      );
    }
  }
}
dashboardSnapshotSourceParity();

// wave-vault-source-parity 2026-08-07 — same class, juxtaposition form.
// The AgentLink Vault overview summed its ALP from agentlink_book (1,432 live
// rows) while counting its "deals" tiles off the legacy `deals` table (1,740
// rows, source='agent_link'). No code divided them, so the Dashboard ratchet
// above could never catch it — the two numbers just sat adjacent in the same
// emerald financial group describing one book, 21.5% apart. Every panel on that
// page reads agentlink_*; the overview must not reintroduce a legacy reader.
function agentLinkVaultOverviewSourceParity() {
  const relativePath = "src/pages/AgentLinkVault.tsx";
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  const source = fs.readFileSync(absolutePath, "utf8");

  const panelStart = source.indexOf("function OverviewPanel()");
  if (panelStart === -1) {
    violations.push(
      `${relativePath}: could not locate \`function OverviewPanel()\` — update scripts/check-metric-truth.mjs so the vault source-parity ratchet keeps running`,
    );
    return;
  }
  // Bound the scan at the next top-level panel so this only governs the overview.
  const panelEnd = source.indexOf("\nfunction ", panelStart + 1);
  const panelRaw = source.slice(panelStart, panelEnd === -1 ? undefined : panelEnd);
  // Strip comments before matching. The rules below name the exact anti-patterns
  // they ban, so a comment explaining WHY `.eq("is_dead", false)` is wrong would
  // otherwise trip the rule against it — the guard failing on its own
  // documentation. Caught on first run of this ratchet.
  const panelSource = panelRaw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  if (/\.from\(\s*["']deals["']\s*\)/.test(panelSource)) {
    violations.push(
      `${relativePath}: OverviewPanel must not read the legacy \`deals\` table — its ALP tile sums agentlink_book, so counting policies from a different population makes the financial group describe one book out of two sources`,
    );
  }
  // Accepts agentlink_book OR v_agentlink_book_scoped. The scoped view is
  // agentlink_book minus roster-excluded agents, and v_agentlink_book_truth now
  // applies the SAME exclusion — so scoped is the population that keeps parity
  // and the raw table is the one that breaks it. MEASURED 2026-08-23:
  //   v_agentlink_book_truth  1441 deals / $1,935,908
  //   v_agentlink_book_scoped 1441 deals / $1,935,908  <- parity holds
  //   agentlink_book (raw)    1471 deals / $2,056,990  <- parity BREAKS
  // Widened only after checking both directions; the rule still fails on any
  // third source, which is the invariant it exists to protect.
  if (!/\.from\(\s*["'](agentlink_book|v_agentlink_book_scoped)["']/.test(panelSource)) {
    violations.push(
      `${relativePath}: OverviewPanel must count policies from \`agentlink_book\` or \`v_agentlink_book_scoped\`, the same population v_agentlink_book_truth sums for the ALP tile`,
    );
  }
  // The live-count predicate must match the view's `is_dead IS NOT TRUE`.
  // `.eq("is_dead", false)` drops null rows and would undercount against the ALP.
  if (/\.eq\(\s*["']is_dead["']\s*,\s*false\s*\)/.test(panelSource)) {
    violations.push(
      `${relativePath}: use \`.not("is_dead", "is", true)\` for the live-policy count — \`.eq("is_dead", false)\` excludes null rows that v_agentlink_book_truth counts, so the tile would undercount the population its ALP is summed from`,
    );
  }
}
agentLinkVaultOverviewSourceParity();

// wave-vault-source-parity 2026-08-07 — the banner that reports shipped work
// was itself reporting a stale number. WhatShippedTodayBanner renders
// "{SHIPPED_TOTAL} platform changes live" from a hand-maintained constant,
// deliberately NOT from SHIPPED.length (importing the array would undo the
// 710 KB chunk split). It had drifted to 273 against 293 real entries. The
// constant has to stay hardcoded, so it gets recounted here instead.
function shippedTotalMatchesData() {
  const bannerPath = "src/components/dashboard/WhatShippedTodayBanner.tsx";
  const dataPath = "src/data/shipped-data.ts";
  const bannerAbs = path.join(repoRoot, bannerPath);
  const dataAbs = path.join(repoRoot, dataPath);
  if (!fs.existsSync(bannerAbs) || !fs.existsSync(dataAbs)) return;

  const bannerSource = fs.readFileSync(bannerAbs, "utf8");
  const declared = bannerSource.match(/^const SHIPPED_TOTAL = (\d+);/m);
  if (!declared) {
    violations.push(
      `${bannerPath}: could not find \`const SHIPPED_TOTAL = <n>;\` — update scripts/check-metric-truth.mjs so the shipped-count ratchet keeps running`,
    );
    return;
  }

  // Count entries by their `ts:` field rather than a brace pattern, so
  // reformatting the object literals cannot silently change the count.
  const dataSource = fs.readFileSync(dataAbs, "utf8");

  // The count alone is not enough: it can agree with a file that does not
  // compile. 2026-08-30 a rebase conflict spliced one entry into the entry
  // above it, so that entry lost its `{`, its `ts:` AND its `}` together —
  // both sides of the comparison dropped by one, this guard passed, and the
  // breakage surfaced four minutes later as a red build on main. The
  // property that was actually violated is "this file parses", so assert
  // that directly instead of inferring it from a tally.
  try {
    const esbuild = nodeRequire("esbuild");
    esbuild.transformSync(dataSource, { loader: "ts" });
  } catch (err) {
    violations.push(
      `${dataPath}: does not parse (${String(err.message ?? err).split("\n")[0].slice(0, 160)}). A corrupted entry can still produce a self-consistent count, so the count below proves nothing until this parses.`,
    );
    return;
  }

  const actual = (dataSource.match(/^ {4}ts: /gm) ?? []).length;
  if (actual === 0) {
    violations.push(
      `${dataPath}: counted 0 SHIPPED entries — the entry shape changed, so update scripts/check-metric-truth.mjs rather than trusting a zero`,
    );
    return;
  }

  if (Number(declared[1]) !== actual) {
    violations.push(
      `${bannerPath}: SHIPPED_TOTAL is ${declared[1]} but ${dataPath} holds ${actual} entries — set it to ${actual}. The banner renders this as "N platform changes live" on Sam's dashboard, so a stale constant under-reports shipped work.`,
    );
  }
}
shippedTotalMatchesData();

// wave-carrier-share-window-parity 2026-08-11 — the existing parity guards all
// police the SOURCE of two operands (legacy `deals` vs `agentlink_book`). This
// bug had one source and two WINDOWS, so every one of them passed it.
//
// BusinessAnalytics renders a per-carrier Share column. The numerator is
// v_business_analytics_carriers.total_premium (rolling 30 days). The denominator
// was `totalPremium` = v_business_analytics_summary.total_premium_mtd
// (month-to-date). On 2026-08-11 that printed Combined at 220.8% and made the
// Share column sum to 473.7% — every row inflated ~4.7x.
//
// The trap this guard exists to prevent is the FIX, not the bug: an audit
// diagnosed it as "an aggregate 'Combined' row is being treated as a carrier"
// and prescribed filtering that row out. Combined is a real carrier holding
// 46.6% of 30-day premium (the agency's largest). Filtering it would have
// deleted the top carrier from analytics AND left the column at 253%.
//
// So: the denominator must be derived from the same rows being rendered.
function carrierShareUsesRowDerivedDenominator() {
  const pagePath = "src/pages/BusinessAnalytics.tsx";
  const abs = path.join(repoRoot, pagePath);
  if (!fs.existsSync(abs)) return;
  const source = fs.readFileSync(abs, "utf8");

  if (!/const carrierTotalPremium\s*=/.test(source)) {
    violations.push(
      `${pagePath}: \`carrierTotalPremium\` is gone. The per-carrier Share denominator must be summed from the carrier rows themselves, not taken from an MTD total — see wave-carrier-share-window-parity.`,
    );
    return;
  }

  // The share expression itself must not divide by the MTD figure.
  const shareLine = source
    .split("\n")
    .find((l) => l.includes("Number(c.total_premium)") && l.includes("* 100"));
  if (!shareLine) {
    violations.push(
      `${pagePath}: could not locate the carrier Share computation — update scripts/check-metric-truth.mjs so this ratchet keeps running rather than silently passing.`,
    );
    return;
  }
  if (/\btotalPremium\b/.test(shareLine) && !/carrierTotalPremium/.test(shareLine)) {
    violations.push(
      `${pagePath}: the carrier Share divides a rolling-30d numerator by \`totalPremium\` (month-to-date). Mixing windows is what made this column sum to 473.7%. Divide by \`carrierTotalPremium\`.`,
    );
  }
}
carrierShareUsesRowDerivedDenominator();

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
