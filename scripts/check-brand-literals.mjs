#!/usr/bin/env node
/**
 * Brand-literal ratchet.
 *
 * The 2026-08-17 Phase Zero audit found 760 raw matches (551 in code, the rest in comments) of hardcoded "Apex"/"APEX" literals
 * across 195 files in src/, with no central brand config. Directive section 11:
 * "Do not scatter APEX strings through components. Use centralized tenant-aware
 * configuration." Each literal is a white-label blocker — a tenant on
 * powered_by or white_label mode would still see APEX baked into components.
 *
 * This guard does not try to fix that in one sweep. It freezes the number so it
 * can only fall. Call sites migrate to resolveBrand() from src/config/brand.ts
 * in waves, and the baseline drops with each wave.
 *
 * TWO THINGS THIS GUARD GETS RIGHT THAT THE OBVIOUS VERSION DOES NOT:
 *
 * 1. It strips comments before counting. A guard that scans raw source counts
 *    its own documentation. That bug shipped here before (2026-08-12): a
 *    ratchet counted ".maybeSingle()" written inside code comments, so every
 *    wave that documented the site it converted traded a real violation for a
 *    phantom and held the count flat while the code improved. The guard would
 *    have stopped measuring and still looked green.
 *
 * 2. It strips comments WITHOUT blanking string bodies. The first attempt at
 *    that same fix blanked string contents too, which would have hidden every
 *    real literal — the guard would report zero violations on a codebase full
 *    of them. String contents are exactly what this guard exists to count.
 *
 * src/config/brand.ts is exempt: it is the one file that SHOULD hold these
 * values. Exempting it is the point of the module, not a loophole.
 *
 * TEST FILES ARE EXEMPT. This guard exists to catch brand strings that reach a
 * tenant's SCREEN. A test name like it("falls back to APEX defaults") is never
 * shipped in the user-facing bundle, so counting it produces friction with no
 * white-label benefit — and would tax every future test that describes brand
 * behaviour. This is a scope correction, not a loophole: tests do not render.
 *
 * SCOPE IS GIT-TRACKED FILES, NOT THE DIRECTORY. Multiple automated workers
 * commit to this repo concurrently. A directory walk counts other workers'
 * untracked scratch files, so an unrelated agent writing a temp test under src/
 * blocks YOUR commit for literals you did not write and cannot remove. That
 * happened on this guard's first run. `git ls-files` covers tracked AND staged
 * files, so anything actually entering the repo is still counted — an untracked
 * file that nobody is committing is not part of the codebase yet.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const BASELINE = 539;
const EXEMPT = new Set(["src/config/brand.ts"]);
/** Test files never ship to a user, so brand literals in them block nothing. */
const IS_TEST = /(\.test\.tsx?$|\.spec\.tsx?$|__tests__\/|^src\/tests\/)/;
const PATTERN = /\bAPEX\b|\bApex\b/g;

/**
 * Remove // and comments while preserving string and template literal
 * bodies. Character-scanned rather than regex-replaced, because a regex cannot
 * tell a "//" inside a URL string from the start of a comment.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        if (src[i] === quote) break;
        out += src[i];
        i++;
      }
      out += quote;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Tracked + staged .ts/.tsx under src/. Excludes other workers' untracked files. */
function trackedSourceFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--", "src/"], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\0").filter((f) => /\.tsx?$/.test(f)).map((f) => join(ROOT, f));
}

let total = 0;
const perFile = [];
for (const file of trackedSourceFiles()) {
  if (!existsSync(file)) continue; // staged deletion
  const rel = relative(ROOT, file);
  if (EXEMPT.has(rel) || IS_TEST.test(rel)) continue;
  const hits = (stripComments(readFileSync(file, "utf8")).match(PATTERN) ?? []).length;
  if (hits > 0) { total += hits; perFile.push([rel, hits]); }
}

const label = "[check-brand-literals]";
if (total > BASELINE) {
  perFile.sort((a, b) => b[1] - a[1]);
  console.error(`${label} FAIL — ${total} hardcoded brand literals, baseline ${BASELINE} (+${total - BASELINE}).`);
  console.error(`${label} Use resolveBrand() from src/config/brand.ts instead of a literal.`);
  console.error(`${label} Worst offenders:`);
  for (const [f, n] of perFile.slice(0, 10)) console.error(`  ${n}\t${f}`);
  process.exit(1);
}
if (total < BASELINE) {
  console.log(`${label} OK — ${total} literals across ${perFile.length} files, DOWN from baseline ${BASELINE}.`);
  console.log(`${label} Lower BASELINE to ${total} in scripts/check-brand-literals.mjs to lock in the win.`);
  process.exit(0);
}
console.log(`${label} OK — ${total} literals across ${perFile.length} files (== baseline ${BASELINE}).`);
