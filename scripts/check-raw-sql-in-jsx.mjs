import fs from "node:fs";
import path from "node:path";

// wave-25 (2026-07-07) — raw-SQL-in-JSX guard.
//
// Class-of-fix Round 8 sibling to wave-16 (internal-nav-hrefs), wave-17
// (external-link-noopener), wave-18 (raw-db-slug-leak), wave-19
// (console-in-prod), wave-20 (raw-db-slug-leak tightened), wave-21
// (empty-catch-swallow), wave-22 (debugger-statement), wave-23
// (blocking-modal), wave-24 (empty-catch full pay-down).
//
// The failure pattern: an admin instruction, tooltip, or error message
// ships literal SQL keywords ("SELECT chat_id FROM telegram_messages...",
// "UPDATE agents SET status = 'active'") rendered directly in JSX. Two
// reasons this leaks value:
//   1. AI-tell / brand-drift: raw SQL in the UI screams "generated
//      admin console" and violates Brand Bible Ch 9 (no purposeless UI
//      detail). Admin surfaces should describe the ACTION Sam takes, not
//      the query the app runs behind it.
//   2. Schema surface leak: renders internal column/table names to any
//      user who screenshots the page. `agents`, `telegram_messages`,
//      `commission_ledger` are private schema knowledge that shouldn't
//      exit the DB layer via a `<code>` block.
//
// Lock-at-zero ratchet: sweep src/**/*.{tsx,jsx} for lines where a SQL
// keyword appears inside a JSX text node, `<code>` / `<pre>` inline block,
// or JSX string attribute. There's no baseline — one confirmed live
// site (TelegramBot.tsx:834) gets the opt-out marker in the wave-25
// pay-down commit; every future occurrence must justify itself.
//
// Detection:
//   Fails on any line that contains an uppercase SQL keyword
//   (SELECT / INSERT INTO / DELETE FROM / UPDATE <ident> SET) AND is
//   preceded on the same line by either:
//     - A JSX text opener: `>` (closing bracket of a JSX opening tag)
//     - An inline-code opener: `<code>` / `<pre>` / `<kbd>` / `<samp>`
//     - A JSX string attribute opener: `title="..."`, `placeholder="..."`,
//       `content="..."`, `description="..."`, `tooltip="..."`,
//       `aria-label="..."`, `label="..."`, `value="..."` (single or double quote)
//
// Not flagged:
//   - `.ts` files (edge functions, migrations, RPCs — SQL is legitimate there).
//   - JavaScript comments (`//`, `/*`, ` *`, `#` in shebang/env-style headers).
//   - Filenames like `foo.sql`, `SELECT.md` (guard requires the keyword be
//     followed by ` ` and preceded by a JSX-context marker, not just anywhere).
//   - Lowercase / mixed-case English (`select`, `Select the item`) — we
//     require the uppercase keyword form that PostgreSQL/Supabase examples
//     always use.
//   - `<code>` blocks NOT containing SQL (`<code>foo</code>`, `<code>~/.zshrc</code>`).
//
// Opt-out marker per line: `raw-sql-in-jsx-allow:<reason>` on the same
// line or the line directly above. Reason string must be non-empty.

const repoRoot = path.resolve(import.meta.dirname, "..");

const TRACKED_DIRS = ["src"];

const EXCLUDE_FILES = new Set([
  // WhatShippedTodayBanner narrates historical fixes and would false-positive
  // if we ever quote the pattern verbatim in a shipped-log entry.
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
]);

const EXCLUDE_PATTERNS = [
  /\.test\.(tsx?|jsx?)$/,
  /\.spec\.(tsx?|jsx?)$/,
  /__tests__\//,
];

const OPT_OUT_MARKER = /raw-sql-in-jsx-allow:([a-z0-9][a-z0-9-]*)/i;

