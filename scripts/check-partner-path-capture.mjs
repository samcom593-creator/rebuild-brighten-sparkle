#!/usr/bin/env node
/**
 * check-partner-path-capture — the landing hero's partner-path self-selection
 * must be CAPTURED by /apply, not just fired into analytics and dropped.
 *
 * WHY THIS EXISTS (MP-WIB-PARTNER-PATH-CAPTURE, 2026-11-21). The landing hero
 * (src/components/landing/HeroSection.tsx) renders two license choices and
 * sends a recruit to `/apply?...&track=<agency-builder|licensed-producer>` so
 * they SELF-DECLARE which audience they are before they ever touch the form.
 * "agency builder" (wants to scale a downline = override income) is the single
 * highest-value recruit type Sam can land. That self-selection fired only into
 * the client analytics event `hero_partner_path_click` and was then DROPPED the
 * instant the form submitted: `track` was never read in Apply.tsx and never
 * reached the applicant row. licenseStatus cannot recover it — an agency
 * builder and a solo producer are BOTH "licensed".
 *
 * Same emitted-but-never-persisted class as the `motivation` field
 * (check-apply-field-parity, 2026-11-18) and the 2026-05-18 mobile-carrier drop:
 * a signal is collected on the client and discarded before it is written. Every
 * existing guard was blind to it — the form renders, the endpoint runs, the
 * payload was never inspected for this param.
 *
 * THE FIX IT GUARDS. Apply.tsx reads `searchParams.get("track")`, normalizes it
 * to a short slug, and folds it into `attributionJson` (an open jsonb column,
 * submit-application:181,219 — no schema change, no new column) so the
 * per-applicant call-priority view can read `partnerPath`.
 *
 * WHAT IT ASSERTS (static, no browser, no network — gates in verify:core):
 *   IF the hero still emits a `track=` partner-path signal, THEN Apply.tsx must
 *   BOTH read `searchParams.get("track")` AND fold the captured value into the
 *   `attributionJson` carried to submit-application. A hero that emits the
 *   signal while Apply drops it is the regression → exit 1.
 *   The shared public link helper is also an emission path: its imported
 *   call must receive the partner choice, write it into the URL query, and
 *   preserve it on the VSL's rendered Apply link. A broken helper is a drop,
 *   not a removed feature. Missing helper/relay source is a parse failure.
 *
 *   Only removing both the track choices and their emitted signal counts as
 *   FEATURE-REMOVED. Retained choices whose links stop carrying track are a
 *   dropped selection, even if the helper call disappears. If the hero's partnerPaths
 *   structure can no longer be found, the emit-detector is blind → exit 2
 *   (could-not-parse is NEVER laundered into pass — the apply-field-parity rule).
 *
 * `--selftest` proves the pure parser both directions with no fs.
 *
 * Exit: 0 captured (or feature removed) | 1 signal emitted but dropped | 2 could-not-parse.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/strip-comments.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HERO = resolve(REPO, "src/components/landing/HeroSection.tsx");
const APPLY = resolve(REPO, "src/pages/Apply.tsx");
const FLOW = resolve(REPO, "src/lib/publicRecruitingFlow.ts");
const VSL = resolve(REPO, "src/pages/Vsl.tsx");

/**
 * Inspect the hero (comments already stripped). Returns whether the partnerPaths
 * structure is present (our emit-detection anchor) and whether a `track=` signal
 * is emitted from it.
 */
function importsPublicFlow(source) {
  return /import\s*\{[^}]*\bbuildPublicRecruitingHref\b[^}]*\}\s*from\s*["']@\/lib\/publicRecruitingFlow["']/.test(source);
}

