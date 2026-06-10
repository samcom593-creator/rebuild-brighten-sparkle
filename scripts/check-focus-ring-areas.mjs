#!/usr/bin/env node
// Caps the v22 multi-utility focus-ring halo pattern across the 22 wave-60/61/62/
// 63/64-tracked component trees. Owned by Website Integrity Bot.
// Built wave-68 (2026-06-10) — 13th pre-commit gate.
//
// What this gate locks:
//   v22 §10 + wave-58 banned the Tailwind multi-utility focus-ring halo —
//   the `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
//   3-utility aura that paints a 6px shadcn-style outline on every interactive
//   surface. The canonical AgentLink-crisp focus signal is one token:
//
//     focus-visible:shadow-[var(--apex-focus-ring)]
//
//   wave-58 routed `src/components/ui/button.tsx` to that token. The remaining
//   23 shadcn primitive defaults in `src/components/ui` (input/textarea/select/
//   dialog/sheet/sidebar/etc) still carry the multi-utility halo — they are
//   the legitimate floor and the baseline locks them at exactly that count.
//
// What gets counted (the banned signal):
//   1. `focus-visible:ring-1`/`focus-visible:ring-2`  (multi-utility halo width)
//   2. `focus:ring-1`/`focus:ring-2`                  (legacy non-visible variant)
//   3. `focus-visible:ring-offset-1`/`focus-visible:ring-offset-2`  (offset layer)
//   4. `focus:ring-offset-1`/`focus:ring-offset-2`    (legacy offset)
//   5. Arbitrary  `ring-[...]`                        (rainbow/glow color halos)
//
//   The canonical `--apex-focus-ring` token via
//   `focus-visible:shadow-[var(--apex-focus-ring)]` is NOT counted (it's the
//   approved discipline). The sidebar's `focus-visible:ring-2` paired with
//   `ring-sidebar-ring` IS counted (it's still the multi-utility halo aesthetic
//   the cleanup buried).
//
// Why this matters:
//   Same persistence-mandate failure mode wave-46/47 had to catch 4 months
//   after wave-22 (lucide vendor-icons subset re-creeping back); same drift
//   wave-63 had to catch ~185 instances post-wave-2 codemod; same drift wave-66
//   had to catch post-13c6338b v25-rainbow-shadow codemod. Without this gate,
//   the wave-58 Button discipline silently decays as every new interactive
//   surface reaches for the shadcn-default multi-utility halo aesthetic and
//   nothing watches. This gate makes it impossible to silently re-introduce
//   the banned pattern outside the locked floors.
//
// Mechanic (mirrors check-shadow-areas.mjs):
//   For each configured area: walk its tree, count lines matching any banned
//   focus-ring signal, subtract lines carrying an explicit allow marker, fail
//   if total > baseline. ALL areas must pass; first failure exits 1.
//
// Baselines: measured floors at HEAD d2b68020.
//   src/components/ui:        23  (shadcn primitive defaults — locked at floor)
//   src/components/dashboard:  1  (PerformanceDashboardSection — surgical-defer)
//   src/pages:                 1  (AgentPipelineSimple textarea — surgical-defer)
//   src/components/callcenter: 1  (CallCenterFilters SelectTrigger — surgical-defer)
//   18 other trees:            0  (v22/v24/v25 codemod-cleaned, locked at 0)
//
// Adding a legitimate focus-ring halo (modal close, hero CTA with custom focus,
// shadcn primitive extension): tag the line with the marker
//
//     focus-ring-allow:<short-kebab-reason>
//
// in a trailing comment OR an inline JSX comment OR a stand-alone line directly
// above. Same mental model as wave-60's bg-gradient-card-allow and wave-65's
// shadow-glow-allow.
//
// Raising a baseline: only when 3+ new legitimate hits land in one PR for that
// area. Otherwise tag them and leave the baseline alone.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Post-wave-68 baselines = exact measured floors at lock time (HEAD d2b68020).
// Locks v22 multi-utility focus-ring halo pattern at the current floor across
// all 22 trees.
const AREAS = [
  // shadcn primitive defaults (intentional floor — Lovable doesn't auto-update)
  { dir: "src/components/ui", baseline: 23 },
  // Active surfaces (surgical-defer candidates — migrate to --apex-focus-ring later)
  { dir: "src/pages", baseline: 1 },
  { dir: "src/components/dashboard", baseline: 1 },
  { dir: "src/components/callcenter", baseline: 1 },
  // v22/v24/v25 codemod-cleaned trees (sweep verified at exactly 0)
  { dir: "src/components/landing", baseline: 0 },
  { dir: "src/components/awards", baseline: 0 },
  { dir: "src/components/agent", baseline: 0 },
  { dir: "src/components/layout", baseline: 0 },
  { dir: "src/components/recruiter", baseline: 0 },
  { dir: "src/components/admin", baseline: 0 },
  { dir: "src/components/celebrations", baseline: 0 },
  { dir: "src/components/command", baseline: 0 },
  { dir: "src/components/contentwheel", baseline: 0 },
  { dir: "src/components/course", baseline: 0 },
  { dir: "src/components/crm", baseline: 0 },
  { dir: "src/components/deals", baseline: 0 },
  { dir: "src/components/finances", baseline: 0 },
  { dir: "src/components/next-step", baseline: 0 },
  { dir: "src/components/pipeline", baseline: 0 },
  { dir: "src/components/plaque", baseline: 0 },
  { dir: "src/components/profile", baseline: 0 },
  { dir: "src/components/system-health", baseline: 0 },
];

