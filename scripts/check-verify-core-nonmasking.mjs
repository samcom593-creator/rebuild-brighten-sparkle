#!/usr/bin/env node
// MP-456. Grades that the repo's only real gate reports EVERY failure.
//
// scripts/run-verify-core.mjs exists because `verify:core` is an `&&` chain and
// `&&` short-circuits: the first red check hides every check after it, and the
// log reads "one thing is wrong" when the honest answer is "one thing is wrong
// and N are UNRUN". This guard exists because that fix is trivially reversible
// and its reversal is SILENT — flip one `run:` line in CI back to the raw chain
// and masking returns with every check still nominally "wired". A count of
// wired guards cannot see it (MP-357: a floor graded on a count is fungible),
// so this grades the WIRING SHAPE by name.
//
// Deliberately NOT graded here: whether each guard is reachable at all. That is
// check:guard-wiring's question, it answers it against the git index, and two
// checks deriving one question two ways is the drift MP-323 removed.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = "scripts/run-verify-core.mjs";
const WF = ".github/workflows/verify-core.yml";
const problems = [];
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : null);

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const scripts = pkg.scripts ?? {};
const chain = scripts["verify:core"];
const runnerSrc = read(RUNNER);
const wf = read(WF);

// 1. The runner must exist and be invoked by an npm script.
if (!runnerSrc) {
  problems.push(`${RUNNER} is missing. The gate has no non-masking entry point.`);
}
const allEntry = Object.entries(scripts).find(([, cmd]) => cmd.includes(RUNNER));
if (!allEntry) {
  problems.push(`No npm script invokes ${RUNNER}. CI cannot reach the non-masking runner.`);
}

// 2. CI must invoke the non-masking entry, not the raw && chain. This is the
//    assertion that actually holds the fix in place.
if (!wf) {
  problems.push(`${WF} is missing — cannot prove CI runs the gate at all.`);
} else {
  const runLines = [...wf.matchAll(/^\s*run:\s*(.+)$/gm)].map((m) => m[1].trim());
  const callsAll = allEntry && runLines.some((l) => l === `npm run ${allEntry[0]}` || l.includes(RUNNER));
  const callsRaw = runLines.some((l) => /^npm run verify:core$/.test(l));
  if (!callsAll) {
    problems.push(
      `${WF} does not invoke the non-masking runner. CI must run 'npm run ${allEntry?.[0] ?? "<entry>"}'.`
    );
  }
  if (callsRaw) {
    problems.push(
      `${WF} invokes the raw 'npm run verify:core' && chain. That short-circuits on the first ` +
        `failure and leaves every later check UNRUN while reporting a single cause.`
    );
  }
}

// 3. The runner must derive its list from verify:core, never hardcode one — a
//    second copy of the list is a place for checks to go missing unnoticed.
if (runnerSrc) {
  if (!/scripts\?\.\["verify:core"\]|scripts\["verify:core"\]/.test(runnerSrc)) {
    problems.push(`${RUNNER} does not read package.json's verify:core; its list could drift from the real chain.`);
  }
  // A hardcoded roster would show up as many check: literals in the source.
  const literals = new Set([...runnerSrc.matchAll(/["'`](check:[A-Za-z0-9:_-]+)["'`]/g)].map((m) => m[1]));
  if (literals.size > 2) {
    problems.push(
      `${RUNNER} hardcodes ${literals.size} check: names. The chain in package.json must be the only roster.`
    );
  }
  // 4. It must not stop early. A `break` or process.exit inside the run loop
  //    reintroduces exactly the masking this removes.
  const loop = runnerSrc.slice(runnerSrc.indexOf("for (const link of links)"));
  const body = loop.slice(0, loop.indexOf("\n}\n") + 1);
  if (/\bbreak\b|process\.exit\(/.test(body)) {
    problems.push(`${RUNNER} exits or breaks inside its run loop — that is short-circuiting under a new name.`);
  }
}

// 5. The chain must stay parseable by the runner's own rules, or the runner
//    refuses to vouch at run time and the gate silently stops gating.
if (typeof chain !== "string" || !chain.trim()) {
  problems.push("package.json has no verify:core chain for the runner to read.");
} else if (/\|\||;|(?<!&)&(?!&)|\$\(|`/.test(chain)) {
  problems.push("verify:core contains a separator run-verify-core.mjs refuses to parse; the gate would not run.");
}

if (problems.length) {
  console.error("✗ check:verify-core-nonmasking — the gate can mask failures:\n");
  for (const p of problems) console.error("  •", p);
  console.error(`\n  Fix: keep 'verify:core' as the ordered roster, and have ${WF} run the npm script`);
  console.error(`  that invokes ${RUNNER}, which runs every link and reports every failure.`);
  process.exit(1);
}

const n = chain.split("&&").filter((s) => s.trim()).length;
console.log(
  `✓ check:verify-core-nonmasking — CI runs all ${n} link(s) via ${RUNNER}; every failure is reported, none masked.`
);
