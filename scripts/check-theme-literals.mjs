#!/usr/bin/env node
// check:theme-literals — ratchet on dark-only Tailwind literals in app surfaces.
//
// 2026-09-04, Sam: "when I click white mode it's like an entirely different
// website ... you can't see certain [widgets]." Light mode was unlocked on
// 2026-08-23 but 1,178 literal uses of text-white / bg-white / bg-black /
// border-white / text-slate-[1-4]00 sat on themed surfaces with no dark: pair
// and no coloured background of their own, so in light they rendered white
// text on cream. Three codemod passes brought the count down; this guard
// stops it climbing back. Same shape as check-brand-literals.
//
// Counted: className strings (any quoting) in src/pages + src/components that
// carry a target literal, have NO dark:/light: variant, and NO explicit colour
// background in the same string (white text on a coloured chip is correct).
// Landing/* is excluded — it is a deliberately single-theme surface.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[1], "..", "..");
const SCAN = ["src/pages", "src/components"];
// Single-theme surfaces are excluded on purpose: the public landing tree, the
// public get-licensed and post-submit video pages (a visitor never chose a
// theme, so their dark design is the design), and the legacy /agent-portal
// page (not in the sidebar). Rewriting their children to theme tokens put ink
// text on black in light mode — measured on the recruiting hero 2026-09-04.
const SKIP = ["src/components/landing", "src/pages/landing", "src/pages/Landing", "src/pages/GetLicensed.tsx", "src/components/onboarding/PostSubmitOnboardingVideo.tsx", "src/pages/AgentCommandDashboard.tsx"];
const TARGET = /\b(text-white(?:\/\d+)?|text-slate-[1-4]00|text-zinc-[1-3]00|text-black|bg-white(?:\/\d+)?|bg-black|border-white(?:\/\d+)?)\b/;
const COLORED = /\b(bg-(?!background|card|muted|foreground|popover|accent|border|input|transparent)[a-z]+-\d{2,3}|bg-(primary|secondary|destructive|black|gradient)|bg-\[#|from-|via-|to-|hover:bg-(primary|emerald|red|amber|blue)|bg-primary\/|bg-black\/)/;
const CLASS = /className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{"([^"]*)"\})/g;
const BASELINE = Number(fs.readFileSync(path.join(ROOT, "scripts/data/theme-literals-baseline.txt"), "utf8").trim());

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.some((s) => p.startsWith(path.join(ROOT, s)))) continue;
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
}
const files = []; for (const d of SCAN) walk(path.join(ROOT, d), files);
let count = 0; const perFile = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  let m;
  while ((m = CLASS.exec(src))) {
    const body = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    if (!TARGET.test(body) || /dark:|light:/.test(body) || COLORED.test(body)) continue;
    count++; perFile.set(f, (perFile.get(f) ?? 0) + 1);
  }
}
const rel = (f) => path.relative(ROOT, f);
if (count > BASELINE) {
  console.error(`[check-theme-literals] FAIL — ${count} unpaired dark-only literals, baseline ${BASELINE} (+${count - BASELINE}).`);
  console.error("[check-theme-literals] Use theme tokens (text-foreground / text-muted-foreground / bg-card / bg-background / border-border) or pair with dark:.");
  console.error("[check-theme-literals] Worst offenders:");
  for (const [f, c] of [...perFile].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.error(`  ${String(c).padStart(4)}  ${rel(f)}`);
  process.exit(1);
}
console.log(`[check-theme-literals] OK — ${count} unpaired dark-only literals across ${perFile.size} files (baseline ${BASELINE}).`);
if (count < BASELINE) console.log(`  Ratchet drop available: lower scripts/data/theme-literals-baseline.txt from ${BASELINE} to ${count}`);
