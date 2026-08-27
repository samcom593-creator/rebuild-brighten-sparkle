#!/usr/bin/env node
// wave-21 (2026-07-06) — Empty-catch-swallow ratchet.
//
// Counts every empty error handler under each scanned root and fails the
// commit if that root's count exceeds its own BASELINE. Same shape as
// check-tsc-error-count: the count can only go DOWN (fix a site or add
// an opt-out marker), never up. New empty catches are blocked at commit
// time; existing ones are grandfathered but visible for pay-down.
//
// Roots are budgeted SEPARATELY (see ROOTS below) — the per-directory
// budget shape already used by check-shadow-areas / check-bg-gradient-areas
// / check-motion-areas. One shared budget would let a front-end pay-down
// silently fund a new backend swallow; separate budgets cannot.
//
// Class of leak this closes:
//   Silent-swallow errors are the exact pattern that produced the 465
//   fake-success InsuraCloud sync rows (memory: project_apex_2026_05_18_
//   insuracloud_auth_dead) and the 198 zombie AgentLink rows (memory:
//   project_apex_2026_05_20_agentlink_fake_success). Front-end code has
//   the same failure mode: a query fails, the .catch swallows it, the UI
//   renders a stale value, Sam thinks everything is green, revenue slips.
//
// Baseline history:
//   2026-07-06 wave-21 initial lock @ 66. Distribution: 60 try/catch
//     (analytics, localStorage-incognito, telemetry, error-boundary
//     fallbacks) + 6 .catch (SW register/update, deal-close analytics
//     beacon, HallOfFame RPC fallback, RecruitingShortLink beacon,
//     useAuth broken-session cleanup). Pay-down: replace with
//     logger.error, toast.error, or annotate with
//     `empty-catch-allow:<reason>` and lower BASELINE in the same commit.
//   2026-07-06 wave-21 same-commit pay-down 66 → 60. Annotated 5
//     obviously-intentional sites (useAuth broken-session signOut, SW
//     register + 60s update poll, short-link beacon, deal-closed
//     analytics event). The RecruitingShortLink same-line marker also
//     covered the outer try/catch on L33 as line-above, dropping the
//     count an extra 1 beyond the 5 sites annotated.
//   2026-07-07 wave-24 full pay-down 60 → 0. Every remaining site
//     manually inspected + categorized. All 60 are legitimately
//     intentional fire-and-forget patterns. Marker taxonomy:
//       localstorage-incognito     (18 sites) — Safari private / quota
//       telemetry-fire-and-forget  (14 sites) — analytics/vitals/track shims
//       best-effort-fallback       (10 sites) — parse/RPC/DOM fallback chains
//       batch-drain                 (7 sites) — retry-loop individual-failure
//       media-api-optional          (7 sites) — video/audio/recognition APIs
//       jsonparse-fallback          (4 sites) — try JSON, keep raw
//       user-cancelled              (3 sites) — file picker / dialog dismiss
//       error-boundary-report       (2 sites) — telemetry beacons from EBs
//       test                        (1 site)  — test spec expected-throw
//     BASELINE now locked at 0. Every future empty catch must ship its
//     opt-out marker in the same commit or the pre-commit gate blocks.
//
// Backend baseline history (supabase/functions/**):
//   2026-07-25 initial lock @ 57 across 248 .ts files, measured against a
//     clean HEAD checkout (`git archive HEAD supabase/functions`) so the
//     number is reproducible and not a snapshot of one dirty worktree.
//     Distribution: 39 try/catch with an empty (or comment-only) body +
//     18 .catch arrow — of which 16 are the bare `.catch(() => {})`
//     fire-and-forget form and 2 are `await res.json().catch(() => null)`
//     parse fallbacks.
//     Until now the ratchet scanned src/** only, so every edge function was
//     ungated: the exact tier where a swallowed error becomes a fake-success
//     DB row rather than a stale pixel. Locking the current count freezes
//     the leak at today's size — no NEW backend swallow can land without an
//     `empty-catch-allow:<reason>` marker. Pay-down is a later wave; this
//     commit is the gate only, so not one existing site was touched.
//     Pay-down order when that wave runs: the `} catch {}` / `} catch (_) {}`
//     sites wrapping a DB write (insuracloud-sync:160, system-health-check:
//     115/293, send-seminar-invite-blast:192/221) come first — those are
//     literally the shape that produced the 465 fake-success rows.
//
// Companion to scripts/check-unsafe-supabase-catch.mjs which fails when a
// Supabase QueryBuilder gets a .catch chained (the builder is thenable but
// not a Promise; the .catch throws at runtime). That guard is shape-specific
// (unsafe .catch on a builder, hard-fails at 0). This guard is the broader
// disease across both tiers: any empty error handler, ratcheted per root.
//
// FLAGGED PATTERNS (must opt out or fix):
//   .catch(() => {})
//   .catch((e) => {})
//   .catch(err => {})
//   .catch(() => null)
//   .catch(() => undefined)
//   .catch(() => void 0)
//   .catch(() => void ignore)
//   .catch(() => { /* comment only */ })
//   } catch {}
//   } catch (e) {}
//   } catch { /* swallow */ }
//
// SAFE (not flagged):
//   .catch(err => logger.error(...))
//   .catch(handleError)                 (bare identifier — probably a real fn)
//   } catch (e) { console.error(e); }
//   } catch (e) { toast.error(...); }
//
// OPT-OUT MARKER:
//   Same-line trailing comment `empty-catch-allow:<short-reason>`
//   Or on the line directly above the offending line.
//   Reason is required (guard prints the marker with the reason so future
//   maintainers know why the error is intentionally swallowed).
//
// Cost when fired: ~90-170ms (linear in ~811 files across both roots).

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Scanned roots, each with its OWN baseline. Lower a baseline when fixes
// land in the same commit. NEVER raise one.
const ROOTS = [
  { dir: "src", baseline: 0 },
  { dir: "supabase/functions", baseline: 54 },
];

