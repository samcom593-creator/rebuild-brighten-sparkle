import fs from "node:fs";
import path from "node:path";

// wave-28 (2026-07-08) — stale-key-in-list ratchet.
//
// Class-of-fix Round 11. Companion to wave-16 (internal-nav), wave-17
// (tabnabbing), wave-18/20 (raw-db-slug), wave-19 (console-in-prod),
// wave-21/24 (empty-catch), wave-22 (debugger), wave-23 (blocking-modal),
// wave-25 (raw-SQL-in-JSX), wave-26 (@ts-ignore), wave-27 (hex-in-JSX-style).
// Same shape: commit-time ratchet with an opt-out marker + reason.
//
// The failure pattern: a dev writes
//   {rows.map((row, i) => <Row key={i} data={row} />)}
// where `rows` is a DB-fetched array that reorders, inserts, or deletes
// mid-session. React uses `key` for reconciliation. When `key={i}` on a
// re-sorted list, every downstream child that owns local state (form
// input value, drawer open, animated transition, focused ring) gets that
// state bled onto the wrong row — the row that USED to sit at that
// position. On Sam's daily driver (mobile Safari) that means typing into
// an applicant note gets attached to a different applicant when the list
// re-orders around a stage change. On desktop it means a focused input
// jumps to the wrong row when a poll refresh reorders the list.
//
// This is the same class of leak as the 465 fake-success InsuraCloud
// sync rows (memory: project_apex_2026_05_18_insuracloud_auth_dead) and
// the 198 zombie AgentLink rows (memory:
// project_apex_2026_05_20_agentlink_fake_success): the action LOOKED
// successful (input received text, drawer opened) but was bound to the
// wrong record — silent data corruption.
//
// The right primitive: use the row's stable identity (`row.id`,
// `row.slug`, `row.email`, `row.uuid`) as the key. If the row genuinely
// has no stable identity — a static skeleton array, a decorative
// dot-grid, a static feature list from Brand Bible — that is the ONLY
// legitimate use of index-as-key and it must ship with an opt-out
// marker.
//
// Baseline history:
//   2026-07-08 wave-28 initial baseline lock at current unmarked count.
//   Distribution skews to admin dashboards (AgentCommandDashboard, Finances,
//   AdminStrikes, HallOfFame) and skeleton loaders (page-loading-skeleton,
//   skeleton, LeaderboardTabs). Skeleton-loader sites are legit and get
//   `stable-key-allow:skeleton-static-array` markers on pay-down passes.
//   DB-row sites (leaderboards, applicant lists, chargeback rows, referral
//   panels) are the real leak and get refactored to `key={row.id}`.
//
// Pay-down pattern (wave-29+):
//   Each pay-down wave refactors 5-15 sites, either (a) swapping to
//   `key={row.id}` / `key={row.slug}` where a stable id exists in the
//   underlying view, or (b) annotating with
//   `stable-key-allow:<why-index-is-safe-here>` for legit static arrays.
//   Lower BASELINE by exactly the number paid down each commit.
//
// Detection:
//   Fails on any `key={i}`, `key={idx}`, `key={index}`, `key={arrayIndex}`
//   inside src/**/*.{tsx,jsx} unless:
//     (a) the file is exempt (WhatShippedTodayBanner narrates history), OR
//     (b) the guard script itself, OR
//     (c) the line has the opt-out marker `stable-key-allow:<reason>`
//         on the same line or the line directly above.
//
//   String / template-literal / comment mentions of the pattern are
//   masked via a state-machine skipper so documentation prose ("don't
//   use key={i}") does not false-positive.
//
// Not flagged:
//   - `key={item.id}`, `key={row.slug}`, `key={r.uuid}` — property access,
//     doesn't match the bare-identifier regex.
//   - `key={`${section}-${row.id}`}` — template literal composition using
//     stable identity.
//   - `key={someHash}` — any non-index-named identifier.
//   - `key={index}` inside a comment or string literal (state-machine mask).
//
// Cost when fired: ~80-150ms (linear in ~530 src files, single-pass line scan
// after state-machine mask build).

const repoRoot = path.resolve(import.meta.dirname, "..");

const TRACKED_DIRS = ["src"];

const EXCLUDE_FILES = new Set([
  // WhatShippedTodayBanner narrates historical fixes; a shipped-log label
  // that mentions "key={i}" verbatim would false-positive without an
  // opt-out marker, and putting a marker there would be misleading.
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
  // The guard itself (self-reference).
  "scripts/check-stale-key-in-list.mjs",
]);

const EXCLUDE_PATTERNS = [
  /\.test\.(tsx?|jsx?)$/,
  /\.spec\.(tsx?|jsx?)$/,
  /__tests__\//,
];

const OPT_OUT_MARKER = /stable-key-allow:([^\s*/}]+)/;

// Match `key={i}`, `key={idx}`, `key={index}`, `key={arrayIndex}` — bare
// identifier only, closing brace immediately after. Anything with a
// property access (`key={row.i}`), method call (`key={idx.toString()}`),
// or composition (`key={i + 1}`) does NOT match, because those already
// break the naive index-as-key pattern.
const INDEX_KEY_RE = /key=\{(i|idx|index|arrayIndex)\}/g;

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

