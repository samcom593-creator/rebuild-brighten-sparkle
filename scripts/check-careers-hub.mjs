#!/usr/bin/env node
/**
 * check-careers-hub.mjs — the /careers hub must be a REAL page, advertised, and
 * complete. Closes the soft-404 class on the parent of the Google-for-Jobs
 * cluster.
 *
 * THE BUG THIS LOCKS (2026-11-13). Only `<Route path="/careers/:state">` was
 * declared. Bare /careers fell through to the `*` catch-all and served HTTP 200
 * with a "404 NOT FOUND" body — a soft-404 on the PARENT of 10 live
 * /careers/<state> recruiting pages. A recruit who types "<brand> careers" and
 * a crawler walking up from /careers/florida both hit a dead page, and Google
 * can index the thin NOT-FOUND shell, diluting the whole subtree.
 *
 * check-canonical-url.mjs Rule C already fails if /careers is in the sitemap
 * with no matching route (the regression where someone deletes the hub route).
 * This guard adds the two things Rule C can't see:
 *   A  /careers is a DECLARED route (exact, not :state, not the "*" catch-all),
 *      so the hub can't silently decay back into the catch-all soft-404.
 *   B  /careers is ADVERTISED in sitemap.xml — the hub is only worth building if
 *      a crawler is told it exists.
 *   C  the hub is DATA-DRIVEN over STATES (the single source of truth in
 *      StateCareerLanding). It maps STATES into /careers/<slug> links, so a new
 *      state lights up on the hub automatically and can never be orphaned from
 *      it — the hub↔leaves analogue of Rule D's sitemap↔leaves parity.
 *   D  the hub renders NO hardcoded "<N> states" count. Every count (the badge,
 *      the subhead, AND the SEO meta description Google shows in the snippet)
 *      must derive from STATES.length. Rule C only proves the visible link list
 *      is data-driven; it is blind to copy/SEO strings, which is how the
 *      2026-11-22 meta-description leak ("across 10 states") survived it.
 *   E  the top-producer EARNINGS figure is single-sourced, never re-literaled.
 *      The claim "top first-year producers have written $120K+ in commissions"
 *      ships VERBATIM across FIVE public surfaces — the state page's SEO meta +
 *      Google-for-Jobs JobPosting JSON-LD + visible hero, AND this hub's SEO meta
 *      + visible hero. check-landing-marketing-claims.mjs allow-lists the figure
 *      so it is DEFENSIBLE, but it grades each occurrence independently, so a
 *      figure edited in one place (say the hero to "$150K+") passes while the
 *      SERP snippet and the indexed JobPosting still say "$120K+". Google
 *      de-indexes a JobPosting whose structured data contradicts the visible
 *      page, so that drift silently loses the #1 recruiting SERP. The sibling of
 *      Rule D: StateCareerLanding exports a TOP_PRODUCER_EARNINGS constant and all
 *      five surfaces interpolate it, so a hardcoded "written $N in commissions"
 *      literal anywhere in the two careers files is a build failure.
 *
 * Usage:
 *   node scripts/check-careers-hub.mjs            # check the repo
 *   node scripts/check-careers-hub.mjs --selftest # prove the checks both ways
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every declared <Route path="..."> literal in App.tsx. */
export function routePaths(appSrc) {
  const out = new Set();
  for (const m of appSrc.matchAll(/<Route\b[^>]*\bpath\s*=\s*["']([^"']*)["']/gi)) {
    out.add(m[1]);
  }
  return out;
}

/** True iff "/careers" (exactly) is a declared route — not ":state", not "*". */
export function declaresCareersHub(appSrc) {
  return routePaths(appSrc).has("/careers");
}

/** Normalized paths of every sitemap <loc> (trailing slash stripped except root). */
export function sitemapPaths(xml) {
  const out = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    try {
      let p = new URL(m[1]).pathname;
      if (p.length > 1) p = p.replace(/\/+$/, "");
      out.push(p);
    } catch {
      /* malformed loc — check-canonical-url owns that failure */
    }
  }
  return out;
}

