import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/strip-comments.mjs";

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

// Sibling public landing surfaces that INDEPENDENTLY restate the same two
// numbers (carrier count + comp range) as hardcoded literals. HeroSection is
// the single source of truth; a sibling that drifts means two money-surfaces
// disagree on the agency's headline comp claim with nothing going red.
// MP-WIB-HERO-PATH-CLAIMS-SWEEP (2026-11-13) — the f04a61a0 fix guarded only
// HeroSection; CareerPathwaySection restates "70%–145%" in three spots (a step
// description, a step title, a stat pill) and a `carriers_partnered ?? 22`
// first-paint/RPC-miss fallback, none of them graded until now. Same disease
// class as the HeroSection half, one file over.
const SIBLINGS = ["src/components/landing/CareerPathwaySection.tsx"];

// Static, crawlable SEO claim surfaces. index.html's <meta name="description">
// hardcodes the comp range ("70%–145%") — the exact text Google shows in the
// search snippet and that AI search (ChatGPT/Perplexity/Claude) ingests when a
// recruit asks about Galaxy's commission. If the comp ceiling ever moves, the
// landing components + their guards update, but this snippet keeps quoting the
// stale number to every crawler forever, with nothing going red. Same claim-
// drift disease class as the sibling sweep (MP-WIB-HERO-PATH-CLAIMS-SWEEP), on
// the highest-external-visibility surface. MP-WIB-HERO-PATH-CLAIMS-SEO (2026-11-13).
const SEO_SURFACES = ["index.html"];

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
  const compBottom = Math.min(Number(compMatch[1]), Number(compMatch[2]));

  return { carrierCount, compTop, compBottom };
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

/** Comp-range + carrier-count claim checks shared by every non-canonical
 *  surface (JS siblings and static SEO HTML). `text` must already have its
 *  surface-appropriate comments removed by the caller. Returns violations. */
function claimViolationsInText(text, canonical, label) {
  const { carrierCount, compTop, compBottom } = canonical;
  const violations = [];

  // comp RANGE literals like "70%–145%" / "70%-145%" — every one must equal the
  // canonical bottom–top (order-independent; a "145%–70%" typo still normalizes).
  for (const cm of text.matchAll(/(\d+)\s*%\s*[–-]\s*(\d+)\s*%/g)) {
    const lo = Math.min(Number(cm[1]), Number(cm[2]));
    const hi = Math.max(Number(cm[1]), Number(cm[2]));
    if (lo !== compBottom || hi !== compTop) {
      violations.push(
        `${label} states comp range "${cm[0].trim()}" but the canonical range is ` +
        `${compBottom}%–${compTop}% (${SURFACE} stats). Say "${compBottom}%–${compTop}%".`,
      );
    }
  }

  // hardcoded carrier-count literals ("50+ carriers" / "22 carriers"). The live
  // value flows through the `${carriers}` variable and carries no leading digit,
  // so it is never matched here — only a stray hardcoded number is.
  for (const cm of text.matchAll(/(\d+)\s*\+?\s*(?:top\s+)?carriers\b/gi)) {
    const stated = Number(cm[1]);
    if (stated !== carrierCount) {
      violations.push(
        `${label} states "${cm[0].trim()}" but the canonical carrier count is ${carrierCount} ` +
        `(${SURFACE}). Use the live \`carriers\` value or ${carrierCount}.`,
      );
    }
  }

  return violations;
}

/** Grade a sibling landing surface that restates the canonical numbers as
 *  hardcoded literals, against the canonical facts derived from HeroSection.
 *  Comments are blanked FIRST (offset-preserving, via the repo's one lexer) so
 *  a claim-of-record in a `//` note is never matched as live copy — the
 *  MP-277 comment-false-positive trap. Returns violation strings. */
export function findSiblingViolations(src, canonical, label) {
  const { carrierCount } = canonical;
  const clean = stripComments(src);
  const violations = claimViolationsInText(clean, canonical, label);

  // the first-paint / RPC-miss fallback literal: `carriers_partnered ?? N`. A
  // stale RPC or the very first render shows N, so N must equal canonical too.
  const fb = clean.match(/carriers_partnered\s*\?\?\s*(\d+)/);
  if (fb && Number(fb[1]) !== carrierCount) {
    violations.push(
      `${label} carrier fallback "?? ${fb[1]}" drifts from the canonical carrier count ${carrierCount} ` +
      `(${SURFACE}) — a stale RPC / first paint renders ${fb[1]}. Say "?? ${carrierCount}".`,
    );
  }

  return violations;
}

/** Grade a static, crawlable SEO HTML surface. Every <meta ...description...>
 *  content value is claim text Google + AI search read verbatim. HTML comments
 *  (<!-- -->) are stripped first, and we deliberately read ONLY description-type
 *  meta content (never arbitrary markup or <script>/JSON-LD bodies) so a URL's
 *  "//", an og:image dimension, or a JSON-LD number can never false-match.
 *  Returns violation strings. */
