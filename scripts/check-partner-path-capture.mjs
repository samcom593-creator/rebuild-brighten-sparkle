#!/usr/bin/env node
/**
 * check-partner-path-capture — the landing hero's partner-path self-selection
 * must be CAPTURED by /apply, not just fired into analytics and dropped.
 *
 * WHY THIS EXISTS (MP-WIB-PARTNER-PATH-CAPTURE, 2026-11-21). The landing hero
 * (src/components/landing/HeroSection.tsx) renders three partner-path cards and
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
 *
 *   If the hero no longer tags `track=` at all (the product removed partner
 *   paths), there is nothing to capture → pass, printed as FEATURE-REMOVED so
 *   the state is visible rather than a silent green. If the hero's partnerPaths
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

/**
 * Inspect the hero (comments already stripped). Returns whether the partnerPaths
 * structure is present (our emit-detection anchor) and whether a `track=` signal
 * is emitted from it.
 */
export function heroSignal(heroStripped) {
  const hasAnchor = /partnerPaths\s*=/.test(heroStripped);
  // The hero builds `...&track=${path.track}` (or a literal track= param).
  const emits = /[?&]?track=\$\{[^}]+\}/.test(heroStripped) || /[?&]track=/.test(heroStripped);
  return { hasAnchor, emits };
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
 * Combine the two sides into a verdict. Pure, so the selftest drives it with
 * fixtures and no filesystem.
 */
export function evaluate(heroStripped, applyStripped) {
  const hero = heroSignal(heroStripped);
  if (!hero.hasAnchor) {
    return { code: "parseError", reason: "HeroSection partnerPaths structure not found — emit-detection is blind" };
  }
  if (!hero.emits) {
    return { code: "feature-removed" };
  }
  const apply = applyCapture(applyStripped);
  const missing = [];
  if (!apply.reads) missing.push('reads searchParams.get("track")');
  if (!apply.persists) missing.push("folds partnerPath into attributionJson");
  if (missing.length) return { code: "dropped", missing };
  return { code: "ok" };
}

function selftest() {
  let pass = 0, total = 0;
  const ok = (cond, label) => { total++; if (cond) { pass++; } else { console.error(`  ✗ ${label}`); } };

  const HERO_EMITS = `const partnerPaths = [ { track: "agency-builder" } ];
    const destination = \`\${applyHref}&track=\${path.track}\`;`;
  const HERO_NO_TRACK = `const partnerPaths = [ { track: "agency-builder" } ];
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
  ok(evaluate(HERO_NO_TRACK, APPLY_NONE).code === "feature-removed", "REMOVED: hero no longer tags track -> pass (noted)");
  ok(evaluate(HERO_NO_ANCHOR, APPLY_FULL).code === "parseError", "BLIND: no partnerPaths anchor -> parseError (never laundered to pass)");

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
  let heroSrc, applySrc;
  try {
    heroSrc = stripComments(readFileSync(HERO, "utf8"));
    applySrc = stripComments(readFileSync(APPLY, "utf8"));
  } catch (e) {
    console.error(`check:partner-path-capture — COULD NOT READ a source file: ${e.message}`);
    process.exit(2);
  }
  const res = evaluate(heroSrc, applySrc);
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
    console.error("check:partner-path-capture — the hero emits a ?track= partner-path signal that /apply DROPS:");
    for (const m of res.missing) {
      console.error(`  🔴 Apply.tsx no longer ${m}.`);
    }
    console.error("  The recruit's self-declared audience (agency builder vs solo producer) fires into");
    console.error("  analytics and is then discarded on submit — the motivation-field class. Restore the");
    console.error("  capture in src/pages/Apply.tsx (read track, fold partnerPath into attributionJson).");
    process.exit(1);
  }
  console.log("check:partner-path-capture — OK: the hero's ?track= self-selection is read by /apply and");
  console.log("  folded into attributionJson, so it round-trips into the applicant row.");
  process.exit(0);
}