// State-machine skipper: returns a Uint8Array `mask` where mask[i] === 1
// means index i in the source is inside a string, template literal, or
// comment (and therefore not a real render site). Handles single-line +
// block comments, single/double/backtick strings with escape sequences,
// and template-literal `${…}` interpolation (real code, mask stays 0
// inside).
function buildMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    // Line comment
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") {
        mask[i] = 1;
        i++;
      }
      continue;
    }
    // Block comment
    if (c === "/" && next === "*") {
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        mask[i] = 1;
        i++;
      }
      if (i < src.length) {
        mask[i] = 1;
        mask[i + 1] = 1;
        i += 2;
      }
      continue;
    }
    // Single or double-quoted string
    if (c === '"' || c === "'") {
      const quote = c;
      mask[i] = 1;
      i++;
      while (i < src.length && src[i] !== quote) {
        mask[i] = 1;
        if (src[i] === "\\") {
          mask[i + 1] = 1;
          i += 2;
          continue;
        }
        if (src[i] === "\n") break; // unterminated — bail
        i++;
      }
      if (i < src.length) {
        mask[i] = 1;
        i++;
      }
      continue;
    }
    // Template literal
    if (c === "`") {
      mask[i] = 1;
      i++;
      while (i < src.length && src[i] !== "`") {
        // ${…} = real code, mask stays 0 inside
        if (src[i] === "$" && src[i + 1] === "{") {
          i += 2;
          let depth = 1;
          while (i < src.length && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            if (depth > 0) i++;
          }
          if (i < src.length) i++; // past closing }
          continue;
        }
        mask[i] = 1;
        if (src[i] === "\\") {
          mask[i + 1] = 1;
          i += 2;
          continue;
        }
        i++;
      }
      if (i < src.length) {
        mask[i] = 1;
        i++;
      }
      continue;
    }
    i++;
  }
  return mask;
}

function lineOf(src, idx) {
  let line = 1;
  for (let j = 0; j < idx && j < src.length; j++) {
    if (src[j] === "\n") line++;
  }
  return line;
}

function checkFile(rel) {
  const abs = path.join(repoRoot, rel);
  const text = fs.readFileSync(abs, "utf8");
  const mask = buildMask(text);
  const lines = text.split("\n");
  const violations = [];

  INDEX_KEY_RE.lastIndex = 0;
  let m;
  while ((m = INDEX_KEY_RE.exec(text)) !== null) {
    // Skip if inside a string or comment.
    if (mask[m.index] === 1) continue;

    const line = lineOf(text, m.index);
    const lineText = lines[line - 1] ?? "";
    const prevLineText = lines[line - 2] ?? "";
    if (OPT_OUT_MARKER.test(lineText)) continue;
    if (OPT_OUT_MARKER.test(prevLineText)) continue;

    violations.push({
      line,
      indexName: m[1],
      text: lineText.trim().slice(0, 140),
    });
  }

  return violations;
}

let totalFiles = 0;
const allViolations = [];

for (const dir of TRACKED_DIRS) {
  for (const rel of walk(dir)) {
    if (isExcluded(rel)) continue;
    totalFiles++;
    const v = checkFile(rel);
    if (v.length > 0) allViolations.push({ rel, v });
  }
}

const count = allViolations.reduce((n, f) => n + f.v.length, 0);

// Lower this number when fixes land. NEVER raise it.
const BASELINE = 1;

if (count <= BASELINE) {
  const delta = BASELINE - count;
  if (delta > 0) {
    console.log(
      `[check:stale-key-in-list] OK — ${totalFiles} files scanned, ${count} unmarked index-as-key uses ` +
        `(${delta} below baseline ${BASELINE}). Lower BASELINE in scripts/check-stale-key-in-list.mjs to ${count} in this commit.`,
    );
  } else {
    console.log(
      `[check:stale-key-in-list] OK — ${totalFiles} files scanned, ${count} unmarked index-as-key uses (== baseline ${BASELINE}).`,
    );
  }
  process.exit(0);
}

console.error(
  `[check:stale-key-in-list] FAIL — ${count} unmarked index-as-key use(s) found, baseline is ${BASELINE}. ` +
    `A new key={i} / key={idx} / key={index} / key={arrayIndex} was added since the last baseline lock.`,
);
console.error("");
for (const { rel, v } of allViolations) {
  for (const { line, indexName, text } of v) {
    console.error(`  ${rel}:${line} [key={${indexName}}] ${text}`);
  }
}
console.error("");
console.error("index-as-key on a re-sortable / re-orderable list causes React to");
console.error("bind row-local state (form input value, drawer open, animation) to");
console.error("the POSITION, not the ROW. When the list re-orders around a mutation,");
console.error("state bleeds onto the wrong row. On mobile Safari (Sam's daily driver)");
console.error("that means typing an applicant note attaches to the wrong applicant.");
console.error("");
console.error("Fix by either:");
console.error("  1. Use the row's stable identity: `key={row.id}` / `key={row.slug}`");
console.error("     / `key={row.uuid}` / `key={row.email}`. Prefer this — every DB row");
console.error("     has a primary key by construction.");
console.error("  2. If the array is genuinely static / deterministic (skeleton loader,");
console.error("     decorative dot-grid, hard-coded feature list from Brand Bible),");
console.error("     add an opt-out marker `stable-key-allow:<short-reason>` on the");
console.error("     offending line or the line directly above.");
console.error("");
console.error("Silent state-bleed is the same class of fake-success leak that produced");
console.error("the 465 InsuraCloud rows and the 198 AgentLink rows: the action LOOKED");
console.error("successful (input received text, drawer opened) but was bound to the");
console.error("wrong record. No fake success.");
process.exit(1);
