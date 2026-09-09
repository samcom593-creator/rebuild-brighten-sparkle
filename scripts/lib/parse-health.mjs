// parse-health.mjs — MP-496
//
// Is every source file in the type-check graph actually PARSEABLE?
//
// WHY THIS IS ITS OWN QUESTION, SEPARATE FROM THE ERROR COUNT
//
//   check-tsc-error-count.mjs grades `tsc -b --noEmit --force` output with
//   `count <= BASELINE`. That rule is sound only while the count is a
//   MEASUREMENT of the same thing the baseline measured. It stops being one
//   the moment a file fails to parse:
//
//     healthy tree   85 errors  (all semantic: TS2339 x32, TS2352 x30, ...)
//     one broken import in one file
//                     6 errors  (5 parse errors + 1 pre-existing)
//
//   TypeScript cannot run semantic analysis on a file it cannot parse, so all
//   85 semantic errors DISAPPEAR and the total falls to 6. Measured on this
//   repo 2026-09-09: the gate printed
//
//     ✓ check-tsc-error-count — 6/85 TypeScript errors in 7s
//       Ratchet drop available: lower BASELINE from 85 to 6
//
//   ...on a tree where `npm run build` exits 1. The gate was never blind to
//   the syntax error — it reported it, then read the catastrophe as a
//   79-error IMPROVEMENT, and invited the operator to lock the floor there.
//   A count-only ratchet is fungible (MP-356, MP-357); this is the sharpest
//   form of that, because the WORSE the tree gets the BETTER it scores.
//
// WHY NOT JUST MATCH TS1xxx
//
//   That was the first cut and it is WRONG. Measured against this repo's
//   healthy 85: src/lib/analyticsBoot.ts carries TS1345 ("An expression of
//   type 'void' cannot be tested for truthiness") — a SEMANTIC error that
//   happens to live in the 1xxx band. Keying on the band would have gone red
//   on a healthy tree and stayed red, which is the permanently-red guard this
//   codebase keeps re-learning to avoid. The band is a guess about codes; the
//   parser is the oracle for the actual question.
//
// COST: 765 files in 1.84s (measured 2026-09-09) — ~400x cheaper than the
//   ~120s type-check, which is why this can run at COMMIT time where the
//   count gate deliberately cannot.
//
// ORACLE FRAGILITY, AND WHAT IS DONE ABOUT IT
//
//   `sourceFile.parseDiagnostics` is not part of TypeScript's documented
//   public surface. If a future TypeScript renames or empties it, a naive
//   reader would report "0 unparseable" forever — a guard that has quietly
//   stopped guarding, which is this repo's oldest disease. So every scan runs
//   TWO controls first and REFUSES TO REPORT unless both hold:
//     - a deliberately broken source MUST yield >= 1 diagnostic
//     - a known-good source MUST yield 0
//   Failing either throws. Could-not-look is never a pass (MP-399), and it is
//   never a permanent red either — the second control keeps a hypersensitive
//   oracle from condemning a healthy tree.

import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const BROKEN_CONTROL = "import {\nimport { a } from 'b';\n} from './c';\n";
const HEALTHY_CONTROL = "export const a: number = 1;\nexport default a;\n";

function parseOne(filePath, text) {
  const sf = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.ES2020,
    /* setParentNodes */ true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return sf.parseDiagnostics ?? [];
}

// Proves the oracle can still fail AND can still pass, on every single run.
export function assertOracleWorks() {
  const bad = parseOne("control-broken.ts", BROKEN_CONTROL);
  if (bad.length === 0) {
    throw new Error(
      "parse-health oracle is BROKEN: a deliberately unparseable source " +
        "reported 0 diagnostics. `sourceFile.parseDiagnostics` is internal " +
        `TypeScript API and this build (${ts.version}) no longer populates ` +
        "it as expected. Refusing to report — a silent 0 here would mean " +
        "this guard has stopped guarding.",
    );
  }
  const good = parseOne("control-healthy.ts", HEALTHY_CONTROL);
  if (good.length !== 0) {
    throw new Error(
      "parse-health oracle is BROKEN: a known-good source reported " +
        `${good.length} diagnostic(s). Refusing to report — this would ` +
        "condemn a healthy tree and become a permanently-red guard.",
    );
  }
}

export function collectSourceFiles(roots) {
  const files = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const st = fs.statSync(root);
    if (st.isFile()) {
      if (/\.(ts|tsx)$/.test(root)) files.push(root);
      continue;
    }
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          stack.push(p);
        } else if (/\.(ts|tsx)$/.test(e.name)) {
          files.push(p);
        }
      }
    }
  }
  return files.sort();
}

// Returns { filesScanned, unparseable: [{file, line, column, message}] }.
// Throws if the oracle cannot be trusted.
export function scanParseHealth(roots, repoRoot) {
  assertOracleWorks();
  const files = collectSourceFiles(roots);
  const unparseable = [];
  for (const f of files) {
    const diags = parseOne(f, fs.readFileSync(f, "utf8"));
    if (!diags.length) continue;
    const d = diags[0];
    const pos =
      d.file && typeof d.start === "number"
        ? d.file.getLineAndCharacterOfPosition(d.start)
        : { line: 0, character: 0 };
    unparseable.push({
      file: repoRoot ? path.relative(repoRoot, f) : f,
      line: pos.line + 1,
      column: pos.character + 1,
      count: diags.length,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
    });
  }
  return { filesScanned: files.length, unparseable };
}
