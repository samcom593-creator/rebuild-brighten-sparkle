#!/usr/bin/env node
// check:disclosure-button-labels (a11y, MP-WIB-DISCLOSURE 2026-11-16)
//
// A <Button aria-expanded={…}> is a DISCLOSURE TRIGGER — it opens/closes a panel,
// menu, or section. A screen reader announces "button, collapsed/expanded" and
// then needs the NAME to say WHAT it opens. An icon-only disclosure toggle (a lone
// chevron, no text, no aria-label) announces only "button collapsed" — WCAG 4.1.2
// button-name, critical.
//
// This is the exact shape the two existing a11y guards cannot see:
//   * check:icon-button-labels keys on size="icon"; a ghost size="sm" chevron
//     toggle is icon-only but not size="icon", so it slips through.
//   * check:control-labels counts only <SelectTrigger>/<Switch>.
// The live axe scan found one on /dashboard/book-of-business (BookAuditPanel's
// expand/collapse chevron, open-by-default so axe caught it) — but the weekly
// runtime scan only visits 23 routes and pages only on a big regression, so an
// icon-only disclosure toggle on any OTHER route regresses unseen until a human
// happens to run axe there. This guard catches the class at COMMIT time, on every
// route, before deploy.
//
// A disclosure Button is NAMED when ANY of these is true:
//   (a) its opening tag carries aria-label / aria-labelledby / title,
//   (b) its body contains an <… className="sr-only"> (visually-hidden label),
//   (c) its body contains a quoted or template string with a letter
//       (e.g. "Hide deals", `Show all ${n} states`) — rendered text,
//   (d) its body has bare JSX text (letters left after removing child tags and
//       {…} expressions) — e.g. "How it works <ChevronDown/>".
// Everything else — a body that is only an icon or a ternary of icons — is UNNAMED.
//
// Baseline is ZERO: the one live violation is fixed in the same commit, and all
// other current <Button aria-expanded> sites carry text or a label. A new icon-only
// toggle fails the build. Comments/string-literal bodies are stripped via the
// shared lexer (MP-474: a guard must never define its own stripComments).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = "src";

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== "tests" && name !== "__tests__") walk(p, out); }
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
};

// Walk <Button … > opening tags brace-aware (an attribute value may hold {…} with
// its own >), return [openTagText, indexAfterOpenTag].
function openTag(src, at) {
  let depth = 0;
  for (let k = at; k < src.length; k++) {
    const c = src[k];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0 && k > at) return [src.slice(at, k + 1), k + 1];
  }
  return [null, -1];
}

// Body from after the opening tag to the matching </Button>, tracking nested
// <Button>…</Button> so an inner button does not end the outer one early.
function bodyOf(src, from) {
  let depth = 1, i = from;
  while (i < src.length) {
    const open = src.indexOf("<Button", i);
    const close = src.indexOf("</Button>", i);
    if (close === -1) return src.slice(from);
    if (open !== -1 && open < close) { depth++; i = open + 7; continue; }
    depth--;
    if (depth === 0) return src.slice(from, close);
    i = close + 9;
  }
  return src.slice(from);
}

const hasLetter = (s) => /[A-Za-z]{2,}/.test(s);

// (c) any quoted / template string with a letter
function hasStringLabel(body) {
  const re = /"([^"]*)"|'([^']*)'|`([^`]*)`/g;
  let m;
  while ((m = re.exec(body))) {
    const v = m[1] ?? m[2] ?? m[3] ?? "";
    if (hasLetter(v)) return true;
  }
  return false;
}

// (d) bare JSX text: remove child tags <…> and {…} expressions, keep what is left
function hasBareText(body) {
  const noTags = body.replace(/<[^>]*>/g, " ");
  const noBraces = noTags.replace(/\{[^{}]*\}/g, " ").replace(/\{[\s\S]*?\}/g, " ");
  return hasLetter(noBraces);
}

const NAME_IN_TAG = /aria-label\s*=|aria-labelledby\s*=|title\s*=/;

const violations = [];
for (const file of walk(ROOT)) {
  const src = stripComments(readFileSync(file, "utf8"));
  let i = 0;
  while ((i = src.indexOf("<Button", i)) !== -1) {
    // guard against <ButtonFoo>: require a word boundary
    if (/[A-Za-z0-9]/.test(src[i + 7] ?? "")) { i += 7; continue; }
    const [tag, after] = openTag(src, i);
    if (!tag) { i += 7; continue; }
    if (!/\baria-expanded\b/.test(tag)) { i = after; continue; }
    const body = bodyOf(src, after);
    const named =
      NAME_IN_TAG.test(tag) ||
      /sr-only/.test(body) ||
      hasStringLabel(body) ||
      hasBareText(body);
    if (!named) {
      violations.push(`${file}:${src.slice(0, i).split("\n").length}`);
    }
    i = after;
  }
}

const label = "[check-disclosure-button-labels]";
if (violations.length > 0) {
  console.error(`${label} FAIL — ${violations.length} icon-only disclosure <Button aria-expanded> with no accessible name (WCAG 4.1.2, baseline 0):`);
  for (const v of violations) console.error(`    ${v}`);
  console.error(`${label} Add aria-label="<action>" (describe what it opens, not the glyph), or give the body visible text / an sr-only label.`);
  process.exit(1);
}
console.log(`${label} OK — every <Button aria-expanded> disclosure toggle has an accessible name.`);
