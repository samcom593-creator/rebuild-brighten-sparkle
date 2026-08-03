#!/usr/bin/env node
// wave-47 (2026-06-09): pre-commit guard against vendor-icons-landing regex
// drift. Asserts that every lucide-react icon imported by a landing-reachable
// file appears in the vendor-icons-landing rolldown chunk-group regex in
// vite.config.ts.
//
// Why this exists:
//   Wave-22 split lucide-react into vendor-icons-landing (17 eager icons)
//   vs vendor-icons (everything else). For 4 months that 17-name list went
//   stale — landing-reachable lazy Suspense children kept adding lucide
//   imports outside the subset, so when those lazy chunks fired mid-
//   Lighthouse-audit they pulled the full 47KB raw vendor-icons blob.
//   Wave-46 expanded the regex to 48 icons covering every current landing
//   import. Without this guard the same drift class re-opens the next time
//   a landing component imports a new icon — vendor-icons silently re-
//   appears on the heaviest-transfers list, perf score drops 1-3 points,
//   nobody notices for weeks.
//
// Algorithm:
//   1. Parse vite.config.ts → extract the vendor-icons-landing regex →
//      collect the set of icon names inside the (a|b|c|...) alternation.
//   2. Hardcoded list of landing-reachable file paths (Index.tsx + every
//      file Index lazy-imports + App.tsx eager-imports that render on `/`).
//      Hardcoded on purpose: forces any new landing component to be added
//      explicitly so its lucide imports get audited.
//   3. For each landing-reachable file, parse `import { X, Y, Z } from
//      "lucide-react"` blocks (single- or multi-line), normalize PascalCase
//      → kebab-case via lucide-react's convention.
//   4. Diff: every imported icon MUST be present in the regex set. Any
//      missing → FAIL.
//
// Override: a landing file may opt out a specific icon if it's known to be
// dynamically-imported (never on cold landing static graph) by adding the
// literal comment marker `vendor-icons-landing-census-allow:<icon-name>`
// in that file. (Currently unused — added for future flexibility.)

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// ---------- step 1: extract regex icon set from vite.config.ts ----------
const viteConfigPath = path.join(repoRoot, "vite.config.ts");
const viteConfig = readFileSync(viteConfigPath, "utf-8");

// Match the vendor-icons-landing rule's test field. The regex literal is a
// JS string with double-escaped backslashes. Anchor on the rule shape (name
// → priority → test) so prose mentions of "vendor-icons-landing" in
// surrounding comments don't false-match. Extract the (icon-a|icon-b|...)
// alternation group inside the icons/ path segment.
const VENDOR_ICONS_LANDING_RE =
  /name:\s*["']vendor-icons-landing["']\s*,\s*priority:\s*\d+\s*,\s*test:\s*["'][^"']*lucide-react[^"']*icons[^()]*\(([^)]+)\)/;
const vendorMatch = viteConfig.match(VENDOR_ICONS_LANDING_RE);
if (!vendorMatch) {
  console.error(
    "✗ check-vendor-icons-landing-census FAILED — could not locate vendor-icons-landing regex in vite.config.ts.",
  );
  console.error(
    "  Has the chunk-group name been renamed or the regex shape changed? Update VENDOR_ICONS_LANDING_RE in this script.",
  );
  process.exit(1);
}
const regexIcons = new Set(vendorMatch[1].split("|").map((s) => s.trim()));

// ---------- step 2: hardcoded landing-reachable file list ----------
// Source-of-truth census per wave-46. Update this list any time a new file
// is rendered (eager OR lazy) by Index.tsx, or eager-imported by App.tsx.
const LANDING_FILES = [
  // Eager from Index.tsx (above-the-fold)
  "src/pages/Index.tsx",
  "src/components/landing/Navbar.tsx",
  "src/components/landing/HeroSection.tsx",
  "src/components/landing/DealsTicker.tsx",
  "src/components/landing/LiveStatsCounterStrip.tsx",
  "src/components/landing/RecentHiresTicker.tsx",
  // Lazy children rendered by Index.tsx Suspense block
  "src/components/landing/Testimonials.tsx",
  "src/components/landing/BenefitsSection.tsx",
  "src/components/landing/EarningsSection.tsx",
  "src/components/landing/CareerPathwaySection.tsx",
  "src/components/landing/RecruitFAQ.tsx",
  "src/components/landing/CTASection.tsx",
  "src/components/landing/Footer.tsx",
  "src/components/landing/StickyMobileCTA.tsx",
  // App-level lazy that fires on every route including `/`
  "src/components/SupabaseHealthBanner.tsx",
];

// ---------- step 3: PascalCase → kebab-case ----------
// Mirrors lucide-react's icon-file naming. E.g. "ArrowRight" → "arrow-right",
// "Building2" → "building-2", "HeartHandshake" → "heart-handshake",
// "AlertTriangle" → "triangle-alert" (special rename in lucide v0.350+).
const LUCIDE_RENAMES = {
  AlertTriangle: "triangle-alert",
};
function pascalToKebab(name) {
  if (LUCIDE_RENAMES[name]) return LUCIDE_RENAMES[name];
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d)/g, "$1-$2")
    .toLowerCase();
}

