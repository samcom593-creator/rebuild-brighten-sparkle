#!/usr/bin/env node
// Fails the build if any forbidden term ever ships to user-facing copy.
// Owned by Website Integrity Bot.
//
// Rules:
//   - High-confidence bans only — false positives kill adoption.
//   - Skips comments (// and /* */), JSX placeholder="..." attrs, and known
//     vendor/build paths. Add patterns to SKIP_LINE_REGEX rather than
//     loosening the term list.
//   - To add a term: append to FORBIDDEN with a one-line reason.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const FORBIDDEN = [
  ["slave account", "racially-charged language; use 'satellite account'"],
  ["slave accounts", "racially-charged language; use 'satellite accounts'"],
  ["army of slave", "racially-charged language"],
  ["lorem ipsum", "placeholder content must never ship"],
  ["delve into", "AI-tell"],
  ["it's important to note", "AI-tell filler"],
  ["seamlessly", "AI-tell — say what actually happens"],
  ["top-tier", "AI-tell vague"],
  ["leverage our", "AI-tell — say 'use'"],
  ["unlock the power", "AI-tell"],
  ["robust solution", "AI-tell"],
  ["cutting-edge", "AI-tell"],
  ["real results from a real", "placeholder testimonial — name the agent + number + timeline"],
  ["real agent who transformed", "placeholder testimonial — name the agent + number + timeline"],
  ["watch how apex changed his life", "placeholder testimonial header — name the agent (this was wired to 'VSL Test' once)"],
  ["seamless integration", "AI-tell — name the integration + what it actually does"],
  ["leading crms", "vague corporate filler — name the CRM"],
  ["built-in solution", "AI-tell corporate larp"],
  ["thousands of agents", "fake-success number — APEX has ~95 agents, not thousands; use landing_live_stats() RPC"],
  ["transform your life", "AI-tell headline — say what changes in concrete terms"],
  ["transform your career", "AI-tell headline — say what changes"],
  ["elevate your", "AI-tell"],
  ["unlock your potential", "AI-tell"],
  ["powerful mobile experience", "AI-tell — show the screen + what it lets the agent do"],
  ["world-class", "AI-tell vague"],
  ["best-in-class", "AI-tell vague"],
  ["game-changer", "AI-tell"],
  ["game changer", "AI-tell"],
  ["95 active agents", "hardcoded fake-success stat — use landing_live_stats() RPC; roster moves daily"],
  ["22 carriers ·", "hardcoded fake-success stat — use landing_live_stats() RPC; carriers_partnered field exists"],
  ["50+ carriers", "marketing inflation — canonical carrier count is landing_live_stats().carriers_partnered (22). Interpolate the variable."],
  ["over 50 carriers", "marketing inflation — canonical carrier count is landing_live_stats().carriers_partnered (22). Interpolate the variable."],
  ["50 carrier partners", "marketing inflation — canonical carrier count is landing_live_stats().carriers_partnered (22). Interpolate the variable."],
  ["unlock personalized", "AI-tell — say what actually shows up on the dashboard, not 'personalized X'"],
  ["accurate projections", "AI-tell — either name the metric that gets projected or drop the promise"],
  ["coaching insights", "AI-tell — say the actual coaching advice, not 'insights'"],
];

const TEXT_EXTS = new Set([".tsx", ".ts", ".jsx", ".js", ".md", ".html"]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo",
  "scripts", // this file lives here — exempt to avoid self-trigger
]);
// Receipts + banner logs describe the banned terms by name (that's the whole
// point of the fix-record). Same exemption pattern as check-external-link-noopener
// already applies to these files. Add sparingly — the goal is user-facing copy.
const SKIP_FILES = new Set([
  "src/data/shipped-data.ts",
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
]);

// Lines matching any of these get skipped (legitimate use of a flagged term).
const SKIP_LINE_REGEX = [
  /^\s*\/\//,                          // // comment
  /^\s*\*/,                            // jsdoc / block-comment continuation
  /^\s*\/\*/,                          // /* comment start
  /placeholder\s*=\s*["'][^"']*["']/,  // JSX placeholder attrs (UX, not copy)
  /forbidden-allow/i,                  // explicit opt-in: receipts/docs that name banned terms
];

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
  const rel = path.relative(repoRoot, file);
  if (SKIP_FILES.has(rel)) continue;
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_LINE_REGEX.some((rx) => rx.test(line))) continue;
    const lower = line.toLowerCase();
    for (const [term, reason] of FORBIDDEN) {
      if (lower.includes(term.toLowerCase())) {
        violations.push({
          file: path.relative(repoRoot, file),
          line: i + 1,
          term,
          reason,
          snippet: line.trim().slice(0, 140),
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
