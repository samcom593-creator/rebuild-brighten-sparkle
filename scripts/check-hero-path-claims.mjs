import fs from "node:fs";
import path from "node:path";

// Persistence-mandate guard — HeroSection path-card claim consistency.
//
// MP-WIB-HERO-PATH-CLAIMS (2026-11-12). The landing hero renders three
// "choose your path" cards (partnerPaths). The Licensed Producers card
// shipped "Direct lines with 14+ top carriers ... aggressive comp tiers
// up to 100%+" for months while the SAME FILE's canonical stats — the
// `stats` pills ("70%–145%", "22 carriers") and the 22-entry `carriers`
// logo-wall array — said 22 carriers and a 145% comp ceiling. Server
// truth (landing_live_stats().carriers_partnered) is also 22. So the card
// understated the single most important number to the highest-value
// recruit (a licensed producer's comp: 145%, rendered as "100%+") AND
// contradicted the rest of its own page. Same disease class as the
// landing-marketing-claim waves: a hardcoded number literal drifting from
// the live/canonical truth, on the public money surface.
//
// This guard asserts: any carrier-count or comp-ceiling number stated in a
// partnerPaths card description MUST equal the file's own canonical values
// derived from the `carriers` array length and the `stats` comp range.
// It does NOT reach the network — it grades the file against itself, so it
// can never cry wolf about a transient and never goes stale.
//
// --selftest proves both directions (consistent -> pass, understated ->
// fail) against synthetic fixtures so every commit re-verifies the logic.

const SURFACE = "src/components/landing/HeroSection.tsx";

/** Slice the body of `const <name> = [ ... ];` (first match). Returns null if absent. */
function arrayBlock(src, name) {
  const start = src.indexOf(`const ${name} = [`);
  if (start === -1) return null;
  const open = src.indexOf("[", start);
  // find matching close bracket at depth 0
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** The canonical facts a path-card claim must agree with. Throws if the
 *  file no longer exposes them (a refactor must re-point this guard, not
 *  silently pass). */
export function deriveCanonical(src) {
  const carriersBlock = arrayBlock(src, "carriers");
  if (carriersBlock === null) {
    throw new Error(`could not find \`const carriers = [ ... ]\` in ${SURFACE} — re-point check-hero-path-claims.mjs`);
  }
  const carrierCount = (carriersBlock.match(/"[^"]+"/g) || []).length;
  if (carrierCount === 0) {
    throw new Error(`\`carriers\` array parsed to 0 entries in ${SURFACE} — re-point check-hero-path-claims.mjs`);
  }

  const statsBlock = arrayBlock(src, "stats");
  if (statsBlock === null) {
    throw new Error(`could not find \`const stats = [ ... ]\` in ${SURFACE} — re-point check-hero-path-claims.mjs`);
  }
  // comp range value like "70%–145%" or "70%-145%" (en-dash or hyphen).
  const compMatch = statsBlock.match(/(\d+)\s*%\s*[–-]\s*(\d+)\s*%/);
  if (!compMatch) {
    throw new Error(`could not find a comp range (e.g. "70%–145%") in \`stats\` of ${SURFACE} — re-point check-hero-path-claims.mjs`);
  }
  const compTop = Math.max(Number(compMatch[1]), Number(compMatch[2]));

  return { carrierCount, compTop };
}

/** Validate partnerPaths descriptions against canonical facts.
 *  Returns an array of violation strings (empty = clean). */
export function findViolations(src) {
  const { carrierCount, compTop } = deriveCanonical(src);
  const pathsBlock = arrayBlock(src, "partnerPaths");
  if (pathsBlock === null) {
    throw new Error(`could not find \`const partnerPaths = [ ... ]\` in ${SURFACE} — re-point check-hero-path-claims.mjs`);
  }

  const violations = [];
  const descRe = /description:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = descRe.exec(pathsBlock)) !== null) {
    const desc = m[1];

    // carrier-count claims: "14+ top carriers" / "22 carriers" — check EVERY
    // one in the description, not just the first (a card may carry several).
    for (const cm of desc.matchAll(/(\d+)\s*\+?\s*(?:top\s+)?carriers/gi)) {
      const stated = Number(cm[1]);
      if (stated !== carrierCount) {
        violations.push(
          `path card states "${cm[0].trim()}" but the canonical carrier count is ${carrierCount} ` +
          `(carriers[] length + stats "22 carriers"). Say "${carrierCount} top carriers".`,
        );
      }
    }

    // comp-ceiling claims: "up to 100%+" / "up to 145%" / "100%+ comp" — every
    // one, so a second, overstated figure can't hide behind a valid first.
    for (const cm of desc.matchAll(/up to\s*(\d+)\s*%|\b(\d+)\s*%\s*\+/gi)) {
      const stated = Number(cm[1] ?? cm[2]);
      if (stated !== compTop) {
        violations.push(
          `path card states comp ceiling "${cm[0].trim()}" but the canonical comp top is ${compTop}% ` +
          `(stats "70%–145%"). Say "up to ${compTop}%".`,
        );
      }
    }
  }
  return violations;
}

