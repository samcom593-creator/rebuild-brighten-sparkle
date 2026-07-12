import fs from "node:fs";
import path from "node:path";

// wave-23 (2026-07-06) — blocking-modal (alert/confirm/prompt) ratchet.
//
// Class-of-fix Round 7 sibling to wave-16 (internal-nav-hrefs), wave-17
// (external-link-noopener), wave-18 (raw-db-slug-leak), wave-19
// (console-in-prod), wave-20 (raw-db-slug-leak tightened), wave-21
// (empty-catch-swallow), wave-22 (debugger-statement).
//
// The failure pattern: a component calls `if (!confirm("Send emails to all
// agents?"))` at the top of a bulk-action handler. It ships. On mobile Safari
// (Sam's daily driver) the native confirm dialog freezes the main thread mid-
// paint, disables the address bar, refuses to accept keyboard input on iOS
// unless the whole viewport is scrolled to the tap origin, and returns focus
// to nowhere on close. On desktop it looks like a 2005 admin page. It also
// bypasses every UX affordance the app has invested in (toast, aria-live,
// keyboard focus trap, brand voice) and can silently no-op if a browser
// extension or another script has swallowed `window.confirm`.
//
// The Website Integrity Bot prompt §5 (Real data, never lorem ipsum) and §7
// (Mobile-first — broken on iPhone Safari = broken) both cover this class of
// leak. The Operating Contract §NO-FAKE-SUCCESS covers the swallowable-modal
// tail — a blocked or swallowed `confirm()` return of undefined coerces to
// false and the action silently doesn't fire.
//
// The right primitive already exists: Radix AlertDialog in
// `src/components/ui/alert-dialog.tsx`. This guard makes converting to that
// primitive commit-time enforceable — new blocking modals are blocked at
// commit, existing ones are grandfathered and visible for pay-down.
//
// Baseline history:
//   2026-07-06 wave-23 initial lock @ 16. Distribution: 13 `confirm(` +
//     3 `window.confirm(` across DashboardCRM (2 bulk-action confirms),
//     AdminEmailGaps (1 mass-email requeue), ContentLibrary (2 deletes),
//     HiringManagerAssignments (1 scope removal), UnclaimedLeads (1 reassign),
//     SamHQ (1 task delete), TelegramBot (1 broadcast queue), InviteLinks
//     (1 revoke), InboxPage (1 bulk delete), AgentProfileDrawer (3 status
//     changes), InactiveAgents (1 bulk status), ControlTerminal (1 dev
//     terminal). Two additional grep-hits in InterviewCommandCenter and
//     AdminStrikes are prose comments about historical window.confirm/
//     window.prompt migrations — the string/comment mask correctly excludes
//     them. No `alert(` or `prompt(` calls in current source.
//
// Pay-down pattern (wave-24+):
//   Replace with Radix AlertDialog + a promise-based `useConfirm()` hook so
//   the callsite stays a one-liner but the UX is brand-locked, mobile-safe,
//   keyboard-accessible, and never silently swallowed.
//
// Detection:
//   Fails on `alert(`, `confirm(`, `prompt(`, `window.alert(`, `window.confirm(`,
//   `window.prompt(`, `globalThis.alert(`, `globalThis.confirm(`,
//   `globalThis.prompt(` in src/**/*.{tsx,ts,jsx,js} unless:
//     (a) the file is exempt (WhatShippedTodayBanner narrates history), OR
//     (b) the line has the opt-out marker `blocking-modal-allow:<reason>`
//         on the same line or the line directly above.
//
// Not flagged:
//   - `<Alert>` / `<AlertDialog>` JSX components (no `(` after the identifier).
//   - `foo.alert(` / `logger.alert(` / `manychat.confirm(` / any dotted
//     identifier chain where the token is NOT `window.` or `globalThis.`
//     (via a preceding-word-boundary check that also excludes `.`).
//   - The literal strings "alert" / "confirm" / "prompt" inside quoted
//     strings, template literals, or comments (via a state-machine skipper).
//   - Method definitions like `confirm() {` on custom classes (matched
//     against the `(?<![\w$.])` boundary — `confirm(` at the start of a
//     line inside a class body would still hit; use the opt-out marker with
//     `blocking-modal-allow:<class-method-name>` on those in the rare case).
//   - Commented-out `// confirm(...)` lines (state-machine skips comments).

const repoRoot = path.resolve(import.meta.dirname, "..");

const TRACKED_DIRS = ["src"];

const EXCLUDE_FILES = new Set([
  // WhatShippedTodayBanner narrates historical fixes and would false-positive
  // if we ever quote the pattern verbatim in a shipped-log entry.
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
  // The guard itself (self-reference).
  "scripts/check-blocking-modal.mjs",
]);