// ---------- step 3b (wave-49): resolve lucide re-export shims ----------
// lucide-react v0.462 ships SHIM icon files for legacy names that re-export
// from a different underlying file (e.g. check-circle-2.js → circle-check.js,
// file-signature.js → file-pen-line.js, home.js → house.js, alert-triangle.js
// → triangle-alert.js). Rollup's manualChunks `test` runs against the
// resolved module path — so listing only the shim name in the regex makes
// the SHIM module land in vendor-icons-landing but the icon BODY lands in
// vendor-icons. Wave-48 found this the hard way via live Lighthouse 3 days
// after wave-46 shipped. This step walks every regex entry, reads the icon
// file, and if it's a re-export shim asserts the target is ALSO in the
// regex. Same check runs for any imported kebab name as a belt-and-braces.
const ICON_DIR = path.join(
  repoRoot,
  "node_modules",
  "lucide-react",
  "dist",
  "esm",
  "icons",
);
const REEXPORT_RE = /export\s*\{\s*default\s*\}\s*from\s*['"]\.\/([a-z0-9-]+)\.js['"]/;
function resolveShim(kebab) {
  const p = path.join(ICON_DIR, `${kebab}.js`);
  if (!existsSync(p)) return null;
  const m = readFileSync(p, "utf-8").match(REEXPORT_RE);
  return m ? m[1] : null;
}

// Walk the existing regex set: any shim → require its target is also in the set.
const shimOffenders = []; // [{shim, target}]
for (const ic of regexIcons) {
  const target = resolveShim(ic);
  if (target && !regexIcons.has(target)) {
    shimOffenders.push({ shim: ic, target });
  }
}
if (shimOffenders.length > 0) {
  console.error(
    "✗ check-vendor-icons-landing-census FAILED — vendor-icons-landing regex contains lucide shim name(s) without their re-export targets.",
  );
  console.error(
    "  Rollup's manualChunks test runs against the RESOLVED module path, not the import specifier. The shim file lands in vendor-icons-landing but the actual icon body lands in vendor-icons. Add the target to the regex.",
  );
  console.error("");
  for (const { shim, target } of shimOffenders) {
    console.error(`  shim "${shim}" → target "${target}" (missing from regex)`);
  }
  console.error("");
  console.error("  Fix: add the missing target(s) to the vendor-icons-landing regex in vite.config.ts.");
  process.exit(1);
}

// ---------- step 4: extract lucide imports + diff ----------
const LUCIDE_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g;
const offenders = []; // [{file, missing: [icon, ...]}]

for (const rel of LANDING_FILES) {
  const abs = path.join(repoRoot, rel);
  if (!existsSync(abs)) {
    console.error(
      `✗ check-vendor-icons-landing-census FAILED — landing file ${rel} listed in this script does not exist. Either restore the file or remove it from LANDING_FILES.`,
    );
    process.exit(1);
  }
  const text = readFileSync(abs, "utf-8");
  const fileMissing = [];
  let m;
  LUCIDE_IMPORT_RE.lastIndex = 0;
  while ((m = LUCIDE_IMPORT_RE.exec(text)) !== null) {
    const names = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const name of names) {
      const kebab = pascalToKebab(name);
      // Names to require in the regex: the kebab itself, plus its shim
      // target if it's a re-export. Both must be present so neither the
      // shim nor the body falls into vendor-icons.
      const required = [kebab];
      const target = resolveShim(kebab);
      if (target) required.push(target);
      for (const req of required) {
        if (!regexIcons.has(req)) {
          const optOut = text.includes(`vendor-icons-landing-census-allow:${req}`);
          if (!optOut) fileMissing.push({ name, kebab: req });
        }
      }
    }
  }
  if (fileMissing.length > 0) offenders.push({ file: rel, missing: fileMissing });
}

if (offenders.length > 0) {
  console.error(
    "✗ check-vendor-icons-landing-census FAILED — landing-reachable file(s) import lucide icons NOT in the vendor-icons-landing regex.",
  );
  console.error(
    "  This will silently pull the full vendor-icons chunk (~12KB gz / ~40KB raw) onto cold-landing transfers during Lighthouse audits, causing perf regression.",
  );
  console.error("");
  for (const o of offenders) {
    console.error(`  ${o.file}`);
    for (const { name, kebab } of o.missing) {
      console.error(`    ${name} → "${kebab}" (missing from regex)`);
    }
    console.error("");
  }
  console.error("  Fix:");
  console.error("    1. Open vite.config.ts → find the vendor-icons-landing rule.");
  console.error(
    "    2. Add the missing kebab-case icon name(s) to the (a|b|c|...) alternation inside the regex test.",
  );
  console.error(
    "    3. Re-run `npm run build` and verify dist/index.html modulepreload chain still has vendor-icons-landing.",
  );
  console.error(
    "    4. Alternative: if the import is genuinely never on cold landing (e.g. behind a guaranteed async path), add a comment marker `vendor-icons-landing-census-allow:<kebab-name>` in the file.",
  );
  process.exit(1);
}

console.log(
  `✓ check-vendor-icons-landing-census OK — ${LANDING_FILES.length} landing-reachable files scanned, every lucide import is in vendor-icons-landing regex (${regexIcons.size} icons covered).`,
);