const roots = ROOTS.map((r) => ({ ...r, abs: path.join(repoRoot, r.dir) })).filter((r) => {
  if (fs.existsSync(r.abs)) return true;
  console.log(`[check-empty-catch] no ${r.dir}/ dir — skipping`);
  return false;
});

if (roots.length === 0) process.exit(0);

const OPT_OUT_MARKER = /empty-catch-allow:([^\s*/]+)/;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      walk(full, files);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

// Strip comments from a body chunk to decide if it is effectively empty.
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .trim();
}

// MP-307: the scanner reads RAW SOURCE for `.catch(` and `try {`, so a call
// site quoted inside a COMMENT counted as a real violation -- this file blocked
// a commit over the string `.catch(() => null)` appearing in a sentence
// explaining why that form was NOT used. MP-277 hit the identical bug in the
// .maybeSingle() ratchet ("the ratchet was counting its own footnotes") and
// recorded the trap in its fix: a stripper that also blanks STRING bodies turns
// every call site into "unparseable" and the guard quietly stops guarding.
//
// So this masks comment SPANS ONLY, preserving byte offsets (line numbers stay
// exact) and leaving string contents untouched. It tracks quote state first,
// because this codebase is full of "https://..." and a naive `//` scan would
// treat every URL as a comment start and blind the rest of that line -- which
// LOWERS the count. A guard may only ever be made stricter by accident, never
// looser, so the failure direction of this helper is the one that matters.
function commentMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") { mask[i] = 1; i++; }
      continue;
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (let k = i; k < stop; k++) mask[k] = 1;
      i = stop;
      continue;
    }
    i++;
  }
  return mask;
}

// Return null if not a suppressible catch body, otherwise return the file
// contents starting index of the matching closing brace `}` after `openIdx`.
// `openIdx` points at the `{` after the arrow / catch clause.
function matchBraceBody(src, openIdx) {
  let depth = 1;
  for (let i = openIdx + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    } else if (ch === "\"" || ch === "'" || ch === "`") {
      // skip string
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++;
        if (src[i] === "$" && src[i + 1] === "{" && quote === "`") {
          // template expression — recurse via depth counting
          let td = 1;
          i += 2;
          while (i < src.length && td > 0) {
            if (src[i] === "{") td++;
            else if (src[i] === "}") td--;
            if (td > 0) i++;
          }
        }
        i++;
      }
    } else if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
    }
  }
  return -1;
}

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

function optOutHit(lines, lineIdx) {
  const cur = lines[lineIdx] ?? "";
  const prev = lines[lineIdx - 1] ?? "";
  const m = cur.match(OPT_OUT_MARKER) ?? prev.match(OPT_OUT_MARKER);
  return m ? m[1] : null;
}

