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
// Blanking (rather than deleting) preserves byte offsets so reported line numbers stay true.
export function stripComments(text) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  out = out
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? " ".repeat(line.length) : line))
    .join("\n");
  return out;
}

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
