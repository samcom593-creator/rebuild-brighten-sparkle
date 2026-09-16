#!/usr/bin/env node
// check:control-labels (a11y wave 1b, 2026-09-15)
//
// The live axe scan found that the biggest single accessibility defect on the app
// was one shape the existing icon-button guard cannot see: Radix <SelectTrigger>
// and <Switch> rendered with no accessible name. A screen reader announces them as
// "combobox" / "switch" with nothing else, and the team-hierarchy table alone had
// 500+ of them. This ratchet counts those two tags in src/** whose own attributes
// carry none of: aria-label, aria-labelledby, or an id (the caller pairs it with a
// <Label htmlFor>). It reads the baseline from scripts/data/control-labels-baseline.json
// and fails when the count rises; lowering it is the way to pay it down. Comments and
// string bodies are stripped before matching (MP-277: a scanner that counts its own
// footnotes stops measuring), and the count is by opening tag, so a tag split across
// lines is still one site.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const BASELINE_FILE = "scripts/data/control-labels-baseline.json";
const TAGS = ["SelectTrigger", "Switch"];

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== "tests" && name !== "__tests__") walk(p, out); }
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
};
// Strip /* */ and // comments and the bodies of template/string literals so a tag name
// inside prose or a placeholder cannot count. Attribute VALUES are kept because we need
// aria-label="..." to survive; only string bodies outside JSX attributes are blanked.
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1")
  .replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``");

let total = 0; const perFile = [];
for (const file of walk(ROOT)) {
  const src = strip(readFileSync(file, "utf8"));
  let n = 0;
  for (const tag of TAGS) {
    const re = new RegExp(`<${tag}\\b([^>]*?)(/?)>`, "g");
    let m;
    while ((m = re.exec(src))) {
      const attrs = m[1];
      if (/\baria-label(?:ledby)?\s*=/.test(attrs) || /\bid\s*=/.test(attrs) || /\btitle\s*=/.test(attrs)) continue;
      // An attribute spread ({...props}) may carry the name at the call site; that is the primitive definition, not a use.
      if (/\{\.\.\./.test(attrs) && file.startsWith("src/components/ui/")) continue;
      n++;
    }
  }
  if (n) { perFile.push([file, n]); total += n; }
}

if (!existsSync(BASELINE_FILE)) {
  console.error(`✗ check:control-labels — no baseline at ${BASELINE_FILE}. Current count is ${total}; write {"unnamed":${total}} there deliberately, never let a guard seed itself.`);
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8")).unnamed;
const top = perFile.sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, n]) => `    ${String(n).padStart(3)}  ${f}`).join("\n");
if (total > baseline) {
  console.error(`✗ check:control-labels — ${total} unnamed <SelectTrigger>/<Switch> site(s), baseline ${baseline} (+${total - baseline}). Give the new one aria-label, aria-labelledby, or an id paired with <Label htmlFor>.\n${top}`);
  process.exit(1);
}
console.log(`✓ check:control-labels — ${total} unnamed <SelectTrigger>/<Switch> site(s) (baseline ${baseline}${total < baseline ? `, lower the baseline to ${total}` : ""})`);
if (total < baseline) { console.log(top); }
