import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

// check-guard-wiring — MP-351, extended MP-403 (2026-09-03)
//
// Every scripts/check-*.mjs is a guard someone wrote to stop a class of bug.
// A guard that nothing RUNS is not a guard; it is a file that makes the repo
// look protected. check:contact-actions — 24 backend/UI/security contracts
// including the JWT gates on the SMS/email/dispatcher edge functions — sat
// unrun from 2026-08-11 to 2026-08-31 and nothing said so.
//
// WHY THIS IS EASY TO GET WRONG (measured on this repo, MP-351): a first cut
// that looked only for `scripts/<file>` inside an npm script reported THREE
// orphans and two were false:
//   - check-relative-time-guard.mjs is invoked by .husky/pre-commit as a bare
//     `node scripts/…` call, with no npm script at all.
//   - check:live-polling is invoked by `prebuild`, so it runs on every build,
//     and verify:core runs the build.
// A wiring checker that misses those accuses working guards, and a checker
// that cries wolf is one nobody reads. All four reachability routes below are
// therefore load-bearing.
//
// ── MP-403: WHICH TREE IS THE QUESTION ABOUT? ────────────────────────────────
// MP-351 read the guard population off the FILESYSTEM and the wiring off the
// FILESYSTEM. CI checks out HEAD. Those are not the same tree, and the gap is
// not academic — MP-398 shipped the same correction for three apex-doctor
// checks the day before this one.
//
// It produced a live block. A concurrent wave wrote
// scripts/check-recruiting-contact-actions.mjs at 2026-09-02 17:00:42Z and
// never committed it (`??` in git status, absent from every commit). That file
// is genuinely run by nothing, so MP-351's verdict was TRUE — but the
// population it belongs to is "files in this working directory", not "files
// this repo ships". Consequences, both measured 2026-09-03:
//
//  1. The pre-commit gate fires on `scripts/check-*.mjs`, `package.json` and
//     `.husky/pre-commit`. Driving the real gate slice with a simulated STAGED
//     list returned rc=1 for all three and rc=0 for an unrelated src/ file — so
//     for 18.9h every wave touching a guard, the manifest, or the hook was
//     blocked by an untracked file it did not author. That is the
//     permanently-red guard apex-doctor Check #19's header warns about: the
//     author who trips it cannot honestly clear it.
//  2. The printed remedy was WRONG for this case. "Wire each into verify:core"
//     turns the gate green while the guard file is still untracked, so CI —
//     which has no such file — fails with `Cannot find module`. This repo has
//     already paid that bill: .husky/pre-commit referenced
//     check-relative-time-guard.mjs from 2026-07-21 while that script appeared
//     in no commit, so every commit staging a src/ file failed and could only
//     land via --no-verify, silently disabling ~40 other guards at once
//     (src/data/shipped-data.ts:741). Wiring an uncommitted file reproduces it.
//
// So the verdict is now graded against the INDEX — HEAD plus whatever is
// staged, i.e. exactly the tree this commit will produce — for BOTH the guard
// files and the wiring that reaches them. Three outcomes, deliberately
// distinct:
//
//   tracked + unreachable  → FAIL. Blocks the author who is actually shipping
//                            it, which is the one person who can wire it.
//   untracked              → NOTICE, does not vote. CI cannot run a file that
//                            is not in the repo, so it protects nothing and
//                            the honest remedy is "commit it together with its
//                            wiring, or delete it" — never "wire it".
//   wired only on disk     → FAIL. The wiring is unstaged, so the guard is an
//                            orphan in CI while reading green locally. This is
//                            the MP-398 direction and the sharper one: it is
//                            invisible to every filesystem-only check.
//
// The untracked bucket is a notice, not a pass. It is printed on every run
// including green ones, because an unreported exemption is how a real orphan
// would hide here.

const root = resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

// Content as the INDEX holds it (HEAD + staged). Returns null when the path is
// not in the index at all — which for a wiring file means CI will not see it.
const indexRead = (p) => git(["show", `:${p}`]);

// A repo check that cannot reach git must not silently degrade into MP-351's
// filesystem-only behaviour and call it a pass.
if (git(["rev-parse", "--git-dir"]) === null) {
  console.error("✗ check:guard-wiring — could not run git in this tree, so 'what will this commit produce' is UNKNOWN.");
  console.error("  Refusing to fall back to reading the working directory: that is the exact");
  console.error("  substitution MP-403 removed. Fix the git invocation, do not skip the check.");
  process.exit(1);
}

