#!/usr/bin/env node
/**
 * check-gate-detector-copies — MP-416 (2026-10-01)
 *
 * THE DRIFT THIS EXISTS FOR, MEASURED NOT IMAGINED:
 * Two guards ask one question — does this edge function refuse an unproven
 * caller, at a lower source offset than the thing that matters?
 * check-function-contracts.mjs asks it about functions shipping
 * verify_jwt = false; check-credential-minting.mjs asks it about functions that
 * mint and hand back a login credential. MP-415 put the answer in
 * scripts/lib/in-handler-gate.mjs and migrated ONE of them. For 20 hours the
 * other carried its own older copy, and that copy had already drifted: it was
 * missing MAC_VERIFY (youtube-auth's comparison IS a crypto MAC, so it reads as
 * completely ungated) and the positional `json(body, 401)` refusal shape
 * (brand-photo-upload gates correctly and read as ungated). MP-416 migrated it.
 *
 * The drift was in the SAFE direction that time — the older copy was stricter,
 * so it could call correct code ungated but could not acquit an ungated minter.
 * Nothing guarantees the next copy drifts the safe way. The recorded cost of two
 * derivations of one question in this system is curl's `--max-time 90` against
 * fn_agentlink_reap_stuck's 300s threshold: they disagreed long enough to send
 * 36 false pages a day, and the fix was to derive one from the other.
 *
 * WHY A GUARD AND NOT A COMMENT: in-handler-gate.mjs's own header asked for this
 * migration in prose, and the prose sat there for 20 hours while the drift it
 * described stayed live. check-strip-comments-copies exists for the same reason
 * one directory over — 21 copies of stripComments, 19 of them wrong.
 *
 * THIS GRADES NAMES, NEVER A COUNT. MP-356/357: a floor graded on a count is
 * fungible, so a real regression sits red until an unrelated pay-down launders
 * it green. The allowlist may only shrink.
 */
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/strip-comments.mjs";

const MODULE = "scripts/lib/in-handler-gate.mjs";

// The primitives that answer the shared question. A private definition of any of
// these is a second derivation.
const PRIMITIVES = ["boundIdents", "sharedSecretGateAt", "macVerifyGateAt", "refusalFollows", "inHandlerGate"];

// Each entry needs a reason. Removing one is a win; adding one needs a wave.
const ALLOWED = new Map([[MODULE, "the shared implementation itself"]]);

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(mjs|js)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const defRe = (name) => new RegExp(String.raw`(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+${name}\s*\(`);

const offenders = [];
let scanned = 0;
for (const f of walk("scripts")) {
  scanned++;
  const rel = f.split(path.sep).join("/");
  // Comments stripped before matching, or this guard reports its own header
  // forever — the footnote bug this repo has now paid for in at least five
  // separate scripts (MP-277, MP-282, MP-399, MP-414, MP-415).
  const src = stripComments(fs.readFileSync(f, "utf8"));
  const found = PRIMITIVES.filter((n) => defRe(n).test(src));
  if (found.length === 0) continue;
  if (ALLOWED.has(rel)) continue;
  offenders.push(`${rel} defines ${found.join(", ")}`);
}

// The guard's own matcher must be shown capable of seeing a copy, or a regex that
// silently stops matching protects nothing while printing green (MP-414 shipped
// the same self-test after a grep that had quietly stopped matching).
const SELFTEST = "function sharedSecretGateAt(code) { return 0; }";
if (!defRe("sharedSecretGateAt").test(SELFTEST)) {
  console.error("✗ check:gate-detector-copies — the detector cannot see a planted copy. The matcher is broken; fix it before trusting any verdict.");
  process.exit(1);
}

// A scan that matched nothing proves nothing (MP-399: a dead status filter printed
// green for its entire life). The module itself must be found and must define them.
if (!fs.existsSync(MODULE)) {
  console.error(`✗ check:gate-detector-copies — ${MODULE} is missing. Refusing to vouch for a single source that does not exist.`);
  process.exit(1);
}
const modSrc = stripComments(fs.readFileSync(MODULE, "utf8"));
const missing = PRIMITIVES.filter((n) => !defRe(n).test(modSrc));
if (missing.length) {
  console.error(`✗ check:gate-detector-copies — ${MODULE} no longer defines: ${missing.join(", ")}.`);
  console.error("  Either it was renamed (update PRIMITIVES here in the same commit) or the single source has been gutted.");
  process.exit(1);
}
if (scanned < 50) {
  console.error(`✗ check:gate-detector-copies — only ${scanned} script(s) scanned; expected the full scripts/ tree. Refusing to vouch.`);
  process.exit(1);
}

// Both consumers must actually IMPORT it. Without this the guard passes a tree
// where a consumer deleted its copy and inlined the logic under other names —
// green on a repo with no shared source at all.
const CONSUMERS = ["scripts/check-credential-minting.mjs", "scripts/check-function-contracts.mjs"];
const unwired = CONSUMERS.filter((c) => {
  if (!fs.existsSync(c)) return true;
  return !/from\s+["']\.\/lib\/in-handler-gate\.mjs["']/.test(stripComments(fs.readFileSync(c, "utf8")));
});
if (unwired.length) {
  console.error(`✗ check:gate-detector-copies — ${unwired.length} guard(s) ask the in-handler-gate question without importing the shared answer:`);
  for (const u of unwired) console.error(`    ${u}`);
  process.exit(1);
}

if (offenders.length) {
  console.error(`✗ check:gate-detector-copies — ${offenders.length} private copy/copies of the in-handler gate detector:`);
  for (const o of offenders) console.error(`    ${o}`);
  console.error(`\n  Import the shared one instead:  import { inHandlerGate } from "./lib/in-handler-gate.mjs";`);
  console.error(`  A second copy is not wrong on the day it is written — it is wrong on the day one of them`);
  console.error(`  learns a convention the other does not, which is what MP-415/416 found and fixed.`);
  console.error(`  If you need a convention the module lacks, WIDEN THE MODULE and mutation-prove the new`);
  console.error(`  convention load-bearing. Do not fork it.`);
  process.exit(1);
}

console.log(`✓ check:gate-detector-copies — ${scanned} script(s) scanned; ${PRIMITIVES.length} gate primitives have exactly one definition (${MODULE}); ${CONSUMERS.length} consumer(s) import it.`);
