#!/usr/bin/env node
/**
 * check-realtime-feedback-loop.mjs — MP-436
 *
 * ONE CONTRACT: a callback passed to `useProductionRealtime()` must never
 * re-emit the event it is handling.
 *
 * `useProductionRealtime` listens for the window event
 * "production-realtime-update". `invalidateOperationalTruth()` DISPATCHES that
 * event by default (correctly — mutation call sites need the local echo). Wire
 * the listener to the dispatcher and the two close a ring that re-drives itself
 * every debounce period with no database activity at all.
 *
 * That shipped in 55b494e4 (2026-08-27) and ran until 2026-09-05. Measured: 29
 * laps in 10 seconds of fake-timer wall clock on ZERO row changes, each lap
 * invalidating "apex-home-dashboard", "scoped-production-scoreboard" and
 * "imo-by-agency" — the platform's three most expensive RPCs.
 *
 * WHY A SOURCE GUARD AND NOT JUST THE VITEST: the unit test
 * (src/tests/hooks/productionRealtimeFeedbackLoop.test.ts) drives a synthetic
 * wiring it declares itself. It proves the mechanism and that `broadcast:false`
 * is load-bearing; it cannot see what real component code passes. This grades
 * the actual call sites.
 *
 * NO BASELINE COUNT, deliberately: a count-only floor is fungible and lets a
 * regression be laundered by an unrelated pay-down (MP-356/357). The contract
 * is zero.
 *
 * FAILS LOUD RATHER THAN VOUCHING (MP-399): if the hook or the invalidator
 * cannot be found, or a call site cannot be parsed to a balanced argument
 * list, this exits non-zero instead of reporting a clean tree.
 *
 * KNOWN CONSERVATISM: the shared stripComments() blanks block comments and
 * whole-line `//` comments, not trailing ones. A trailing comment that quotes
 * a broadcasting call inside a useProductionRealtime(...) argument list would
 * read as a violation. That direction is deliberate — a false red is visible
 * and fixable, a false green is the bug this guard exists to stop.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { stripComments, walk } from "./lib/scan-utils.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const HOOK = "useProductionRealtime";
const INVALIDATOR = "invalidateOperationalTruth";

/**
 * Blank string LITERAL bodies, preserving length and newlines.
 *
 * MP-436 caught this on its own author: the shipped-banner prose in
 * src/data/shipped-data.ts describes this very bug, so `useProductionRealtime()`
 * appears inside a quoted string and the scanner counted it as a 20th call
 * site. Same family as MP-277's footnote bug — a guard counting its own
 * documentation.
 *
 * Blanking strings is safe HERE (and was not in MP-277) because this guard
 * grades code STRUCTURE, never string VALUES: a real call site is never inside
 * a string literal, and `broadcast: false` is never quoted.
 */
function stripStringLiterals(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          out += quote;
          i++;
          break;
        }
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const violations = [];
const unprovable = [];
let sitesChecked = 0;

/** Return the source span of a call's argument list, or null if unbalanced. */
function argSpan(text, openParenIdx) {
  let depth = 0;
  for (let i = openParenIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(openParenIdx + 1, i);
    }
  }
  return null;
}

const files = walk(SRC).filter((f) => !f.includes(`${path.sep}tests${path.sep}`));

// The guard must not silently pass because the thing it grades was renamed.
const hookDefined = files.some(
  (f) => f.endsWith(`${HOOK}.ts`) && fs.readFileSync(f, "utf8").includes(`export function ${HOOK}`),
);
const invalidatorDefined = files.some(
  (f) =>
    f.endsWith(`${INVALIDATOR}.ts`) &&
    fs.readFileSync(f, "utf8").includes(`export function ${INVALIDATOR}`),
);
if (!hookDefined || !invalidatorDefined) {
  console.error(
    `check-realtime-feedback-loop: cannot locate ${!hookDefined ? HOOK : INVALIDATOR}. ` +
      `The guard cannot vouch for a tree it could not read — refusing to pass.`,
  );
  process.exit(1);
}

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.includes(HOOK)) continue;
  const text = stripStringLiterals(stripComments(raw));
  const rel = path.relative(ROOT, file);

  let idx = 0;
  while ((idx = text.indexOf(`${HOOK}(`, idx)) !== -1) {
    const open = idx + HOOK.length;
    // Skip the declaration itself.
    const before = text.slice(Math.max(0, idx - 20), idx);
    if (/function\s+$/.test(before)) {
      idx = open;
      continue;
    }
    const args = argSpan(text, open);
    const line = text.slice(0, idx).split("\n").length;
    // Advance past this match BEFORE any branch below can `continue`, or the
    // indexOf scan re-finds the same site forever. (It did, on first run.)
    idx = open;
    if (args === null) {
      console.error(
        `check-realtime-feedback-loop: ${rel}:${line} — unbalanced argument list; ` +
          `cannot prove this call site either way.`,
      );
      process.exit(1);
    }
    sitesChecked++;

    if (args.includes(INVALIDATOR)) {
      // Direct call: require the suppression explicitly.
      const suppressed = /broadcast\s*:\s*false/.test(args);
      if (!suppressed) {
        violations.push(
          `${rel}:${line} — ${HOOK} callback calls ${INVALIDATOR} without ` +
            `{ broadcast: false }. This re-emits the event it is handling and ` +
            `rings forever on zero row changes.`,
        );
      }
    } else if (!/^\s*\(\s*\)\s*=>/.test(args) && !/^\s*[A-Za-z_$][\w$]*\s*,/.test(args)) {
      // Neither an inline arrow we could read nor a plain identifier — record
      // it rather than laundering it into a pass.
      unprovable.push(`${rel}:${line} — callback shape not statically readable`);
    }
  }
}

if (sitesChecked === 0) {
  console.error(
    `check-realtime-feedback-loop: found 0 ${HOOK} call sites. The hook exists, so ` +
      `parsing 0 sites means the scanner is broken, not that the tree is clean.`,
  );
  process.exit(1);
}

for (const u of unprovable) console.log(`  unprovable: ${u}`);

if (violations.length > 0) {
  console.error(`\ncheck-realtime-feedback-loop: ${violations.length} feedback ring(s):\n`);
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error(
    `\nPass { broadcast: false } — the listener still invalidates every ` +
      `operational key, it just stops echoing the event back to itself.\n`,
  );
  process.exit(1);
}

console.log(
  `check-realtime-feedback-loop: OK — ${sitesChecked} ${HOOK} call site(s), no feedback ring` +
    (unprovable.length ? `, ${unprovable.length} unprovable (listed above)` : ""),
);
