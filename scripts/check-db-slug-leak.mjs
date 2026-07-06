import fs from "node:fs";
import path from "node:path";

// wave-18 (2026-07-06) — raw db-slug leak guard.
//
// Class-of-fix Round 2 sibling to wave-16 (internal-nav-hrefs) and wave-17
// (external-link-noopener). Same disease killed piecemeal in wave-9
// (LicensedInbox `application_contact_log`), wave-11 (AdminProducerTrends
// `al_user_id`), wave-13 (SamTodo `mp222_*`), and wave-14 (AgentProfileDrawer
// raw `agent.status` / `agent.license_status`). Each one was caught by
// hand-audit. This guard would have caught all four at commit time.
//
// The failure pattern: a raw database identifier (column name, table name,
// enum value, task-prompt slug) leaks into user-visible text — an admin
// subtitle, a badge, a toast, a tooltip. To Sam it reads as "why does this
// admin surface say `al_user_id`" and to anyone else as "this product feels
// unfinished." Brand integrity is a commit-time enforceable invariant.
//
// Detection:
//   1. Attribute values inside common user-copy attributes
//      (subtitle | title | label | description | placeholder | aria-label |
//      heading | eyebrow | tooltip | caption) that contain any BANNED_SLUG.
//   2. `toast.error(...)` / `toast.success(...)` / `toast.warning(...)` /
//      `toast.info(...)` calls whose first string arg contains any
//      BANNED_SLUG.
//   3. JSX text nodes of the form `>...\{expr\}...<` where `expr` is a raw
//      `agent.status` or `agent.license_status` reference (i.e. NOT wrapped
//      in a helper like `formatEnumLabel(agent.status, ...)`).
//
// Opt-out: `db-slug-leak-allow:<reason>` marker on the same line or the line
// directly above the hit. Legitimate cases:
//   - Sam-only bot-sql tooltips that need to name the raw column (rare).
//   - Doc/receipt copy that quotes the pattern itself.

const repoRoot = path.resolve(import.meta.dirname, "..");

const TRACKED_DIRS = ["src"];

const EXCLUDE_FILES = new Set([
  // WhatShippedTodayBanner narrates historical fixes in prose that must quote
  // the raw slugs to explain what was fixed.
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
  // The formatter itself owns the enum-slug → label mapping.
  "src/lib/formatEnumLabel.ts",
  // The guard's own doc comments quote the pattern.
  "scripts/check-db-slug-leak.mjs",
]);

const OPT_OUT_MARKER = /db-slug-leak-allow:/;

// Raw db slugs that must never appear in user-facing strings.
const BANNED_SLUGS = [
  "al_user_id",
  "application_contact_log",
  // mp\d+_ prefixed task slugs (e.g. mp222_agentlink_link, mp235_reload_trap).
  // Regex-tested separately so we can allow prose like "MP-222" but block
  // machine slugs.
];

const BANNED_MP_SLUG = /\bmp\d{2,4}_[a-z0-9_]+/;

// JSX attributes whose values render to the user.
const USER_COPY_ATTRS = [
  "subtitle",
  "title",
  "label",
  "description",
  "placeholder",
  "aria-label",
  "heading",
  "eyebrow",
  "tooltip",
  "caption",
  "message",
  "hint",
];

const TEXT_EXTS = new Set([".tsx", ".ts", ".jsx", ".js"]);

function walk(rel) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return TEXT_EXTS.has(path.extname(rel)) ? [rel] : [];
  const out = [];
  for (const entry of fs.readdirSync(abs)) {
    if (entry.startsWith(".")) continue;
    out.push(...walk(path.join(rel, entry)));
  }
  return out;
}

function slugMatches(text) {
  for (const slug of BANNED_SLUGS) {
    if (text.includes(slug)) return slug;
  }
  const m = text.match(BANNED_MP_SLUG);
  if (m) return m[0];
  return null;
}

function extractQuoted(source, startIdx) {
  // Return the string literal starting at startIdx (which points at the
  // opening quote or `{`). Handles "..." '...' `...` and {"..."}.
  const ch = source[startIdx];
  if (ch === '"' || ch === "'" || ch === "`") {
    const end = source.indexOf(ch, startIdx + 1);
    if (end === -1) return null;
    return source.slice(startIdx + 1, end);
  }
  if (ch === "{") {
    // {"..."} or {'...'} or {`...`}
    let i = startIdx + 1;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const q = source[i];
      const end = source.indexOf(q, i + 1);
      if (end === -1) return null;
      return source.slice(i + 1, end);
    }
  }
  return null;
}

