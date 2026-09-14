#!/usr/bin/env node
/**
 * check:demo-mask-coverage — every Supabase read that skips the seam must mask by hand.
 *
 * WHY THIS EXISTS
 * Demo mode masks data at one seam: demoFetch is installed as the supabase-js
 * client's `global.fetch`, so every .from() and .rpc() is covered by construction.
 * A component that fetches Supabase directly — DealsTicker does, to keep the
 * 170 kB SDK off the landing bundle — routes around that seam entirely.
 *
 * MP-530 is why this is a guard and not a comment. The gate fix landed, deployed,
 * and the landing ticker still rendered real producers and real ALP under a
 * banner reading "every number and name on screen is fake", because that one
 * component never touched demoFetch. Then a mutation proved the repair itself was
 * ungraded: deleting the maskIfDemo call from DealsTicker reddens NOTHING — the
 * unit tests prove the mask works, and nothing proves the caller calls it. That is
 * the same shape as the original bug one level up, so the fix needs its own guard.
 *
 * THE RULE
 * A src/ file that fetches a Supabase DATA url (/rest/v1 or /functions/v1) must
 * either mask the response with maskIfDemo, or carry a written exemption saying
 * why its response is not rendered as client data. Exemptions are named here,
 * with reasons, not counted — a bare number would let a new unmasked read take a
 * retiring one's slot (MP-356's laundering).
 *
 * WHAT IS NOT GRADED
 * Writes and fire-and-forget pings expose nothing to the screen, and masking a
 * URL the page merely builds would be meaningless. Those are the exemptions.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DATA_URL = /\/(rest|functions)\/v1/;

/** Exempt, by name, each with the reason it renders no client data. */
const EXEMPT = new Map([
  ["src/shared/telemetry/beacon.ts", "write-only: POSTs analytics_events, renders nothing"],
  ["src/components/RecruitingShortLink.tsx", "write-only: fire-and-forget tap ping, renders nothing"],
  ["src/components/dashboard/CalendarSyncSection.tsx", "builds an ICS feed URL for display; never reads a body"],
  ["src/pages/ReadyModeIntegration.tsx", "builds a webhook URL for display; never reads a body"],
  ["src/pages/BotToken.tsx", "documentation string showing operators the endpoint"],
  ["src/pages/HireLink.tsx", "comment describing the submit path"],
  ["src/lib/callLab/providers.ts", "call-lab transport base URL; session audio, not book data"],
  ["src/components/dashboard/ProfileSettings.tsx", "write: update-user-email, returns a status not a row"],
  ["src/pages/DashboardAccounts.tsx", "write: update-user-email, returns a status not a row"],
  ["src/pages/AssistantInterviewForm.tsx", "write: submits an interview, returns a status"],
  ["src/pages/admin/IntegrationsSettings.tsx", "operator SQL console; showing real rows IS the feature"],
  ["src/pages/SharePage.tsx", "public share token page; content library, not the book"],
  ["src/data/shipped-data.ts", "prose changelog, not code"],
]);

const files = execSync(
  "git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { encoding: "utf8" },
).trim().split("\n").filter(Boolean).filter((f) => !f.startsWith("src/tests/"));

const seam = ["src/integrations/supabase/demoFetch.ts", "src/integrations/supabase/boundedFetch.ts", "src/integrations/supabase/client.ts", "src/lib/demoMode.ts"];
const violations = [];
const covered = [];
const unusedExemptions = new Set(EXEMPT.keys());

for (const f of files) {
  if (seam.includes(f)) continue;
  const src = readFileSync(f, "utf8");
  if (!DATA_URL.test(src)) continue;
  unusedExemptions.delete(f);
  if (EXEMPT.has(f)) continue;
  if (/maskIfDemo\s*\(/.test(src)) { covered.push(f); continue; }
  violations.push(f);
}

if (unusedExemptions.size) {
  console.error(`[check-demo-mask-coverage] FAIL — ${unusedExemptions.size} exemption(s) name a file that no longer fetches Supabase.`);
  console.error("  A stale exemption is a slot a future unmasked read can occupy silently. Remove it:");
  for (const f of unusedExemptions) console.error(`    ${f}`);
  process.exit(1);
}

if (violations.length) {
  console.error(`[check-demo-mask-coverage] FAIL — ${violations.length} file(s) fetch Supabase outside the SDK without masking.`);
  console.error("  In demo mode these render real client data under a banner saying every number and name is fake.");
  console.error("  Fix: pass the parsed body through maskIfDemo() from @/lib/demoMode, or add a written exemption in this script.");
  for (const f of violations) console.error(`    ${f}`);
  process.exit(1);
}

console.log(`✓ check:demo-mask-coverage — ${covered.length} seam-bypassing read(s) masked by hand, ${EXEMPT.size} exempt by name with reasons.`);
for (const f of covered) console.log(`    masked: ${f}`);
