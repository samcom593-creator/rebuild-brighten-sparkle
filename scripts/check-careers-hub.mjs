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

/** Collect failures given the three source strings. */
export function audit({ appSrc, sitemapXml, indexSrc }) {
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
  return fail;
}

function runRepo() {
  const appSrc = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  const sitemapXml = readFileSync(join(ROOT, "public/sitemap.xml"), "utf8");
  const indexSrc = readFileSync(join(ROOT, "src/pages/CareersIndex.tsx"), "utf8");
  const fail = audit({ appSrc, sitemapXml, indexSrc });
  if (fail.length) {
    console.error("FAIL: /careers hub integrity\n  - " + fail.join("\n  - "));
    process.exit(1);
  }
  console.log("OK: /careers hub is a declared route, advertised in sitemap.xml, and data-driven over STATES.");
}

function selftest() {
  const goodApp = '<Route path="/careers" element={<CareersIndex />} />\n<Route path="/careers/:state" element={<StateCareerLanding />} />\n<Route path="*" element={<NotFound />} />';
  const goodMap = '<url><loc>https://apex-financial.org/careers</loc></url><url><loc>https://apex-financial.org/careers/florida</loc></url>';
  const goodIndex = 'import { STATES } from "./StateCareerLanding";\n{STATES.map((s) => (<Link to={`/careers/${s.slug}`}>{s.name}</Link>))}';

  const cases = [
    // [label, inputs, expectFailCount]
    ["all good", { appSrc: goodApp, sitemapXml: goodMap, indexSrc: goodIndex }, 0],
    // A: hub route removed — only :state and catch-all remain (the exact pre-fix state)
    ["route missing", { appSrc: '<Route path="/careers/:state" element={<S />} />\n<Route path="*" element={<NotFound />} />', sitemapXml: goodMap, indexSrc: goodIndex }, 1],
    // A: catch-all must not be read as the hub
    ["catch-all is not the hub", { appSrc: '<Route path="/careers/:state" element={<S />} />\n<Route path="*" element={<NotFound />} />', sitemapXml: goodMap, indexSrc: goodIndex }, 1],
    // B: sitemap only lists state leaves, not the hub
    ["hub not advertised", { appSrc: goodApp, sitemapXml: '<url><loc>https://apex-financial.org/careers/florida</loc></url>', indexSrc: goodIndex }, 1],
    // C: hardcoded list, not data-driven
    ["not data-driven", { appSrc: goodApp, sitemapXml: goodMap, indexSrc: '<Link to="/careers/florida">Florida</Link>' }, 1],
    // C: imports STATES + maps but links nothing (broken template)
    ["maps but no state link", { appSrc: goodApp, sitemapXml: goodMap, indexSrc: 'import { STATES } from "./StateCareerLanding";\n{STATES.map((s) => (<span>{s.name}</span>))}' }, 1],
    // all three broken at once
    ["all broken", { appSrc: '<Route path="*" element={<NotFound />} />', sitemapXml: "<urlset></urlset>", indexSrc: "export default function X(){return null;}" }, 3],
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
