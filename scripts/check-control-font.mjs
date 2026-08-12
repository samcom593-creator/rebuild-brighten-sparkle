#!/usr/bin/env node
/**
 * check:control-font — the display face (Syne) must not be forced onto controls.
 *
 * src/index.css carried three global rules that set font-family: 'Syne' on
 * `button, [role="button"]`, and on `button, .btn, nav a, .badge, label`, and
 * Syne at weight 700 on every button. Syne is a DISPLAY type; applied to every
 * control it made the whole app read like a page of marketing headlines rather
 * than a financial operations tool, and it overrode each primitive's own
 * font-medium/font-semibold. Removed 2026-08-12.
 *
 * This guard fails if any selector list that targets a CONTROL (button, [role=
 * button], .btn, nav a, .badge, label) is given the display font again. Headings
 * (h1..h6) and the explicit .font-display opt-in are exactly where Syne belongs,
 * so a rule that only names those is fine.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const css = fs.readFileSync(path.join(repoRoot, "src/index.css"), "utf8");

// Match "<selectors> { ... font-family: ... Syne ... }" blocks.
const CONTROL = /(^|,|\s)(button|\[role="button"\]|\.btn|nav\s+a|\.badge|label)(\s|,|\{|$)/;
const violations = [];

const ruleRx = /([^{}]+)\{([^{}]*)\}/g;
for (const m of css.matchAll(ruleRx)) {
  const selector = m[1].trim();
  const body = m[2];
  if (!/font-family[^;]*Syne/i.test(body)) continue;   // rule doesn't set the display face
  if (!CONTROL.test(selector)) continue;                // rule doesn't target a control
  violations.push(selector.replace(/\s+/g, " ").slice(0, 90));
}

if (violations.length) {
  console.error(
    `\n✗ check:control-font — ${violations.length} rule(s) force the display face onto controls.\n`,
  );
  console.error(
    "Syne is a display type. Controls (button/badge/label/nav link) inherit DM Sans;",
  );
  console.error("reserve Syne for h1..h6 and the explicit .font-display opt-in.\n");
  for (const v of violations) console.error(`  ${v} { … font-family: … Syne … }`);
  console.error("");
  process.exit(1);
}

console.log("✓ check:control-font — the display face is reserved for headings, not controls.");
