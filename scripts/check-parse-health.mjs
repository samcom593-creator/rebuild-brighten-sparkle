#!/usr/bin/env node
// check-parse-health.mjs — MP-496
//
// Fails if any file in the type-check graph cannot be PARSED.
//
// This is the commit-time half of MP-496. check-tsc-error-count.mjs is the
// authority on the type-error COUNT, and its own header explains at length why
// it does not run at commit time: measured at ~120s-881s, there is no cheap way
// to answer "how many type errors" locally.
//
// There IS a cheap way to answer "does every file still parse": 1.84s for 766
// files. That is the question whose wrong answer actually broke a build — on
// 2026-09-09, 6eab02e4 was committed and pushed with an import statement nested
// inside an open `import {` block. Every local guard passed. The count gate
// passed too, and PRAISED the tree (see parse-health.mjs for why). The failure
// surfaced ~10 minutes later in CI on `build`, and cost a second commit
// (82e15203) to repair.
//
// So this guard is not a duplicate of the count gate. It answers a different
// question, at 1/400th the cost, on the path where it can still prevent the
// commit rather than describe it afterwards.

import path from "node:path";
import { scanParseHealth } from "./lib/parse-health.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Scope note, stated rather than implied: this covers tsconfig.app.json's
// include (`src`) plus tsconfig.node.json's (`vite.config.ts`) — the same two
// projects `tsc -b` walks. It is NOT derived from the tsconfigs at runtime, so
// a NEW include added to either project would not be picked up here until this
// list is updated. check-typecheck-authority.mjs asserts the chain; this line
// is the honest limit of this file's reach.
const ROOTS = ["src", "vite.config.ts"].map((r) => path.join(repoRoot, r));

const startedAt = Date.now();

let result;
try {
  result = scanParseHealth(ROOTS, repoRoot);
} catch (err) {
  // The oracle refused to answer. That is never a pass.
  console.error(`\n✗ check:parse-health — ${err.message}\n`);
  process.exit(1);
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

if (result.unparseable.length === 0) {
  console.log(
    `✓ check:parse-health — ${result.filesScanned} files parse in ${elapsed}s`,
  );
  process.exit(0);
}

console.error(
  `\n✗ check:parse-health — ${result.unparseable.length} file(s) cannot be parsed ` +
    `(${result.filesScanned} scanned in ${elapsed}s)\n`,
);
for (const u of result.unparseable) {
  console.error(`  ${u.file}(${u.line},${u.column}): ${u.message}`);
  if (u.count > 1) console.error(`    ...and ${u.count - 1} more in this file`);
}
console.error(
  "\n`npm run build` cannot succeed while this is true, and the type-error",
);
console.error(
  "count gate will UNDER-report on this tree: TypeScript skips semantic",
);
console.error(
  "analysis for a file it cannot parse, so the count falls and reads as an",
);
console.error("improvement. Fix the parse error before committing.");
process.exit(1);
