// Lexical helpers shared by the repo's "what does this call site actually say"
// guards. Extracted (MP-345) rather than copied: check-relation-exists.mjs is
// the second guard to need them, and the first thing a second copy does is
// drift from the first.
import fs from "fs";
import path from "path";

// Comments must be blanked before matching, or the guard fires on prose. Writing
// `.neq("status","terminated")` inside an explanatory comment — as the fix for
// WhaleRecruiting.tsx does — otherwise reports itself as a violation forever.
// MP-345 hit the same thing from the other side: ProductionAnalyticsCard's header
// comment documents the dead `.from("production")` that MP-329 removed, so a
// raw-source scan reports a fixed bug as a live one, forever.
//
// MP-482: this was the LAST private stripper in the repo, and it is now the shared
// lexer. The local one blanked any line starting with `//` and regex-matched
// `/*...*/` with no string awareness, so a `/*` inside a string literal blanked
// real content through to the next `*/` -- 36 files and 208,948 characters across
// check-enum-filter-literals' scan roots, src/data/shipped-data.ts alone losing
// 191,052 to the glob string "src/**/*.{tsx,ts,jsx,js}". That is the hides-a-
// violation direction, and it is the one that matters.
//
// The conversion was NOT a free swap and was refused once on measurement: run
// against the shared lexer as it stood, check-enum-filter-literals went RED on
// send-calendly-invite/index.ts, accusing a literal that lives in a COMMENT
// documenting a filter MP-344 had removed. The shared lexer had no regex rule, so
// `.replace(/"/g, "&quot;")` opened a phantom string on the quote inside the
// pattern and every comment after it survived. That was fixed in the lexer first
// (see its header); only then was this file safe to point at it.
export { stripComments } from "./strip-comments.mjs";

export function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}
