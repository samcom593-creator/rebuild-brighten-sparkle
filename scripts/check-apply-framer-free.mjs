#!/usr/bin/env node
// PL-WIB-APPLY-FRAMER (2026-10-06): no module statically reachable from
// src/pages/Apply.tsx may import framer-motion.
//
// Why this exists:
//   /apply is the recruiting funnel's one form, and Lighthouse mobile scores
//   it on a text LCP (the step-1 <h2>) whose whole cost is render delay:
//   TTFB ~460ms, render delay ~4.8s, load time 0. Every byte in the Apply
//   chunk's static closure sits in front of that heading. Apply.tsx used
//   framer-motion for a step slide and two expand-on-toggle blocks, which put
//   framer's proxy chunk + AnimatePresence (124 KB raw) into that closure, and
//   the step wrapper's initial={{ opacity: 0 }} also faded the LCP heading in
//   from invisible. Replaced with tailwindcss-animate classes, applied only
//   after the first step change, so first paint carries no entrance animation.
//   Same-server A/B, Lighthouse mobile x3 interleaved: perf median 64 -> 72,
//   LCP 5695 -> 5231ms, TBT 389 -> 236ms, transfer 570 -> 527 KB.
//
// Algorithm (same walk as check-cold-landing-sonner.mjs):
//   1. Start from src/pages/Apply.tsx
//   2. Follow static `import ... from` / `export ... from` edges only. Dynamic
//      import() and React.lazy() split into their own chunk and are allowed.
//   3. Resolve ./ and @/ to files under src/; bare specifiers end the walk
//   4. Fail if any reached file has a static edge to framer-motion
//
// The import regex is anchored at line start, so a commented-out import
// (`// import { motion } from "framer-motion"`) does not count.
//
// Fix: use tailwindcss-animate classes (animate-in fade-in slide-in-from-*),
// or move the animated piece behind lazy() so it loads after first paint.
//
// PL-WIB-APPLY-RADIX (2026-10-06) widened the forbidden set to @radix-ui,
// cmdk and vaul. Label, Select and Checkbox pulled the 163 KB vendor-radix
// chunk in front of the heading; radix controls now load through
// src/pages/apply/ApplyRadixFields.tsx (dynamic import, not followed here).
// `import type` edges are erased at build and are skipped. One edge this
// source walk cannot see is chunk grouping: `toast` from sonner shared the
// vendor-ui chunk with cmdk + vaul, which import radix, so the guard also
// asserts vite.config.ts keeps sonner out of the vendor-ui group.

import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const ROOT = path.join(repoRoot, "src/pages/Apply.tsx");
const FORBIDDEN = ["framer-motion", "@radix-ui", "cmdk", "vaul"];
// @radix-ui/react-slot is pinned into vendor-react by vite.config.ts (wave-36),
// so it does not pull vendor-radix. Any other radix package does.
const ALLOWED = new Set(["@radix-ui/react-slot"]);

const EDGE_RE = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/gm;

function resolveExt(base) {
  if (existsSync(base) && !statSync(base).isDirectory()) return base;
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    const p = path.join(base, "index" + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

function resolveSource(fromFile, source) {
  if (source.startsWith(".")) return resolveExt(path.resolve(path.dirname(fromFile), source));
  if (source.startsWith("@/")) return resolveExt(path.join(srcRoot, source.slice(2)));
  return null;
}

if (!existsSync(ROOT)) {
  console.error(`check-apply-framer-free: root ${path.relative(repoRoot, ROOT)} not found. If /apply moved, update ROOT; a guard with no root checks nothing.`);
  process.exit(1);
}

const seen = new Set();
const stack = [ROOT];
const offenders = [];
while (stack.length) {
  const file = stack.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(EDGE_RE)) {
    if (m[1]) continue; // `import type` / `export type`: erased at build
    const spec = m[2];
    const hit = !ALLOWED.has(spec) && FORBIDDEN.find((pkg) => spec === pkg || spec.startsWith(pkg + "/"));
    if (hit) {
      const line = src.slice(0, m.index).split("\n").length;
      offenders.push(`${path.relative(repoRoot, file)}:${line} (${spec})`);
      continue;
    }
    const next = resolveSource(file, spec);
    if (next && next.startsWith(srcRoot)) stack.push(next);
  }
}

const viteConfig = readFileSync(path.join(repoRoot, "vite.config.ts"), "utf8");
const uiGroup = viteConfig.match(/name:\s*"vendor-ui",[^}]*?test:\s*"([^"]+)"/);
if (!uiGroup) {
  offenders.push('vite.config.ts: vendor-ui chunk group not found; cannot prove sonner is kept out of it. Update this guard if the group was renamed.');
} else if (new RegExp(uiGroup[1].replace(/\\\\/g, "\\")).test("/node_modules/sonner/dist/index.mjs")) {
  offenders.push("vite.config.ts: vendor-ui group matches sonner; vendor-ui also holds cmdk + vaul (radix importers), so a toast() import drags vendor-radix onto /apply");
}

if (offenders.length) {
  console.error(`check-apply-framer-free: FAIL — ${offenders.length} heavy static edge(s) reachable from src/pages/Apply.tsx:`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error("Every byte in Apply's static closure delays the step-1 heading (the page's LCP). Use tailwindcss-animate classes, or lazy() the piece (radix controls go through src/pages/apply/ApplyRadixFields.tsx).");
  process.exit(1);
}
console.log(`check-apply-framer-free: OK — ${seen.size} files statically reachable from Apply.tsx, 0 framer-motion/@radix-ui/cmdk/vaul edges, sonner outside vendor-ui.`);