/** True iff the bare /careers hub has a <loc> in the sitemap. */
export function sitemapAdvertisesHub(xml) {
  return sitemapPaths(xml).includes("/careers");
}

/**
 * True iff CareersIndex renders the state list data-driven from STATES, so it
 * stays complete as states are added. Requires: the STATES import from
 * StateCareerLanding, a `STATES.map(...)` iteration, and a /careers/<slug> link
 * template inside the file.
 */
export function hubIsDataDriven(indexSrc) {
  const importsStates =
    /import\s*\{[^}]*\bSTATES\b[^}]*\}\s*from\s*["']\.\/StateCareerLanding["']/.test(indexSrc);
  const mapsStates = /\bSTATES\s*\.\s*map\b/.test(indexSrc);
  const linksState = /\/careers\/\$\{[^}]*\.?slug[^}]*\}/.test(indexSrc);
  return importsStates && mapsStates && linksState;
}

/**
 * Every "<N> states" count the hub renders — the <h1>/subhead, the "N states
 * hiring" badge, AND the SEO <meta name="description"> that Google shows in the
 * search snippet — must derive from STATES.length, never a hardcoded digit.
 *
 * The 2026-11-22 leak: the visible subhead + badge already used {STATES.length},
 * but the meta description literal said "across 10 states". hubIsDataDriven only
 * proves the VISIBLE LINK LIST is data-driven; it is blind to copy/SEO strings.
 * So the day an 11th state is added, the live page says "11 states" while the
 * Google snippet still says "10 states" — a public claim split on the highest-
 * intent recruiting SERP, exactly the drift this guard family's own failure
 * message warns about ("silently drifts ... when an 11th state is added").
 *
 * Returns the hardcoded offenders (e.g. ["across 10 states"]); [] when clean.
 * A derived count renders as "${STATES.length} states" in source — never a raw
 * digit before "states" — so the rule is: no /\b\d+\s+states\b/ literal. (A
 * legitimate future "50 states"/"all states" nationwide line must still derive
 * or be reworded; forcing derivation is the whole point.)
 */
export function hubCountLiterals(indexSrc) {
  const out = [];
  for (const m of indexSrc.matchAll(/\b\d+\s+states\b/gi)) out.push(m[0]);
  return out;
}

/**
 * RULE E — every hardcoded top-producer earnings figure in the careers copy.
 *
 * The claim is "...producers have written $120K+ in commissions", so a HARDCODED
 * figure always appears as "written $<figure>". A single-sourced copy renders
 * "written ${TOP_PRODUCER_EARNINGS} in commissions" instead — no "$<digit>" after
 * "written" — so the rule is: no /written\s+\$<figure>/ literal in the rendered
 * source. Scanned line-by-line with comment lines skipped, so a changelog comment
 * that quotes the old claim (shipped-data.ts does exactly this) can't trip it, and
 * so the "$10K+" first-year-pace stat tile — which is never preceded by "written"
 * — is never mistaken for the drift-prone figure. Returns the offenders
 * (e.g. ["written $120K+"]); [] when clean.
 */
export function claimFigureLiterals(src) {
  const out = [];
  for (const raw of String(src).split("\n")) {
    const t = raw.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    for (const m of raw.matchAll(/written\s+\$[\d.,]+\s*[KMB]\+?/gi)) out.push(m[0].trim());
  }
  return out;
}

/**
 * True iff StateCareerLanding declares the TOP_PRODUCER_EARNINGS single-source
 * constant. If it's deleted/renamed the five surfaces are no longer single-sourced
 * (and the hub's import would break), so its absence is a failure — the same
 * defensive posture as Rule C's "STATES array must exist".
 */
export function declaresEarningsConstant(landingSrc) {
  return /\bconst\s+TOP_PRODUCER_EARNINGS\s*=/.test(String(landingSrc));
}