export function findSeoDescriptionViolations(html, canonical, label) {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const violations = [];
  for (const tag of noComments.matchAll(/<meta\b[^>]*>/gi)) {
    const t = tag[0];
    if (!/(?:name|property)\s*=\s*"[^"]*description[^"]*"/i.test(t)) continue;
    const cm = t.match(/content\s*=\s*"([^"]*)"/i);
    if (!cm) continue;
    violations.push(...claimViolationsInText(cm[1], canonical, `${label} meta description`));
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

  // ── sibling-surface logic (findSiblingViolations) ──
  const canon = { carrierCount: 22, compTop: 145, compBottom: 70 };
  const siblingCases = [
    // [name, source, expectViolations]
    ["sibling clean: range + fallback agree", `const stats=[{value:"70%–145%"}];\nconst carriers = s?.carriers_partnered ?? 22; // note`, 0],
    ["sibling dirty: stale comp range (70-120)", `title:"70%-120% Commission",`, 1],
    ["sibling: inverted range normalizes to clean", `x:"145%–70%"`, 0],
    ["sibling dirty: fallback drift (?? 18)", `const c = s?.carriers_partnered ?? 18;`, 1],
    ["sibling dirty: hardcoded 50+ carriers", `desc:"Contract with up to 50+ carriers"`, 1],
    ["sibling: wrong numbers INSIDE a comment are NOT matched (MP-277 trap)", `// old copy said 50+ carriers and 90%-130%\nconst stats=[{value:"70%–145%"}];`, 0],
    ["sibling dirty: two stale ranges counted separately", `a:"60%-145%", b:"70%-150%"`, 2],
    ["sibling clean: live \${carriers} variable is not a literal", `desc:\`up to \${carriers} carriers\``, 0],
  ];
  for (const [name, src, want] of siblingCases) {
    let got;
    try {
      got = findSiblingViolations(src, canon, "fixture").length;
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

  // ── SEO-surface logic (findSeoDescriptionViolations) ──
  const seoCases = [
    // [name, html, expectViolations]
    ["seo clean: meta description matches 70–145", `<meta name="description" content="Earn 70%–145% commissions paid weekly.">`, 0],
    ["seo dirty: stale comp ceiling in description (70-120)", `<meta name="description" content="Earn 70%-120% commissions.">`, 1],
    ["seo dirty: og:description comp drift (90-130)", `<meta property="og:description" content="Up to 90%-130% comp.">`, 1],
    ["seo dirty: stale carrier count in description", `<meta name="description" content="Partner with 14 top carriers.">`, 1],
    ["seo dirty: both description metas drift", `<meta name="description" content="80%-140%"><meta property="og:description" content="60%-145%">`, 2],
    ["seo clean: non-description meta ignored (og:image:width)", `<meta property="og:image:width" content="1200">`, 0],
    ["seo clean: drift in a NON-description meta is not graded (scoped read)", `<meta name="keywords" content="90%-130% comp"><meta name="description" content="70%–145%">`, 0],
    ["seo clean: wrong numbers inside an HTML comment are NOT matched", `<!-- old: 50%-200% and 14 carriers --><meta name="description" content="70%–145%">`, 0],
    ["seo clean: a URL's digits never false-match (description-only read)", `<meta property="og:url" content="https://x.org/70-145-carriers"><meta name="description" content="70%–145%">`, 0],
  ];
  for (const [name, html, want] of seoCases) {
    let got;
    try {
      got = findSeoDescriptionViolations(html, canon, "fixture").length;
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

  const total = cases.length + derivationGuards.length + siblingCases.length + seoCases.length;
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

  // Canonical truth comes from HeroSection. If it can't be read or derived, fail
  // loud (a refactor must re-point this guard, never silently pass).
  const heroAbs = path.join(repoRoot, SURFACE);
  let heroSrc;
  try {
    heroSrc = fs.readFileSync(heroAbs, "utf8");
  } catch {
    console.error(`✗ check:hero-path-claims — ${SURFACE} not found; re-point this guard.`);
    process.exit(1);
  }

  const surfaces = []; // { label, violations }
  let canonical;
  try {
    canonical = deriveCanonical(heroSrc);
    surfaces.push({ label: SURFACE, violations: findViolations(heroSrc) });
  } catch (e) {
    console.error(`✗ check:hero-path-claims — ${e.message}`);
    process.exit(1);
  }

  for (const rel of SIBLINGS) {
    const abs = path.join(repoRoot, rel);
    let src;
    try {
      src = fs.readFileSync(abs, "utf8");
    } catch {
      console.error(`✗ check:hero-path-claims — sibling ${rel} not found; re-point this guard.`);
      process.exit(1);
    }
    surfaces.push({ label: rel, violations: findSiblingViolations(src, canonical, rel) });
  }

  for (const rel of SEO_SURFACES) {
    const abs = path.join(repoRoot, rel);
    let src;
    try {
      src = fs.readFileSync(abs, "utf8");
    } catch {
      console.error(`✗ check:hero-path-claims — SEO surface ${rel} not found; re-point this guard.`);
      process.exit(1);
    }
    surfaces.push({ label: rel, violations: findSeoDescriptionViolations(src, canonical, rel) });
  }

  const totalViolations = surfaces.reduce((n, s) => n + s.violations.length, 0);
  if (totalViolations === 0) {
    const names = surfaces.map((s) => s.label.split("/").pop()).join(", ");
    console.log(
      `✓ check:hero-path-claims — carrier count (${canonical.carrierCount}) + comp range ` +
      `(${canonical.compBottom}%–${canonical.compTop}%) agree across ${surfaces.length} landing surface(s): ${names}.`,
    );
    process.exit(0);
  }

  console.error(`✗ check:hero-path-claims — ${totalViolations} claim(s) contradict the landing's canonical truth:`);
  for (const s of surfaces) {
    for (const v of s.violations) console.error(`   • ${v}`);
  }
  console.error(`\n   Canonical source: ${SURFACE} (carriers[] length + stats comp range). Make every landing surface agree.`);
  process.exit(1);
}

main();