function selftest() {
  const base = (desc) => `
const carriers = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K",
  "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V",
];
const stats = [
  { label: "Commission contracts", value: "70%–145%" },
  { label: "Carriers on contract", value: "22 carriers" },
];
const partnerPaths = [
  { title: "Licensed Producers", description: ${JSON.stringify(desc)} },
];
`;
  const cases = [
    // [name, source, expectViolations]
    ["clean: matches canonical 22 / 145", base("Direct lines with 22 top carriers, comp tiers up to 145%."), 0],
    ["dirty: the exact pre-fix bug (14+ carriers + 100%+)", base("Direct lines with 14+ top carriers, comp tiers up to 100%+."), 2],
    ["dirty: understated carriers only", base("Direct lines with 18 top carriers, comp tiers up to 145%."), 1],
    ["dirty: understated comp only", base("Direct lines with 22 top carriers, comp tiers up to 120%."), 1],
    ["clean: no numeric claim at all", base("Direct lines with top carriers and strong comp."), 0],
    ["dirty: trailing-% style '145%+' would overstate the ceiling", base("Direct lines with 22 top carriers, comp up to 145% — some earn 160%+."), 1],
  ];

  let pass = 0;
  for (const [name, src, want] of cases) {
    let got;
    try {
      got = findViolations(src).length;
    } catch (e) {
      console.error(`  ✗ ${name}: threw unexpectedly — ${e.message}`);
      continue;
    }
    if (got === want) {
      pass++;
      console.log(`  ✓ ${name} (${got} violation${got === 1 ? "" : "s"})`);
    } else {
      console.error(`  ✗ ${name}: expected ${want} violation(s), got ${got}`);
    }
  }

  // canonical-derivation must THROW when the file no longer exposes its facts
  const derivationGuards = [
    ["missing carriers[] throws", "const stats=[{value:\"70%–145%\"}];\nconst partnerPaths=[];"],
    ["missing comp range throws", "const carriers=[\"A\"];\nconst stats=[{value:\"flat\"}];\nconst partnerPaths=[];"],
  ];
  for (const [name, src] of derivationGuards) {
    let threw = false;
    try { findViolations(src); } catch { threw = true; }
    if (threw) { pass++; console.log(`  ✓ ${name}`); }
    else console.error(`  ✗ ${name}: expected a throw, got none`);
  }

  const total = cases.length + derivationGuards.length;
  if (pass === total) {
    console.log(`\n✓ check:hero-path-claims --selftest ${pass}/${total} PASS`);
    process.exit(0);
  }
  console.error(`\n✗ check:hero-path-claims --selftest ${pass}/${total} — logic regressed`);
  process.exit(1);
}

function main() {
  if (process.argv.includes("--selftest")) return selftest();

  const repoRoot = path.resolve(import.meta.dirname, "..");
  const abs = path.join(repoRoot, SURFACE);
  let src;
  try {
    src = fs.readFileSync(abs, "utf8");
  } catch {
    console.error(`✗ check:hero-path-claims — ${SURFACE} not found; re-point this guard.`);
    process.exit(1);
  }

  let violations;
  try {
    violations = findViolations(src);
  } catch (e) {
    console.error(`✗ check:hero-path-claims — ${e.message}`);
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log(`✓ check:hero-path-claims — hero path-card claims agree with the file's canonical carrier count + comp range.`);
    process.exit(0);
  }

  console.error(`✗ check:hero-path-claims — ${violations.length} path-card claim(s) contradict the landing's own truth:`);
  for (const v of violations) console.error(`   • ${v}`);
  console.error(`\n   Fix ${SURFACE} so partnerPaths copy matches the canonical stats/carriers values.`);
  process.exit(1);
}

main();