// SQL keyword forms that PostgreSQL / Supabase admin examples always use
// in uppercase. Lowercase forms (`select`, `update the`) are ignored to
// avoid false-positives on English prose.
//
// UPDATE requires a following identifier + " SET" to distinguish from
// English "update the roster" prose.
const SQL_KEYWORD_RE = /(SELECT |INSERT INTO |DELETE FROM |UPDATE [A-Za-z_][A-Za-z0-9_.]* SET )/;

// JSX-context markers that must appear on the same line BEFORE the SQL
// keyword. Any one of these being present on the line before the SQL
// keyword substring means we're in JSX rendering territory.
const JSX_TEXT_OPENER_RE = />/;
const JSX_INLINE_CODE_RE = /<(code|pre|kbd|samp)\b/i;
const JSX_STRING_ATTR_RE = /(title|content|description|tooltip|placeholder|aria-label|label|value)\s*=\s*["'`]/i;

const TEXT_EXTS = new Set([".tsx", ".jsx"]);

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

function isExcluded(rel) {
  if (EXCLUDE_FILES.has(rel)) return true;
  return EXCLUDE_PATTERNS.some((re) => re.test(rel));
}

function isCommentLine(line) {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("#")
  );
}

function checkFile(rel) {
  const abs = path.join(repoRoot, rel);
  const text = fs.readFileSync(abs, "utf8");
  const lines = text.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isCommentLine(line)) continue;

    const sqlMatch = line.match(SQL_KEYWORD_RE);
    if (!sqlMatch) continue;

    const sqlIdx = sqlMatch.index;
    const prefix = line.slice(0, sqlIdx);

    // Must be preceded (on the same line, before the SQL keyword) by a
    // JSX-context marker: a `>`, an inline-code tag, or a string attribute.
    const inJsxText = JSX_TEXT_OPENER_RE.test(prefix);
    const inInlineCode = JSX_INLINE_CODE_RE.test(prefix);
    const inStringAttr = JSX_STRING_ATTR_RE.test(prefix);

    if (!inJsxText && !inInlineCode && !inStringAttr) continue;

    // Opt-out marker on same line or line directly above.
    const sameLineOpt = line.match(OPT_OUT_MARKER);
    if (sameLineOpt && sameLineOpt[1] && sameLineOpt[1].length > 0) continue;
    if (i > 0) {
      const above = lines[i - 1].match(OPT_OUT_MARKER);
      if (above && above[1] && above[1].length > 0) continue;
    }

    violations.push({ line: i + 1, text: line.trim().slice(0, 220), keyword: sqlMatch[1].trim() });
  }

  return violations;
}

let totalFiles = 0;
let totalViolations = 0;
const allViolations = [];

for (const dir of TRACKED_DIRS) {
  for (const rel of walk(dir)) {
    if (isExcluded(rel)) continue;
    totalFiles++;
    const v = checkFile(rel);
    if (v.length > 0) {
      totalViolations += v.length;
      allViolations.push({ rel, v });
    }
  }
}

if (totalViolations > 0) {
  console.error(
    `[check:raw-sql-in-jsx] FAIL — ${totalViolations} raw SQL keyword(s) rendered in JSX across ${allViolations.length} file(s):`
  );
  for (const { rel, v } of allViolations) {
    for (const { line, text, keyword } of v) {
      console.error(`  ${rel}:${line}  [${keyword}]  ${text}`);
    }
  }
  console.error("");
  console.error(
    "Fix: replace the SQL text with a plain-English description of the action, or hide the query behind a copy-to-clipboard button.",
  );
  console.error(
    "For legitimate admin runbook instructions, add `raw-sql-in-jsx-allow:<reason>`",
  );
  console.error(
    "as a comment on the same line or the line directly above (reason must be non-empty kebab-case).",
  );
  process.exit(1);
}

console.log(
  `[check:raw-sql-in-jsx] OK — ${totalFiles} files scanned, 0 raw SQL renders in JSX.`,
);