const trackedGuards = (git(["ls-files", "scripts/check-*.mjs"]) ?? "")
  .split("\n")
  .filter(Boolean)
  .map((p) => p.replace(/^scripts\//, ""))
  .sort();

const onDiskGuards = existsSync(resolve(root, "scripts"))
  ? readdirSync(resolve(root, "scripts")).filter((f) => /^check-.*\.mjs$/.test(f)).sort()
  : [];

const untracked = onDiskGuards.filter((f) => !trackedGuards.includes(f));

// ── wiring, read from the index ──────────────────────────────────────────────
const pkgIndexRaw = indexRead("package.json");
if (pkgIndexRaw === null) {
  console.error("✗ check:guard-wiring — package.json is not in the index; cannot tell what this commit wires.");
  process.exit(1);
}
const scripts = JSON.parse(pkgIndexRaw).scripts ?? {};

const listIndexed = (dir) =>
  (git(["ls-files", `${dir}/*`]) ?? "").split("\n").filter(Boolean);

const hookFiles = listIndexed(".husky").filter((p) => !p.split("/").pop().startsWith("_"));
const ciFiles = listIndexed(".github/workflows");

const hookText = hookFiles.map((p) => indexRead(p) ?? "").join("\n");
const ciText = ciFiles.map((p) => indexRead(p) ?? "").join("\n");

// Same sources as the working tree sees them, used ONLY to tell "you have not
// written the wiring" apart from "you have not staged it". Never votes alone.
const diskText = [
  JSON.stringify(JSON.parse(read("package.json")).scripts ?? {}),
  ...hookFiles.concat(ciFiles).map((p) => {
    try {
      return read(p);
    } catch {
      return "";
    }
  }),
].join("\n");

// Resolve which npm scripts are transitively reachable from an entrypoint,
// following `npm run X` / `npm run --silent X` edges. verify:core reaches
// `build`, and `build` reaches `prebuild` via npm's lifecycle.
const NAME_RE = /npm run (?:--silent )?([\w:-]+)/g;
function reachable(entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const name = stack.pop();
    if (!name || seen.has(name) || !(name in scripts)) continue;
    seen.add(name);
    // npm lifecycle: running X also runs preX and postX
    for (const life of [`pre${name}`, `post${name}`]) {
      if (life in scripts && !seen.has(life)) stack.push(life);
    }
    for (const m of scripts[name].matchAll(NAME_RE)) stack.push(m[1]);
  }
  return seen;
}

// Entrypoints = anything a human or CI actually invokes.
const entry = new Set(["verify:core", "build"]);
for (const m of hookText.matchAll(NAME_RE)) entry.add(m[1]);
for (const m of ciText.matchAll(NAME_RE)) entry.add(m[1]);
const live = reachable([...entry]);

// A guard file counts as wired if EITHER a reachable npm script runs it, OR a
// hook/CI file invokes `node scripts/<file>` directly.
const direct = hookText + "\n" + ciText;
const orphans = [];
const unstagedWiring = [];
for (const file of trackedGuards) {
  const ref = `scripts/${file}`;
  const viaNpm = [...live].some((n) => (scripts[n] ?? "").includes(ref));
  const viaDirect = direct.includes(ref);
  if (viaNpm || viaDirect) continue;
  if (diskText.includes(ref)) unstagedWiring.push(file);
  else orphans.push(file);
}

if (trackedGuards.length < 40) {
  console.error(
    `✗ check:guard-wiring — only ${trackedGuards.length} tracked guard file(s) found; expected the full suite.`,
  );
  console.error("  Refusing to report a clean sweep over a population this small.");
  process.exit(1);
}

// Printed on every run, pass or fail. An exemption nobody sees is how the next
// orphan hides.
function reportUntracked() {
  if (!untracked.length) return;
  console.error(`  ${untracked.length} guard file(s) present on disk but in NO commit — not graded, because CI never sees them:`);
  for (const u of untracked) console.error(`    scripts/${u}  (untracked)`);
  console.error("    These protect nothing today. Commit each one IN THE SAME CHANGE that wires it,");
  console.error("    or delete it. Wiring an uncommitted file makes this check green and hands CI");
  console.error("    'Cannot find module' — see this file's header for when that already happened.");
}

let failed = false;

if (orphans.length) {
  failed = true;
  console.error(`✗ check:guard-wiring — ${orphans.length} committed guard(s) run by nothing:`);
  for (const o of orphans) console.error(`    scripts/${o}`);
  console.error("");
  console.error("  Wire each into verify:core and the pre-commit hook, or invoke it");
  console.error("  directly from a hook. A guard nothing runs cannot fail, so it");
  console.error("  reports protection the repo does not have.");
}

if (unstagedWiring.length) {
  failed = true;
  console.error(`✗ check:guard-wiring — ${unstagedWiring.length} guard(s) are wired ONLY in the working tree:`);
  for (const u of unstagedWiring) console.error(`    scripts/${u}`);
  console.error("");
  console.error("  The wiring exists on disk but is not staged, so it will not be in the commit");
  console.error("  and CI — which checks out HEAD — will run nothing. `git add` the wiring file");
  console.error("  (package.json / .husky / .github/workflows) alongside the guard.");
}

if (failed) {
  reportUntracked();
  process.exit(1);
}

console.log(
  `✓ check:guard-wiring — all ${trackedGuards.length} committed guard(s) reachable from verify:core, a hook, CI, or the build (graded against the index, not the working tree).`,
);
reportUntracked();
