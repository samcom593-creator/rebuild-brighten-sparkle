import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

// check-unit-tests-wired — MP-437 (2026-09-05)
//
// THE BUG THIS ENDS: this repo carries 999 unit tests across 100 files. Until
// today NOT ONE CI WORKFLOW RAN THEM. `npm test` ("vitest run") existed in
// package.json and was invoked by nothing: not verify-core.yml, not any of the
// other five workflows, and not the 75-guard verify:core chain (traced by
// expanding every `npm run` edge from verify:core — vitest is unreachable).
// So the suite was decorative. MP-436 shipped four new vitest tests into it
// the previous day; nothing would ever have run them either.
//
// This is the same disease as MP-351 (24 security contracts guarded by a
// script no route executed) and MP-403 (the guard that catches unwired guards,
// graded on the wrong tree). check-guard-wiring.mjs already grades that every
// scripts/check-*.mjs is reachable — but the vitest suite is not a check-*.mjs,
// so it sits OUTSIDE that guard's population entirely. Verified disjoint: this
// file is the only thing in the repo that asks whether the unit suite runs.
//
// WHY THE SUITE LOOKED UNSAFE TO WIRE, AND WAS NOT: at HEAD the suite reported
// 38 failures, which is why an earlier pass declined to wire it ("turns main
// red on work that is not mine to adjudicate"). Measured, all 38 were ONE
// host-runtime artifact — Node >= 22.4's shadowing `localStorage` global — and
// the identical tree was 993-green on Node 22.12 and on CI's pinned Node 20.
// Zero product bugs. See src/tests/setup.ts for the restoration and its proof.
//
// NO BASELINE COUNT, DELIBERATELY. A count-only floor is fungible: MP-356/357
// proved a real regression can sit red and then be laundered green by an
// unrelated pay-down. The contract here is binary — the suite is wired, or it
// is not.
//
// REFUSES TO VOUCH (MP-399): if a file is missing, unreadable, or does not
// have a shape this guard understands, it exits non-zero rather than reporting
// a clean tree. A guard that returns a confident wrong zero is worse than no
// guard, because it is believed.

const root = process.cwd();
const problems = [];
const refusals = [];

const read = (p) => {
  const full = resolve(root, p);
  if (!existsSync(full)) {
    refusals.push(`${p} does not exist — cannot grade whether the unit suite is wired.`);
    return null;
  }
  try {
    return readFileSync(full, "utf8");
  } catch (error) {
    refusals.push(`${p} could not be read (${error.message}).`);
    return null;
  }
};

// ── 1. The suite command still has to BE the suite ──────────────────────────
const pkgRaw = read("package.json");
let testScript = null;
if (pkgRaw) {
  try {
    const scripts = JSON.parse(pkgRaw).scripts ?? {};
    testScript = scripts.test ?? null;
    if (!testScript) {
      problems.push('package.json has no "test" script — the unit suite has no entry point to wire.');
    } else if (!/\bvitest\b/.test(testScript)) {
      problems.push(`package.json "test" = ${JSON.stringify(testScript)} no longer invokes vitest, so wiring it into CI runs something else.`);
    }
  } catch (error) {
    refusals.push(`package.json did not parse as JSON (${error.message}).`);
  }
}

// ── 2. An empty run must not be able to pass ────────────────────────────────
// vitest exits non-zero on "No test files found" unless passWithNoTests is on.
// With it on, a glob that silently stops matching reports SUCCESS having run
// nothing — the confident wrong zero of MP-399, inside the test runner itself.
const vitestConfig = read("vitest.config.ts");
if (vitestConfig) {
  if (/passWithNoTests\s*:\s*true/.test(vitestConfig)) {
    problems.push("vitest.config.ts sets passWithNoTests: true — a suite that matches zero files would report success. Remove it, or this guard is vouching for nothing.");
  }
  if (!/\binclude\s*:/.test(vitestConfig)) {
    refusals.push("vitest.config.ts has no test.include — cannot tell which files the suite claims to cover.");
  }
}

// ── 3. Some tracked workflow must actually run it on push ───────────────────
const WORKFLOW_DIR = ".github/workflows";
let tracked = new Set();
try {
  tracked = new Set(
    execFileSync("git", ["ls-files", WORKFLOW_DIR], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean),
  );
} catch (error) {
  refusals.push(`could not list tracked workflow files via git (${error.message}).`);
}

let workflowFiles = [];
try {
  workflowFiles = readdirSync(resolve(root, WORKFLOW_DIR)).filter((f) => /\.ya?ml$/.test(f)).sort();
} catch (error) {
  refusals.push(`${WORKFLOW_DIR} could not be listed (${error.message}).`);
}
if (workflowFiles.length === 0 && refusals.length === 0) {
  refusals.push(`${WORKFLOW_DIR} contains no workflow files — nothing could run the suite.`);
}