const violations = [];

for (const rel of TRACKED_DIRS.flatMap(walk)) {
  if (EXCLUDE_FILES.has(rel)) continue;
  const source = fs.readFileSync(path.join(repoRoot, rel), "utf8");
  const lines = source.split("\n");

  // --- Rule 1: user-copy attributes with banned slugs ---
  const attrRe = new RegExp(
    `\\b(${USER_COPY_ATTRS.join("|")})\\s*=\\s*["'\\{]`,
    "g"
  );
  let m;
  while ((m = attrRe.exec(source)) !== null) {
    const startIdx = m.index + m[0].length - 1;
    const value = extractQuoted(source, startIdx);
    if (!value) continue;
    const hit = slugMatches(value);
    if (!hit) continue;
    // Locate the line for a readable receipt + opt-out check.
    const before = source.slice(0, m.index);
    const lineNo = before.split("\n").length;
    const thisLine = lines[lineNo - 1] || "";
    const prevLine = lines[lineNo - 2] || "";
    if (OPT_OUT_MARKER.test(thisLine) || OPT_OUT_MARKER.test(prevLine)) continue;
    violations.push({
      file: rel,
      line: lineNo,
      kind: "user-copy attribute",
      attr: m[1],
      slug: hit,
      preview: thisLine.trim().slice(0, 140),
    });
  }

  // --- Rule 2: toast.* calls with banned slugs ---
  const toastRe = /\btoast\.(error|success|warning|info)\s*\(/g;
  while ((m = toastRe.exec(source)) !== null) {
    // Grab up to the matching `)` — cheap balance-count, good enough for
    // single-line toasts (the common case).
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
      if (depth === 0) break;
      i++;
    }
    const body = source.slice(m.index + m[0].length, i);
    const hit = slugMatches(body);
    if (!hit) continue;
    const before = source.slice(0, m.index);
    const lineNo = before.split("\n").length;
    const thisLine = lines[lineNo - 1] || "";
    const prevLine = lines[lineNo - 2] || "";
    if (OPT_OUT_MARKER.test(thisLine) || OPT_OUT_MARKER.test(prevLine)) continue;
    violations.push({
      file: rel,
      line: lineNo,
      kind: `toast.${m[1]}`,
      slug: hit,
      preview: thisLine.trim().slice(0, 140),
    });
  }

  // --- Rule 3: raw {agent.status} / {agent.license_status} JSX expressions ---
  // Only inside JSX (heuristic: line is inside a return / has JSX tags around).
  const rawEnumRe = /\{\s*agent\.(status|license_status)\s*\}/g;
  while ((m = rawEnumRe.exec(source)) !== null) {
    const before = source.slice(0, m.index);
    const lineNo = before.split("\n").length;
    const thisLine = lines[lineNo - 1] || "";
    const prevLine = lines[lineNo - 2] || "";
    if (OPT_OUT_MARKER.test(thisLine) || OPT_OUT_MARKER.test(prevLine)) continue;
    // Skip if the line is clearly a comparison / assignment (agent.status ===
    // "active", const s = agent.status). The `{agent.status}` shape with
    // braces on both sides basically only occurs in JSX rendering.
    violations.push({
      file: rel,
      line: lineNo,
      kind: "raw agent.enum in JSX",
      slug: `agent.${m[1]}`,
      preview: thisLine.trim().slice(0, 140),
    });
  }
}

const files = TRACKED_DIRS.flatMap(walk).length;

if (violations.length > 0) {
  console.error(
    `check:db-slug-leak FAIL — ${violations.length} raw-db-slug leak(s) in ${files} scanned files.`
  );
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.kind}]  slug="${v.slug}"`);
    console.error(`    ${v.preview}`);
  }
  console.error("");
  console.error(
    "Fix: route enum values through formatEnumLabel (src/lib/formatEnumLabel.ts),"
  );
  console.error(
    "     rename raw table/column slugs in user copy to human labels,"
  );
  console.error(
    "     or add `// db-slug-leak-allow:<reason>` above the line if legitimately admin-only bot-sql."
  );
  process.exit(1);
}

console.log(`check:db-slug-leak OK — ${files} files scanned, 0 raw-db-slug leaks.`);