// Pattern 1: .catch(<params>) => { <maybe empty> })
// Pattern 2: .catch(<params>) => null | undefined | void 0)
// Pattern 3: } catch (<binding>?) { <maybe empty> }
//
// We scan textually. False-positive risk is low because the exact tokens
// `.catch(` and `catch` in the required syntactic positions are rare in
// unrelated identifiers.
const dotCatchRe = /\.catch\s*\(\s*/g;
const tryCatchRe = /(?<![A-Za-z0-9_$])catch\s*(?:\(\s*[^)]*\s*\)\s*)?\{/g;

function scanFile(file, violations) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  const inComment = commentMask(src);

  // --- .catch(...) form ---
  for (const m of src.matchAll(dotCatchRe)) {
    if (inComment[m.index]) continue; // a quoted call site is documentation
    const argStart = m.index + m[0].length;
    // Read the arrow-function argument. Expect `(...) =>` or `ident =>` or bare identifier.
    let i = argStart;
    // Try to consume a param list
    if (src[i] === "(") {
      let d = 1;
      i++;
      while (i < src.length && d > 0) {
        if (src[i] === "(") d++;
        else if (src[i] === ")") d--;
        if (d > 0) i++;
      }
      i++; // past closing paren
    } else {
      // bare ident (arrow param w/o parens) or bare function reference
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) i++;
    }
    // skip whitespace
    while (i < src.length && /\s/.test(src[i])) i++;
    // If not `=>` this is likely `.catch(handleError)` — safe, skip.
    if (src[i] !== "=" || src[i + 1] !== ">") continue;
    i += 2;
    while (i < src.length && /\s/.test(src[i])) i++;

    let body;
    let bodyEndIdx;
    if (src[i] === "{") {
      const close = matchBraceBody(src, i);
      if (close < 0) continue;
      body = src.slice(i + 1, close);
      bodyEndIdx = close;
    } else {
      // expression body — read until matching `)` of the .catch(
      let d = 1;
      let j = i;
      while (j < src.length && d > 0) {
        if (src[j] === "(") d++;
        else if (src[j] === ")") d--;
        if (d > 0) j++;
      }
      body = src.slice(i, j);
      bodyEndIdx = j;
    }
    const stripped = stripComments(body);
    const isEmpty = stripped === "" ||
      stripped === "null" ||
      stripped === "undefined" ||
      /^void\s+[A-Za-z0-9_$]+$/.test(stripped) ||
      /^void\s+0$/.test(stripped);
    if (!isEmpty) continue;

    const lineIdx = lineOf(src, m.index) - 1;
    const opt = optOutHit(lines, lineIdx);
    if (opt) continue;
    violations.push({
      file: path.relative(repoRoot, file),
      line: lineIdx + 1,
      kind: ".catch",
      snippet: (lines[lineIdx] ?? "").trim().slice(0, 120),
    });
  }

  // --- try { ... } catch { ... } form ---
  for (const m of src.matchAll(tryCatchRe)) {
    if (inComment[m.index]) continue; // a quoted call site is documentation
    const openIdx = m.index + m[0].length - 1;
    const close = matchBraceBody(src, openIdx);
    if (close < 0) continue;
    const body = src.slice(openIdx + 1, close);
    const stripped = stripComments(body);
    if (stripped !== "") continue;
    const lineIdx = lineOf(src, m.index) - 1;
    const opt = optOutHit(lines, lineIdx);
    if (opt) continue;
    violations.push({
      file: path.relative(repoRoot, file),
      line: lineIdx + 1,
      kind: "try/catch",
      snippet: (lines[lineIdx] ?? "").trim().slice(0, 120),
    });
  }
}

function scanFiles(files) {
  const violations = [];
  for (const file of files) scanFile(file, violations);
  return violations;
}

// Per-root evaluation. A root is over budget only against its OWN baseline;
// a surplus in one root can never pay for an overage in another.
const results = roots.map((root) => {
  const files = walk(root.abs);
  const violations = scanFiles(files);
  return { ...root, files: files.length, violations, count: violations.length };
});

const over = results.filter((r) => r.count > r.baseline);

// Always print the per-root receipt, pass or fail, so a failure in one root
// never hides the state of the other.
for (const r of results) {
  if (r.count > r.baseline) continue;
  const delta = r.baseline - r.count;
  if (delta > 0) {
    console.log(
      `[check-empty-catch] OK — ${r.dir}: ${r.files} files scanned, ${r.count} unmarked empty catches (${delta} below baseline ${r.baseline}). ` +
        `Lower the ${r.dir} baseline in scripts/check-empty-catch.mjs to ${r.count} in this commit.`,
    );
  } else {
    console.log(`[check-empty-catch] OK — ${r.dir}: ${r.files} files scanned, ${r.count} unmarked empty catches (== baseline ${r.baseline}).`);
  }
}

if (over.length === 0) process.exit(0);

for (const r of over) {
  console.error(
    `[check-empty-catch] FAIL — ${r.dir}: ${r.count} unmarked empty error handlers found, baseline is ${r.baseline}. ` +
      `A new empty catch was added since the last baseline lock.`,
  );
  console.error("");
  for (const v of r.violations) {
    console.error(`  ${v.file}:${v.line} [${v.kind}] ${v.snippet}`);
  }
  console.error("");
}
console.error("Fix by either:");
console.error("  1. Handle the error (logger.error / toast.error / setState).");
console.error("  2. Add an opt-out marker `empty-catch-allow:<short-reason>` on");
console.error("     the offending line or the line directly above.");
console.error("");
console.error("Silent-swallow error handlers are the same class of leak that");
console.error("produced the 465 fake-success InsuraCloud sync rows and the 198");
console.error("zombie AgentLink rows. No fake success.");
process.exit(1);
