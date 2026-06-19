import fs from "node:fs";
import path from "node:path";

// Persistence-mandate guard for the feb05b97 / 86f8d98e truth-floor disease.
//
// What re-shipped twice: a landing surface used `liveStats?.<key> ?? <N>`
// with N set ABOVE current truth (104 vs truth=41). When the RPC came back
// honest, the fallback clamped UP and the public landing lied.
//
// This guard locks the fallback CEILING per landing_live_stats() key. Any
// surface that writes `?? <number>` against one of the tracked keys MUST be
// at or below the ceiling. Ceilings are intentionally above today's truth
// (gives margin for live numbers to climb) but below the historical lie
// values (104 / 95 / 123). When truth grows, ratchet the ceiling up in this
// file in the SAME PR that ships the truth growth.

const repoRoot = path.resolve(import.meta.dirname, "..");

// Surfaces that consume landing_live_stats() / public truth.
const TRACKED_FILES = [
  "src/components/landing/LiveStatsCounterStrip.tsx",
  "src/components/landing/CTASection.tsx",
  "src/components/landing/CareerPathwaySection.tsx",
  "src/components/landing/HeroSection.tsx",
  "src/components/landing/RecentHiresTicker.tsx",
  "src/pages/Landing.tsx",
];

// Ceiling = max allowed `?? N` fallback per key. Truth as of 2026-06-19:
// active_agents=41, applications_30d=131, carriers_partnered=22.
// Ceilings give ~25% headroom for live growth without re-opening the lie.
const CEILINGS = {
  active_agents: 50,
  applications_30d: 150,
  carriers_partnered: 25,
  people_count: 50,
  total_people_count: 100,
  hires_this_week: 15,
};

const KEY_NAMES = Object.keys(CEILINGS);

const violations = [];

for (const rel of TRACKED_FILES) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, "utf8");
  const lines = src.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const key of KEY_NAMES) {
      // Match: <anything>.<key>\s*\?\?\s*<digits>
      // Captures the fallback number after the ?? operator.
      const re = new RegExp(`\\.${key}\\s*\\?\\?\\s*(\\d+)`);
      const m = line.match(re);
      if (m) {
        const fallback = Number.parseInt(m[1], 10);
        if (fallback > CEILINGS[key]) {
          violations.push(
            `${rel}:${i + 1}: ?? ${fallback} fallback for landing_live_stats.${key} exceeds ceiling ${CEILINGS[key]} — clamps truth UP and lies on public landing. Lower the fallback or raise the ceiling in scripts/check-landing-truth-floor.mjs (with a justification).`
          );
        }
      }

      // Also catch: const FLOOR = { <key>: N, ... }
      const objRe = new RegExp(`\\b${key}\\s*:\\s*(\\d+)`);
      const m2 = line.match(objRe);
      if (m2 && /HARDCODED|FLOOR|FALLBACK|DEFAULT/i.test(line + (lines[i - 1] || ""))) {
        const fallback = Number.parseInt(m2[1], 10);
        if (fallback > CEILINGS[key]) {
          violations.push(
            `${rel}:${i + 1}: HARDCODED_FLOOR.${key}=${fallback} exceeds ceiling ${CEILINGS[key]} — pick() will clamp truth UP. Lower the floor or raise the ceiling in scripts/check-landing-truth-floor.mjs.`
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("check:landing-truth-floor — landing surfaces would clamp truth UPWARD:");
  for (const v of violations) console.error("  " + v);
  console.error("");
  console.error("Why this exists: feb05b97 dropped live agent count 123 -> 41. 86f8d98e then");
  console.error("found 4 landing surfaces still clamping the new truth back up to 104 via ??");
  console.error("fallbacks above the new floor. This guard prevents the same lie re-shipping.");
  process.exit(1);
}

console.log(
  `check:landing-truth-floor OK — ${TRACKED_FILES.length} surfaces × ${KEY_NAMES.length} keys, no fallback exceeds ceiling.`
);
