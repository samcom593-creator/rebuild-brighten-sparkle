import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// check-guard-wiring — MP-351
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

const root = resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const pkg = JSON.parse(read("package.json"));
const scripts = pkg.scripts ?? {};

const hookDir = resolve(root, ".husky");
const hookText = existsSync(hookDir)
  ? readdirSync(hookDir)
      .filter((f) => !f.startsWith("_"))
      .map((f) => {
        try {
          return read(`.husky/${f}`);
        } catch {
          return "";
        }
      })
      .join("\n")
  : "";

const ciDir = resolve(root, ".github/workflows");
const ciText = existsSync(ciDir)
  ? readdirSync(ciDir)
      .map((f) => {
        try {
          return read(`.github/workflows/${f}`);
        } catch {
          return "";
        }
      })
      .join("\n")
  : "";

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

// A guard file counts as wired if EITHER an npm script that is reachable runs
// it, OR a hook/CI file invokes `node scripts/<file>` directly.
const guardFiles = readdirSync(resolve(root, "scripts"))
  .filter((f) => /^check-.*\.mjs$/.test(f))
  .sort();

const direct = hookText + "\n" + ciText;
const orphans = [];
for (const file of guardFiles) {
  const ref = `scripts/${file}`;
  const viaNpm = [...live].some((n) => (scripts[n] ?? "").includes(ref));
  const viaDirect = direct.includes(ref);
  if (!viaNpm && !viaDirect) orphans.push(file);
}

if (guardFiles.length < 40) {
  console.error(
    `✗ check:guard-wiring — only ${guardFiles.length} guard files found; expected the full suite.`,
  );
  console.error("  Refusing to report a clean sweep over a population this small.");
  process.exit(1);
}

if (orphans.length) {
  console.error(`✗ check:guard-wiring — ${orphans.length} guard(s) run by nothing:`);
  for (const o of orphans) console.error(`    scripts/${o}`);
  console.error("");
  console.error("  Wire each into verify:core and the pre-commit hook, or invoke it");
  console.error("  directly from a hook. A guard nothing runs cannot fail, so it");
  console.error("  reports protection the repo does not have.");
  process.exit(1);
}

console.log(
  `✓ check:guard-wiring — all ${guardFiles.length} guard(s) reachable from verify:core, a hook, CI, or the build.`,
);
