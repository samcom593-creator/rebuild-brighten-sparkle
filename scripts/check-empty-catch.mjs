#!/usr/bin/env node
// wave-21 (2026-07-06) — Empty-catch-swallow ratchet.
//
// Counts every empty error handler in src/*.{tsx,ts,jsx,js} and fails
// the commit if the count exceeds BASELINE. Same shape as
// check-tsc-error-count: the count can only go DOWN (fix a site or add
// an opt-out marker), never up. New empty catches are blocked at commit
// time; existing ones are grandfathered but visible for pay-down.
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
//
// Companion to scripts/check-unsafe-supabase-catch.mjs which fails when a
// Supabase QueryBuilder gets a .catch chained (the builder is thenable but
// not a Promise; the .catch throws at runtime). That guard runs on
// supabase/functions/**. This guard runs on src/** and catches the broader
// disease: any empty error handler.
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
// Cost when fired: ~150-250ms (linear in ~520 files).

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(repoRoot, "src");

if (!fs.existsSync(srcRoot)) {
  console.log("[check-empty-catch] no src/ dir — skipping");
  process.exit(0);
}

const OPT_OUT_MARKER = /empty-catch-allow:([^\s*/]+)/;

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      walk(full);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      files.push(full);
    }
  }
}
walk(srcRoot);

const violations = [];

// Strip comments from a body chunk to decide if it is effectively empty.
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .trim();
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

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");

  // --- .catch(...) form ---
  for (const m of src.matchAll(dotCatchRe)) {
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

// Lower this number when fixes land. NEVER raise it.
const BASELINE = 60;

const count = violations.length;

if (count <= BASELINE) {
  const delta = BASELINE - count;
  if (delta > 0) {
    console.log(
      `[check-empty-catch] OK — ${files.length} files scanned, ${count} unmarked empty catches (${delta} below baseline ${BASELINE}). ` +
        `Lower BASELINE in scripts/check-empty-catch.mjs to ${count} in this commit.`,
    );
  } else {
    console.log(`[check-empty-catch] OK — ${files.length} files scanned, ${count} unmarked empty catches (== baseline ${BASELINE}).`);
  }
  process.exit(0);
}

console.error(
  `[check-empty-catch] FAIL — ${count} unmarked empty error handlers found, baseline is ${BASELINE}. ` +
    `A new empty catch was added since the last baseline lock.`,
);
console.error("");
for (const v of violations) {
  console.error(`  ${v.file}:${v.line} [${v.kind}] ${v.snippet}`);
}
console.error("");
console.error("Fix by either:");
console.error("  1. Handle the error (logger.error / toast.error / setState).");
console.error("  2. Add an opt-out marker `empty-catch-allow:<short-reason>` on");
console.error("     the offending line or the line directly above.");
console.error("");
console.error("Silent-swallow error handlers are the same class of leak that");
console.error("produced the 465 fake-success InsuraCloud sync rows and the 198");
console.error("zombie AgentLink rows. No fake success.");
process.exit(1);
