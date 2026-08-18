#!/usr/bin/env node
/**
 * Icon-only buttons must have an accessible name (WCAG 2.2 AA, 4.1.2).
 *
 * A <Button size="icon"> renders a glyph and no text. Without an accessible name
 * a screen reader announces only "button", so the control is unusable — and
 * directive section 26 makes accessibility failures on critical workflows
 * blocking. Measured 2026-08-17: 105 icon-only controls, 47 with no name.
 *
 * A NAME IS NOT A TOOLTIP. Several of these sat inside Radix <Tooltip>, which
 * sets aria-describedby — a *description*, not the accessible NAME. The button
 * still announced nothing. A visible tooltip is not an accessible name.
 *
 * ACCEPTED AS A NAME: aria-label, aria-labelledby, title, or an <span class=
 * "sr-only"> child.
 *
 * THE BUG THIS DETECTOR ALREADY MADE, kept as a regression note: the first
 * version scanned only the element's OPENING TAG for sr-only. Buttons label
 * themselves with an sr-only span in the BODY (shadcn's SidebarTrigger does
 * exactly that), so it reported an already-accessible control as a violation and
 * a redundant aria-label was added on top of it. Scanning only the opening tag
 * answers "is the name in the attributes", not "does this control have a name".
 * The body is scanned too, and the count fell 48 -> 47.
 *
 * Scope is git-tracked files: other workers' untracked scratch files must not
 * block this repo's commits.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BASELINE = 0;
const NAME_IN_TAG = /aria-label=|aria-labelledby=|title=/;
const NAME_IN_BODY = /sr-only/;

const files = execFileSync("git", ["ls-files", "-z", "--", "src/"], {
  cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
}).split("\0").filter((f) => /\.tsx$/.test(f));

const violations = [];
for (const rel of files) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue;
  const s = readFileSync(abs, "utf8");
  let i = 0;
  while ((i = s.indexOf('size="icon"', i)) !== -1) {
    const a = s.lastIndexOf("<", i);
    let depth = 0, end = -1;
    for (let k = a; k < s.length; k++) {
      const c = s[k];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && k > i) { end = k; break; }
    }
    if (end === -1) { i += 11; continue; }
    const openTag = s.slice(a, end + 1);
    const close = s.indexOf("</Button>", end);
    const body = close === -1 ? "" : s.slice(end + 1, close);
    if (!NAME_IN_TAG.test(openTag) && !NAME_IN_BODY.test(body)) {
      violations.push(`${rel}:${s.slice(0, a).split("\n").length}`);
    }
    i = end;
  }
}

const label = "[check-icon-button-labels]";
if (violations.length > BASELINE) {
  console.error(`${label} FAIL — ${violations.length} icon-only button(s) with no accessible name (baseline ${BASELINE}).`);
  console.error(`${label} Add aria-label="<action>" — describe the ACTION, not the glyph. A tooltip is not a name.`);
  for (const v of violations.slice(0, 20)) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`${label} OK — every icon-only button has an accessible name (${violations.length} violations, baseline ${BASELINE}).`);