const EXCLUDE_PATTERNS = [
  /\.test\.(tsx?|jsx?)$/,
  /\.spec\.(tsx?|jsx?)$/,
  /__tests__\//,
];

const OPT_OUT_MARKER = /blocking-modal-allow:([^\s*/]+)/;

// Match `alert(`, `confirm(`, `prompt(` with either:
//   • a non-word / non-dot boundary immediately before (bare call), OR
//   • `window.` / `globalThis.` immediately before (explicit global).
// The negative lookbehind for `.` rejects `logger.alert(`, `foo.confirm(`,
// `manychat.prompt(` etc. — any custom method named the same.
const BANNED = ["alert", "confirm", "prompt"];
const CALL_RE = new RegExp(
  `(?<![\\w$.])(?:window\\.|globalThis\\.)?(${BANNED.join("|")})\\s*\\(`,
  "g"
);

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

function isExcluded(rel) {
  if (EXCLUDE_FILES.has(rel)) return true;
  return EXCLUDE_PATTERNS.some((re) => re.test(rel));
}

// State-machine skipper: returns a Uint8Array `mask` where mask[i] === 1
// means index i in the source is inside a string, template literal, or
// comment (and therefore not a real call site). Handles single-line + block
// comments, single/double/backtick strings with escape sequences, and
// template-literal `${…}` interpolation (which is real code).
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

  CALL_RE.lastIndex = 0;
  let m;
  while ((m = CALL_RE.exec(text)) !== null) {
    // Skip if inside a string or comment.
    if (mask[m.index] === 1) continue;

    const line = lineOf(text, m.index);
    const lineText = lines[line - 1] ?? "";
    const prevLineText = lines[line - 2] ?? "";
    if (OPT_OUT_MARKER.test(lineText)) continue;
    if (OPT_OUT_MARKER.test(prevLineText)) continue;

    violations.push({ line, method: m[1], text: lineText.trim().slice(0, 140) });
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
//
// wave-31 (2026-07-11) — full pay-down 16 -> 0. Every native window.confirm /
// bare confirm callsite migrated to `await askConfirm({...})` backed by the
// promise-based useConfirm hook + ConfirmProvider (Radix AlertDialog)
// mounted inside AuthenticatedShell. Sites paid down: DashboardCRM (2),
// AgentProfileDrawer (3), ContentLibrary (2), AdminEmailGaps, ControlTerminal,
// HiringManagerAssignments, InactiveAgents, InboxPage, InviteLinks, SamHQ,
// TelegramBot, UnclaimedLeads. Mobile-Safari-friendly, brand-locked,
// keyboard-accessible, non-swallowable. From this commit forward, any new
// native modal call fails at commit.
const BASELINE = 0;

if (count <= BASELINE) {
  const delta = BASELINE - count;
  if (delta > 0) {
    console.log(
      `[check:blocking-modal] OK — ${totalFiles} files scanned, ${count} unmarked native modal calls ` +
        `(${delta} below baseline ${BASELINE}). Lower BASELINE in scripts/check-blocking-modal.mjs to ${count} in this commit.`,
    );
  } else {
    console.log(
      `[check:blocking-modal] OK — ${totalFiles} files scanned, ${count} unmarked native modal calls (== baseline ${BASELINE}).`,
    );
  }
  process.exit(0);
}

console.error(
  `[check:blocking-modal] FAIL — ${count} unmarked native modal call(s) found, baseline is ${BASELINE}. ` +
    `A new alert/confirm/prompt call was added since the last baseline lock.`,
);
console.error("");
for (const { rel, v } of allViolations) {
  for (const { line, method, text } of v) {
    console.error(`  ${rel}:${line} [${method}] ${text}`);
  }
}
console.error("");
console.error("Native alert/confirm/prompt block the main thread on mobile Safari,");
console.error("look like a 2005 admin page, bypass every UX affordance the app has");
console.error("(toast, focus trap, brand voice), and can silently no-op if another");
console.error("script has swallowed window.confirm.");
console.error("");
console.error("Fix by either:");
console.error("  1. Replace with Radix AlertDialog (src/components/ui/alert-dialog.tsx)");
console.error("     — brand-locked, mobile-safe, keyboard-accessible, never swallowed.");
console.error("  2. If genuinely intentional (dev-only tool, one-off admin utility),");
console.error("     add an opt-out marker `blocking-modal-allow:<short-reason>` on the");
console.error("     offending line or the line directly above.");
console.error("");
console.error("Native browser modals are the same class of fake-success leak that");
console.error("produced the 465 InsuraCloud rows: swallowed-return-undefined coerces");
console.error("to false, the action silently doesn't fire, Sam thinks it worked. No");
console.error("fake success.");
process.exit(1);