// Matches the ways this repo could plausibly invoke the suite. A path argument
// is handled separately below: `npm test -- src/tests/lib/one.test.ts` runs a
// SUBSET while still matching "npm test", which would let the suite be quietly
// narrowed to a single green file without this guard noticing.
const RUNS_SUITE = /(^|[\s&|;])(npm\s+(run\s+)?test\b|npx\s+vitest\b|(?<!\.)\bvitest\s+run\b)/;
const STEP_START = /^(\s*)-\s+(name|uses|run|id):/;

const wired = [];
for (const file of workflowFiles) {
  const rel = `${WORKFLOW_DIR}/${file}`;
  const raw = read(rel);
  if (raw === null) continue;
  if (tracked.size > 0 && !tracked.has(rel)) {
    // An untracked workflow cannot vouch: CI checks out the committed tree.
    // Reported, never counted (MP-403).
    problems.push(`${rel} runs the suite but is UNTRACKED — CI checks out HEAD, so it would not exist there.`.replace(" runs the suite but is", " is"));
    continue;
  }

  const lines = raw.split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    const withoutComment = line.replace(/#.*$/, "");
    if (RUNS_SUITE.test(withoutComment)) hits.push(i);
  });
  if (hits.length === 0) continue;

  // Only a push-triggered workflow closes the window this guard exists for.
  const onPush = /^on:/m.test(raw) && /^\s{2}push:/m.test(raw);
  if (!onPush) {
    problems.push(`${rel} runs the unit suite but is not triggered on push — a manual-only run cannot keep main honest.`);
    continue;
  }

  for (const lineNo of hits) {
    // Slice the enclosing step: walk back to its `-` bullet, forward to the next.
    let start = lineNo;
    while (start > 0 && !STEP_START.test(lines[start])) start -= 1;
    if (!STEP_START.test(lines[start])) {
      refusals.push(`${rel}:${lineNo + 1} invokes the suite but its enclosing step could not be located — refusing to judge a shape I cannot parse.`);
      continue;
    }
    const indent = lines[start].match(STEP_START)[1].length;
    let end = start + 1;
    while (end < lines.length) {
      const m = lines[end].match(STEP_START);
      if (m && m[1].length <= indent) break;
      end += 1;
    }
    const step = lines.slice(start, end).join("\n");

    if (/continue-on-error\s*:\s*true/.test(step)) {
      problems.push(`${rel}:${lineNo + 1} runs the unit suite under continue-on-error: true — a failing suite would be recorded as a passing step (the 'continue-on-error makes a FAILED step read success' bug of 2026-08-07).`);
      continue;
    }
    if (/\bif\s*:/.test(step) && !/if\s*:\s*(always\(\)|success\(\))/.test(step)) {
      problems.push(`${rel}:${lineNo + 1} runs the unit suite behind a conditional — it may not run on an ordinary push.`);
      continue;
    }
    // A file/path argument narrows the suite to a subset.
    const cmd = lines[lineNo].replace(/#.*$/, "");
    if (/(npm\s+(run\s+)?test|vitest\s+run)[^\n]*\s(src\/|\.\/|[\w./-]*\.test\.[tj]sx?)/.test(cmd)) {
      problems.push(`${rel}:${lineNo + 1} runs only a SUBSET of the suite (${cmd.trim()}) — the rest would go unrun while the step still reports green.`);
      continue;
    }
    wired.push(`${rel}:${lineNo + 1}`);
  }
}

if (wired.length === 0 && problems.length === 0 && refusals.length === 0) {
  problems.push(
    "NO workflow runs the unit suite. 999 tests across 100 files would be decorative: " +
      "green locally, never executed on push, and unable to fail a single deploy.",
  );
}

if (refusals.length > 0) {
  console.error("check:unit-tests-wired — REFUSING TO VOUCH\n");
  for (const r of refusals) console.error(`  ✗ ${r}`);
  console.error("\nThis is not a pass and not a failure of the contract: the guard could not");
  console.error("establish the facts it grades. Fix the input, then re-run.");
  process.exit(1);
}

if (problems.length > 0) {
  console.error("check:unit-tests-wired — FAILED\n");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("\nWHY THIS IS GATED: the suite sat unwired while 999 tests looked like");
  console.error("protection. Wire it into a push-triggered workflow step that runs the");
  console.error("WHOLE suite, with no continue-on-error and no narrowing path argument.");
  process.exit(1);
}

console.log(`check:unit-tests-wired — OK (unit suite runs on push at: ${wired.join(", ")})`);