export function heroSignal(heroStripped) {
  const hasAnchor = /partnerPaths\s*=/.test(heroStripped);
  const literalEmits = /[?&]?track=\$\{[^}]+\}/.test(heroStripped) || /[?&]track=/.test(heroStripped);
  const hasTrackChoices = /\btrack\s*:\s*["'](?:agency-builder|licensed-producer|licensing-roadmap)["']/.test(heroStripped);
  const callsHelper = /\bbuildPublicRecruitingHref\s*\(/.test(heroStripped);
  // An explicit partnerPaths choice must reach the helper's third argument.
  // An import alone or a call with only the current URL is not self-selection.
  const passesChoice = /\bbuildPublicRecruitingHref\s*\(\s*[^,]+,\s*searchParams\s*,\s*[A-Za-z_$][\w$]*\.track\s*,?\s*\)/.test(heroStripped);
  const helperIntent = hasTrackChoices && callsHelper;
  return {
    hasAnchor,
    hasTrackChoices,
    literalEmits,
    callsHelper,
    emits: literalEmits || hasTrackChoices,
    helperIntent,
    helperImported: importsPublicFlow(heroStripped),
    passesChoice,
    viaVsl: helperIntent && /["']\/vsl["']/.test(heroStripped),
  };
}

export function helperRelay(flowStripped) {
  return {
    hasAnchor: /export\s+function\s+buildPublicRecruitingHref\s*\(/.test(flowStripped),
    reads: /searchParams\.get\(\s*["']track["']\s*\)/.test(flowStripped),
    writes: /params\.set\(\s*["']track["']\s*,\s*track\s*\)/.test(flowStripped),
    serializes: /params\.toString\(\s*\)/.test(flowStripped),
  };
}

export function vslRelay(vslStripped) {
  const source = /const\s*\[\s*searchParams\s*\]\s*=\s*useSearchParams\(/.test(vslStripped);
  const relay = vslStripped.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*buildPublicRecruitingHref\(\s*["']\/apply["']\s*,\s*searchParams\s*,?\s*\)/);
  return importsPublicFlow(vslStripped) && source && Boolean(relay)
    && new RegExp(`to\\s*=\\s*\\{\\s*${relay[1]}\\s*\\}`).test(vslStripped);
}

/**
 * Inspect Apply (comments already stripped). Returns whether it READS the track
 * param and whether it PERSISTS it into the attributionJson payload.
 */
export function applyCapture(applyStripped) {
  const reads = /searchParams\.get\(\s*["']track["']\s*\)/.test(applyStripped);
  // The captured value (partnerPath) must land inside the attributionJson that
  // getTrafficPayload returns. Tolerant to either arrangement:
  //   attributionJson: partnerPath ? { ...x, partnerPath } : x
  //   attributionJson: { ...x, partnerPath }
  const persists = /attributionJson:[\s\S]{0,200}?\bpartnerPath\b/.test(applyStripped);
  return { reads, persists };
}

/**
 * Combine emission, optional helper/VSL relay, and capture. Pure, so selftests use
 * fixtures and no filesystem.
 */
export function evaluate(heroStripped, applyStripped, flowStripped = null, vslStripped = null) {
  const hero = heroSignal(heroStripped);
  if (!hero.hasAnchor) {
    return { code: "parseError", reason: "HeroSection partnerPaths structure not found — emit-detection is blind" };
  }
  if (!hero.emits) return { code: "feature-removed" };
  const missing = [];
  if (hero.hasTrackChoices && !hero.literalEmits && !hero.callsHelper) {
    missing.push("Hero carries each retained partner path's track into its destination link");
  }
  if (hero.helperIntent) {
    if (!hero.helperImported || flowStripped === null) {
      return { code: "parseError", reason: "Partner-path helper usage has no readable canonical import/source" };
    }
    const helper = helperRelay(flowStripped);
    if (!helper.hasAnchor) return { code: "parseError", reason: "Public recruiting helper structure not found" };
    if (!hero.passesChoice) missing.push("Hero passes each partner path's track into the link helper");
    if (!helper.reads) missing.push('Public recruiting helper reads the incoming "track" query');
    if (!helper.writes || !helper.serializes) missing.push('Public recruiting helper writes "track" into its returned query');
    if (hero.viaVsl) {
      if (vslStripped === null) return { code: "parseError", reason: "Hero routes through /vsl but its relay source could not be read" };
      if (!vslRelay(vslStripped)) missing.push("VSL Apply link carries its current query through the public recruiting helper");
    }
  }
  const apply = applyCapture(applyStripped);
  if (!apply.reads) missing.push('Apply reads searchParams.get("track")');
  if (!apply.persists) missing.push("Apply folds partnerPath into attributionJson");
  if (missing.length) return { code: "dropped", missing };
  return { code: "ok" };
}

function selftest() {
  let pass = 0, total = 0;
  const ok = (cond, label) => { total++; if (cond) { pass++; } else { console.error(`  ✗ ${label}`); } };

  const HERO_EMITS = `const partnerPaths = [ { track: "agency-builder" } ];
    const destination = \`\${applyHref}&track=\${path.track}\`;`;
  const HERO_NO_TRACK = `const partnerPaths = [ { label: "Explore Galaxy" } ];
    const destination = applyHref;`;
  const HERO_NO_ANCHOR = `const links = []; const destination = applyHref;`;

  const APPLY_FULL = `const partnerPath = (searchParams.get("track") ?? "").trim();
    return { attributionJson: partnerPath ? { ...attribution.attributionJson, partnerPath } : attribution.attributionJson };`;
  const APPLY_READS_ONLY = `const partnerPath = searchParams.get("track") ?? "";
    return { attributionJson: attribution.attributionJson };`;
  const APPLY_NONE = `return { attributionJson: attribution.attributionJson };`;

  ok(evaluate(HERO_EMITS, APPLY_FULL).code === "ok", "WIRED: hero emits + apply reads + persists -> ok");
  ok(evaluate(HERO_EMITS, APPLY_READS_ONLY).code === "dropped", "DROP: reads but does not persist -> dropped");
  ok(evaluate(HERO_EMITS, APPLY_READS_ONLY).missing.length === 1, "DROP: names exactly the missing persist");
  ok(evaluate(HERO_EMITS, APPLY_NONE).code === "dropped", "DROP: neither read nor persist -> dropped");
  ok(evaluate(HERO_EMITS, APPLY_NONE).missing.length === 2, "DROP: names both missing legs");
  ok(evaluate(HERO_NO_TRACK, APPLY_NONE).code === "feature-removed", "REMOVED: hero has neither track choices nor track links -> pass (noted)");
  ok(evaluate(HERO_NO_ANCHOR, APPLY_FULL).code === "parseError", "BLIND: no partnerPaths anchor -> parseError (never laundered to pass)");

  const HERO_HELPER = `import { buildPublicRecruitingHref } from "@/lib/publicRecruitingFlow";
    const partnerPaths = [{ track: "licensed-producer" }];
    const destination = buildPublicRecruitingHref("/vsl", searchParams, path.track);`;
  const FLOW_FULL = `export function buildPublicRecruitingHref(path, searchParams, selectedTrack) {
    const params = new URLSearchParams();
    const track = selectedTrack ?? searchParams.get("track");
    if (track) params.set("track", track);
    return path + "?" + params.toString();
  }`;
  const VSL_FULL = `import { buildPublicRecruitingHref } from "@/lib/publicRecruitingFlow";
    const [searchParams] = useSearchParams();
    const applyHref = buildPublicRecruitingHref("/apply", searchParams);
    return <Link to={applyHref}>Apply</Link>;`;
  ok(evaluate(HERO_HELPER, APPLY_FULL, FLOW_FULL, VSL_FULL).code === "ok", "HELPER: actual track argument, query write and VSL relay -> ok");
  const HERO_TWO_CHOICES = HERO_HELPER.replace(
    'const partnerPaths = [{ track: "licensed-producer" }];',
    'const partnerPaths = [{ track: "licensed-producer" }, { track: "licensing-roadmap" }];',
  );
  ok(evaluate(HERO_TWO_CHOICES, APPLY_FULL, FLOW_FULL, VSL_FULL).code === "ok", "TWO CHOICES: both home audiences retain the full relay and capture");
  ok(evaluate(HERO_TWO_CHOICES.replace(', path.track', ''), APPLY_FULL, FLOW_FULL, VSL_FULL).code === "dropped", "TWO CHOICES DROP: reducing home to two choices does not waive explicit audience capture");
  const HERO_BARE_VSL = HERO_HELPER.replace('buildPublicRecruitingHref("/vsl", searchParams, path.track)', '"/vsl"');
  const bareVslResult = evaluate(HERO_BARE_VSL, APPLY_FULL, FLOW_FULL, VSL_FULL);
  ok(bareVslResult.code === "dropped", "HERO DROP: retained choices with a bare /vsl link are not FEATURE-REMOVED");
  ok(bareVslResult.missing?.length === 1 && bareVslResult.missing[0].includes("retained partner path"), "HERO DROP: names the missing choice-to-link handoff");
  ok(evaluate(HERO_BARE_VSL.replace('import { buildPublicRecruitingHref } from "@/lib/publicRecruitingFlow";', ''), APPLY_FULL).code === "dropped", "HERO DROP: removing both helper call and import still leaves retained choices to capture");
  ok(evaluate(HERO_HELPER, APPLY_FULL, FLOW_FULL.replace('params.set("track", track)', 'params.set("ref", ref)'), VSL_FULL).code === "dropped", "HELPER DROP: no track setter is not FEATURE-REMOVED");
  ok(evaluate(HERO_HELPER, APPLY_FULL, FLOW_FULL.replace('searchParams.get("track")', 'null'), VSL_FULL).code === "dropped", "HELPER DROP: later hops must read incoming track");
  ok(evaluate(HERO_HELPER, APPLY_FULL, FLOW_FULL.replace('params.toString()', '""'), VSL_FULL).code === "dropped", "HELPER DROP: query must be serialized");
  ok(evaluate(HERO_HELPER.replace(', path.track', ''), APPLY_FULL, FLOW_FULL, VSL_FULL).code === "dropped", "HELPER DROP: hero must pass the selected path track");
  ok(evaluate(HERO_HELPER, APPLY_FULL, FLOW_FULL, VSL_FULL.replace('to={applyHref}', 'to="/apply"')).code === "dropped", "VSL DROP: unused helper result cannot vouch for a bare Apply link");
  ok(evaluate(HERO_HELPER, APPLY_FULL, FLOW_FULL, VSL_FULL.replace('"/apply", searchParams', '"/apply", new URLSearchParams()')).code === "dropped", "VSL DROP: empty query loses the chosen audience");
  ok(evaluate(HERO_HELPER, APPLY_FULL, FLOW_FULL, VSL_FULL.replace('"/apply", searchParams', '"/apply", searchParams, "licensed-producer"')).code === "dropped", "VSL DROP: a fixed track must not overwrite another audience");
  ok(evaluate(HERO_HELPER, APPLY_FULL).code === "parseError", "HELPER BLIND: missing helper source is not feature removal");
  ok(evaluate(HERO_HELPER.replace('import { buildPublicRecruitingHref } from "@/lib/publicRecruitingFlow";', ''), APPLY_FULL, FLOW_FULL, VSL_FULL).code === "parseError", "HELPER BLIND: unknown helper implementation is refused");
  ok(evaluate(HERO_HELPER, APPLY_FULL, FLOW_FULL).code === "parseError", "VSL BLIND: missing relay source is refused");
  ok(evaluate(HERO_HELPER, APPLY_READS_ONLY, FLOW_FULL, VSL_FULL).code === "dropped", "HELPER DROP: Apply persistence remains required");

  console.log(`\ncheck:partner-path-capture --selftest — ${pass}/${total} assertions pass (both directions).`);
  if (pass !== total) { console.error("SELFTEST FAILED — the partner-path-capture parser is wrong."); process.exit(1); }
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

// Run the live check ONLY when invoked directly, never on import — so a unit
// test can import the pure parsers above without the file reading the tree and
// exiting the process out from under it.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  let heroSrc, applySrc, flowSrc = null, vslSrc = null;
  try {
    heroSrc = stripComments(readFileSync(HERO, "utf8"));
    applySrc = stripComments(readFileSync(APPLY, "utf8"));
    if (heroSignal(heroSrc).helperIntent) {
      flowSrc = stripComments(readFileSync(FLOW, "utf8"));
      vslSrc = stripComments(readFileSync(VSL, "utf8"));
    }
  } catch (e) {
    console.error(`check:partner-path-capture — COULD NOT READ a source file: ${e.message}`);
    process.exit(2);
  }
  const res = evaluate(heroSrc, applySrc, flowSrc, vslSrc);
  if (res.code === "parseError") {
    console.error(`check:partner-path-capture — COULD NOT PARSE: ${res.reason}.`);
    console.error("  The hero partner-path structure moved. This guard must be updated to find it");
    console.error("  again — a parser that cannot see the signal source is not a pass.");
    process.exit(2);
  }
  if (res.code === "feature-removed") {
    console.log("check:partner-path-capture — FEATURE-REMOVED: the hero no longer tags ?track= on its");
    console.log("  partner-path CTAs, so there is no self-selection signal to capture. Nothing to drop.");
    process.exit(0);
  }
  if (res.code === "dropped") {
    console.error("check:partner-path-capture — the public recruiting flow DROPS a selected partner path:");
    for (const m of res.missing) {
      console.error(`  🔴 Required: ${m}.`);
    }
    console.error("  The recruit's self-declared audience (agency builder vs solo producer) fires into");
    console.error("  analytics and is then discarded on submit — the motivation-field class. Restore the");
    console.error("  capture in src/pages/Apply.tsx (read track, fold partnerPath into attributionJson).");
    process.exit(1);
  }
  console.log("check:partner-path-capture — OK: hero self-selection survives the public helper/VSL relay when used and");
  console.log("  folded into attributionJson, so it round-trips into the applicant row.");
  process.exit(0);
}