const MULTI_UTIL_RING_RX = /(?:focus-visible|focus):ring-[12](?:\b|\s|"|'|`)/;
const RING_OFFSET_RX = /(?:focus-visible|focus):ring-offset-[12]/;
const ARBITRARY_RING_RX = /\bring-\[/;
const ALLOW_RX = /focus-ring-allow/;

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function scanArea({ dir, baseline }) {
  const absDir = path.join(repoRoot, dir);
  const files = walk(absDir);
  const hits = [];
  let allowed = 0;
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isBanned =
        MULTI_UTIL_RING_RX.test(line) ||
        RING_OFFSET_RX.test(line) ||
        ARBITRARY_RING_RX.test(line);
      if (!isBanned) continue;
      const prev = i > 0 ? lines[i - 1] : "";
      if (ALLOW_RX.test(line) || ALLOW_RX.test(prev)) {
        allowed += 1;
        continue;
      }
      hits.push({
        file: path.relative(repoRoot, file),
        line: i + 1,
        snippet: line.trim().slice(0, 140),
      });
    }
  }
  return { dir, baseline, count: hits.length, allowed, hits };
}

let anyFailed = false;
for (const area of AREAS) {
  const result = scanArea(area);
  if (result.count <= result.baseline) {
    console.log(
      `✓ check:focus-ring-areas — ${result.dir} ${result.count}/${result.baseline} banned focus-ring instances (allow-marked: ${result.allowed})`,
    );
    continue;
  }
  anyFailed = true;
  console.error(
    `\n✗ check:focus-ring-areas — ${result.dir} ${result.count} banned focus-ring instances exceeds baseline ${result.baseline} (Δ +${result.count - result.baseline})\n`,
  );
  console.error("The v22 multi-utility focus-ring halo pattern is banned:");
  console.error("  (1) `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`");
  console.error("  (2) Any `focus:ring-N` / `focus:ring-offset-N` legacy variant");
  console.error("  (3) Arbitrary `ring-[Xpx]` color halos");
  console.error("The canonical AgentLink-crisp focus signal is one token:");
  console.error("  `focus-visible:shadow-[var(--apex-focus-ring)]`");
  console.error("\nEither:");
  console.error("  (a) Migrate to --apex-focus-ring via the Button discipline, OR");
  console.error("  (b) Tag the line with `focus-ring-allow:<reason>` if this is");
  console.error("      a shadcn primitive extension or a deliberate halo.");
  console.error("\nNewest hits (showing first 12):");
  const overflow = result.hits.slice(-12);
  for (const h of overflow) {
    console.error(`  ${h.file}:${h.line}`);
    console.error(`    ${h.snippet}`);
  }
  console.error(
    `\nIf 3+ truly justified halos are landing in this PR, bump the ${result.dir} baseline in scripts/check-focus-ring-areas.mjs.`,
  );
  console.error("Do not just remove the check — argue with Website Integrity Bot.");
}

process.exit(anyFailed ? 1 : 0);