/** Collect failures given the source strings. */
export function audit({ appSrc, sitemapXml, indexSrc, landingSrc = "" }) {
  const fail = [];
  if (!declaresCareersHub(appSrc)) {
    fail.push(
      'App.tsx: no <Route path="/careers"> — bare /careers falls through to the "*" catch-all and serves a 200 soft-404 (the NotFound body) on the parent of the Google-for-Jobs state cluster.',
    );
  }
  if (!sitemapAdvertisesHub(sitemapXml)) {
    fail.push(
      "public/sitemap.xml: no <loc> for https://apex-financial.org/careers — the hub exists but no crawler is told, so the state pages stay orphaned from a parent node.",
    );
  }
  if (!hubIsDataDriven(indexSrc)) {
    fail.push(
      "src/pages/CareersIndex.tsx: the hub is not rendered data-driven from STATES (import { STATES } from './StateCareerLanding' + STATES.map + a /careers/${slug} link). A hardcoded list silently drifts from the state pages when an 11th state is added.",
    );
  }
  const countLits = hubCountLiterals(indexSrc);
  if (countLits.length) {
    fail.push(
      `src/pages/CareersIndex.tsx: hardcoded state-count literal(s) [${countLits.join(", ")}] — the count must derive from STATES.length (render as "\${STATES.length} states"), or the SEO meta description / copy drifts from the live page the day an 11th state is added. Google's search snippet would say the old number while the page shows the new one.`,
    );
  }
  // RULE E — the top-producer earnings figure must be single-sourced, not
  // re-literaled into any of the five careers surfaces (hub meta+hero,
  // state page meta+JSON-LD+hero).
  if (!declaresEarningsConstant(landingSrc)) {
    fail.push(
      "src/pages/StateCareerLanding.tsx: the TOP_PRODUCER_EARNINGS single-source constant is missing (deleted/renamed?). The top-producer earnings figure is rendered verbatim across 5 public careers surfaces and must derive from one exported constant, or they drift.",
    );
  }
  const figureLits = [
    ...claimFigureLiterals(indexSrc).map((m) => `CareersIndex.tsx: "${m}"`),
    ...claimFigureLiterals(landingSrc).map((m) => `StateCareerLanding.tsx: "${m}"`),
  ];
  if (figureLits.length) {
    fail.push(
      `hardcoded top-producer earnings figure(s) [${figureLits.join(", ")}] — the figure ships verbatim across 5 public surfaces (both /careers hub meta+hero AND the state page meta+JobPosting JSON-LD+hero). check-landing-marketing-claims.mjs allow-lists it but grades each occurrence alone, so one edited copy passes while the indexed JobPosting + SERP snippet keep the old number; Google de-indexes a JobPosting that contradicts the visible page. Interpolate TOP_PRODUCER_EARNINGS (import { TOP_PRODUCER_EARNINGS } from "./StateCareerLanding") so a change moves all five at once.`,
    );
  }
  return fail;
}

function runRepo() {
  const appSrc = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  const sitemapXml = readFileSync(join(ROOT, "public/sitemap.xml"), "utf8");
  const indexSrc = readFileSync(join(ROOT, "src/pages/CareersIndex.tsx"), "utf8");
  const landingSrc = readFileSync(join(ROOT, "src/pages/StateCareerLanding.tsx"), "utf8");
  const fail = audit({ appSrc, sitemapXml, indexSrc, landingSrc });
  if (fail.length) {
    console.error("FAIL: /careers hub integrity\n  - " + fail.join("\n  - "));
    process.exit(1);
  }
  console.log("OK: /careers hub is a declared route, advertised in sitemap.xml, data-driven over STATES, and single-sources the top-producer earnings figure across all 5 surfaces.");
}

