#!/usr/bin/env node
// Fails the build if any forbidden term ever ships to user-facing copy.
// Owned by Website Integrity Bot. To add a term: append to FORBIDDEN below
// and document why in the comment.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// term → reason it's banned. Match is case-insensitive on word/phrase boundary.
const FORBIDDEN = [
  ["slave account", "racially-charged language; replacement: 'satellite account'"],
  ["slave accounts", "racially-charged language; replacement: 'satellite accounts'"],
  ["army of slave", "racially-charged language"],
  ["lorem ipsum", "placeholder content must never ship"],
  ["coming soon", "use a real ship date or remove the section"],
  ["tbd", "real value or remove"],
  ["example.com", "placeholder domain"],
  ["delve into", "AI-tell"],
  ["it's important to note", "AI-tell filler"],
  ["seamlessly", "AI-tell — say what actually happens"],
  ["top-tier", "AI-tell vague"],
  ["leverage our", "AI-tell — say 'use'"],
  ["unlock the power", "AI-tell"],
  ["robust solution", "AI-tell"],
  ["cutting-edge", "AI-tell"],
];

// Scan all user-facing source files. Exclude vendor + build artifacts.
const TEXT_EXTS = new Set([".tsx", ".ts", ".jsx", ".js", ".md", ".html"]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo",
  "scripts", // this file lives here — and check scripts shouldn't trigger themselves
]);

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (TEXT_EXTS.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

const files = walk(repoRoot);
const violations = [];

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    for (const [term, reason] of FORBIDDEN) {
      if (lower.includes(term.toLowerCase())) {
        violations.push({
          file: path.relative(repoRoot, file),
          line: i + 1,
          term,
          reason,
          snippet: lines[i].trim().slice(0, 140),
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log("✓ check:forbidden-language — no banned terms in user-facing copy");
  process.exit(0);
}

console.error(`\n✗ check:forbidden-language — ${violations.length} violation(s):\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    term:   "${v.term}"`);
  console.error(`    reason: ${v.reason}`);
  console.error(`    line:   ${v.snippet}`);
  console.error();
}
console.error("Fix or argue with Website Integrity Bot — do not just remove the check.");
process.exit(1);