function selftest() {
  const goodApp = '<Route path="/careers" element={<CareersIndex />} />\n<Route path="/careers/:state" element={<StateCareerLanding />} />\n<Route path="*" element={<NotFound />} />';
  const goodMap = '<url><loc>https://apex-financial.org/careers</loc></url><url><loc>https://apex-financial.org/careers/florida</loc></url>';
  const goodIndex = 'import { STATES, TOP_PRODUCER_EARNINGS } from "./StateCareerLanding";\n{STATES.map((s) => (<Link to={`/careers/${s.slug}`}>{s.name}</Link>))}';
  // Clean StateCareerLanding fixture: declares the single-source constant, no
  // re-literaled "written $N" figure. Threaded into every structural case so
  // Rule E contributes 0 and the A–D expected counts stay exact.
  const goodLanding = 'export const TOP_PRODUCER_EARNINGS = "$120K+";\nexport const STATES = [];\nconst d = `written ${TOP_PRODUCER_EARNINGS} in commissions`;';

  const cases = [
    // [label, inputs, expectFailCount]
    ["all good", { appSrc: goodApp, sitemapXml: goodMap, indexSrc: goodIndex, landingSrc: goodLanding }, 0],
    // A: hub route removed — only :state and catch-all remain (the exact pre-fix state)
    ["route missing", { appSrc: '<Route path="/careers/:state" element={<S />} />\n<Route path="*" element={<NotFound />} />', sitemapXml: goodMap, indexSrc: goodIndex, landingSrc: goodLanding }, 1],
    // A: catch-all must not be read as the hub
    ["catch-all is not the hub", { appSrc: '<Route path="/careers/:state" element={<S />} />\n<Route path="*" element={<NotFound />} />', sitemapXml: goodMap, indexSrc: goodIndex, landingSrc: goodLanding }, 1],
    // B: sitemap only lists state leaves, not the hub
    ["hub not advertised", { appSrc: goodApp, sitemapXml: '<url><loc>https://apex-financial.org/careers/florida</loc></url>', indexSrc: goodIndex, landingSrc: goodLanding }, 1],
    // C: hardcoded list, not data-driven
    ["not data-driven", { appSrc: goodApp, sitemapXml: goodMap, indexSrc: '<Link to="/careers/florida">Florida</Link>', landingSrc: goodLanding }, 1],
    // C: imports STATES + maps but links nothing (broken template)
    ["maps but no state link", { appSrc: goodApp, sitemapXml: goodMap, indexSrc: 'import { STATES } from "./StateCareerLanding";\n{STATES.map((s) => (<span>{s.name}</span>))}', landingSrc: goodLanding }, 1],
    // D: a hardcoded state-count literal in the copy/SEO (the 2026-11-22 leak:
    // meta description said "across 10 states" while the page used STATES.length)
    ["hardcoded state count", { appSrc: goodApp, sitemapXml: goodMap, indexSrc: goodIndex + '\nconst desc = "hiring across 10 states.";', landingSrc: goodLanding }, 1],
    // D: the DERIVED count ("${STATES.length} states") must pass clean
    ["derived state count passes", { appSrc: goodApp, sitemapXml: goodMap, indexSrc: goodIndex + '\nconst desc = "hiring across ${STATES.length} states.";', landingSrc: goodLanding }, 0],
    // E: a re-literaled earnings figure in the HUB copy (the drift this wave kills)
    ["hardcoded figure in hub", { appSrc: goodApp, sitemapXml: goodMap, indexSrc: goodIndex + '\n<p>top producers have written $150K+ in commissions</p>', landingSrc: goodLanding }, 1],
    // E: a re-literaled earnings figure in the STATE PAGE copy
    ["hardcoded figure in state page", { appSrc: goodApp, sitemapXml: goodMap, indexSrc: goodIndex, landingSrc: goodLanding + '\nconst x = `written $120K+ in commissions`;' }, 1],
    // E: the interpolated figure ("written ${TOP_PRODUCER_EARNINGS}") must pass clean
    ["interpolated figure passes", { appSrc: goodApp, sitemapXml: goodMap, indexSrc: goodIndex + '\n<p>written {TOP_PRODUCER_EARNINGS} in commissions</p>', landingSrc: goodLanding }, 0],
    // E: the single-source constant missing entirely -> fail
    ["earnings constant missing", { appSrc: goodApp, sitemapXml: goodMap, indexSrc: goodIndex, landingSrc: 'export const STATES = [];' }, 1],
    // all three structural rules broken at once (no count literal present -> 3, not 4).
    // landingSrc is a clean fixture so Rule E adds 0 and this stays 3.
    ["all broken", { appSrc: '<Route path="*" element={<NotFound />} />', sitemapXml: "<urlset></urlset>", indexSrc: "export default function X(){return null;}", landingSrc: goodLanding }, 3],
  ];

  let passed = 0;
  for (const [label, inputs, want] of cases) {
    const got = audit(inputs).length;
    if (got === want) {
      passed++;
    } else {
      console.error(`SELFTEST FAIL [${label}]: expected ${want} failure(s), got ${got}`);
    }
  }
  // Guard against a vacuous harness: the negative cases must actually exercise
  // every rule. Prove the three pure predicates flip on the bad fixtures.
  const invariants = [
    ["declaresCareersHub true", declaresCareersHub(goodApp) === true],
    ["declaresCareersHub false on catch-all only", declaresCareersHub('<Route path="/careers/:state" /><Route path="*" />') === false],
    ["sitemapAdvertisesHub true", sitemapAdvertisesHub(goodMap) === true],
    ["sitemapAdvertisesHub false on leaves only", sitemapAdvertisesHub('<loc>https://apex-financial.org/careers/florida</loc>') === false],
    ["hubIsDataDriven true", hubIsDataDriven(goodIndex) === true],
    ["hubIsDataDriven false on hardcoded", hubIsDataDriven('<Link to="/careers/florida" />') === false],
    ["hubCountLiterals catches a hardcoded '10 states'", hubCountLiterals("hiring across 10 states.").length === 1],
    ["hubCountLiterals clean on derived '${STATES.length} states'", hubCountLiterals("hiring across ${STATES.length} states.").length === 0],
    ["hubCountLiterals clean on no count at all", hubCountLiterals(goodIndex).length === 0],
    // Rule E predicates.
    ["claimFigureLiterals catches 'written $120K+'", claimFigureLiterals("producers have written $120K+ in commissions").length === 1],
    ["claimFigureLiterals catches a decimal 'written $1.2M'", claimFigureLiterals("have written $1.2M in commissions").length === 1],
    ["claimFigureLiterals clean on interpolated figure", claimFigureLiterals("written {TOP_PRODUCER_EARNINGS} in commissions").length === 0],
    ["claimFigureLiterals clean on template interpolation", claimFigureLiterals("written ${TOP_PRODUCER_EARNINGS} in commissions").length === 0],
    ["claimFigureLiterals skips a comment that quotes the dead claim", claimFigureLiterals("// written $120K+ in commissions").length === 0],
    ["claimFigureLiterals ignores the $10K+ pace tile (no 'written')", claimFigureLiterals('value: "$10K+"').length === 0],
    ["declaresEarningsConstant true on the real decl", declaresEarningsConstant('export const TOP_PRODUCER_EARNINGS = "$120K+";') === true],
    ["declaresEarningsConstant false when absent", declaresEarningsConstant("export const STATES = [];") === false],
  ];
  let invOk = 0;
  for (const [label, ok] of invariants) {
    if (ok) invOk++;
    else console.error(`SELFTEST FAIL [invariant: ${label}]`);
  }

  const totalWant = cases.length + invariants.length;
  const totalGot = passed + invOk;
  if (totalGot !== totalWant) {
    console.error(`SELFTEST: ${totalGot}/${totalWant} — FAILED`);
    process.exit(1);
  }
  console.log(`SELFTEST OK: ${totalGot}/${totalWant} (cases both directions + predicate invariants).`);
}

if (process.argv.includes("--selftest")) selftest();
else runRepo();
