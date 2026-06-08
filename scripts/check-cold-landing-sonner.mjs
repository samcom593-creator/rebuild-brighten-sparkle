#!/usr/bin/env node
// wave-37 (2026-06-08): pre-commit guard against static sonner imports in any
// module reachable from src/pages/Index.tsx via the STATIC import graph.
//
// Why this exists:
//   vendor-ui (where vite.config.ts groups sonner/cmdk/vaul/embla) statically
//   imports vendor-radix. So any cold-landing-reachable static edge into
//   `sonner` drags 22 KB gz vendor-ui + 47 KB gz vendor-radix onto the
//   cold-landing transfer list — even though toast() never fires during
//   first paint. Wave-37 migrated ApexLeadsSection + InstagramGrowthSection
//   to @/shared/ui/lazyToast; this guard prevents the next landing-eager
//   component from re-shipping the regression.
//
// Algorithm:
//   1. Start from src/pages/Index.tsx + src/App.tsx (both reach cold landing)
//   2. Parse static imports (NOT dynamic import() or React.lazy())
//   3. Resolve @/ alias → src/ and recurse on local files only (node_modules
//      cuts the walk)
//   4. At each node, fail if `from "sonner"` appears outside a dynamic import
//
// Fix: `import { toast } from "@/shared/ui/lazyToast"` for any cold-landing
// reachable file. Sonner direct imports are still fine in dashboard/admin
// routes (they sit behind AuthenticatedShell lazy + their own lazy() chunks).

import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(repoRoot, "src");

// Roots that are STATICALLY reachable on cold landing /.
// - Index.tsx: rendered by the literal "/" route
// - App.tsx: the root that mounts Index + all global providers
const ROOTS = ["src/pages/Index.tsx", "src/App.tsx"].map((p) => path.join(repoRoot, p));

// Static `import ... from "X"` — NOT dynamic import("X").
// Matches: `import x from "X"`, `import { a, b } from "X"`, `import * as x from "X"`,
// `import "X"`. Captures the source string in group 1 (single or double quote).
const IMPORT_RE = /^\s*import\s+(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"];?\s*$/gm;

// Resolve an import source string to an absolute on-disk path. Returns null
// if it's a node_module / non-local / not-resolvable file.
function resolveSource(fromFile, source) {
  if (source.startsWith(".")) {
    const base = path.resolve(path.dirname(fromFile), source);
    return resolveExt(base);
  }
  if (source.startsWith("@/")) {
    const base = path.join(srcRoot, source.slice(2));
    return resolveExt(base);
  }
  return null; // bare specifier (node_modules) — not part of our static graph walk
}

function resolveExt(base) {
  if (existsSync(base) && !statSync(base).isDirectory()) return base;
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    const p = base + ext;
    if (existsSync(p)) return p;
  }
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    const p = path.join(base, "index" + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

const visited = new Set();
const offenders = []; // { file, line, importerChain }

function walk(file, chain) {
  if (!file || visited.has(file)) return;
  visited.add(file);
  const text = readFileSync(file, "utf-8");
  IMPORT_RE.lastIndex = 0;
  const lines = text.split("\n");
  // Detect static `from "sonner"` first — fail if present.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*import\s+(?:[^'";]+\s+from\s+)?['"]sonner['"];?\s*$/);
    if (m) {
      offenders.push({ file: path.relative(repoRoot, file), line: i + 1, chain: [...chain, file] });
    }
  }
  // Recurse on local static imports.
  let mm;
  while ((mm = IMPORT_RE.exec(text)) !== null) {
    const src = mm[1];
    if (src === "sonner") continue; // already flagged above; no need to recurse into node_modules
    const resolved = resolveSource(file, src);
    if (resolved) walk(resolved, [...chain, file]);
  }
}

for (const root of ROOTS) walk(root, []);

if (offenders.length > 0) {
  console.error("✗ check-cold-landing-sonner FAILED — sonner is statically imported by cold-landing-reachable code.");
  console.error("  This drags vendor-ui (22 KB gz) + vendor-radix (47 KB gz) onto every cold landing transfer.");
  console.error("");
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}`);
    console.error(`    static-import chain (root → leaf):`);
    for (let i = 0; i < o.chain.length; i++) {
      console.error(`      ${"  ".repeat(i)}${path.relative(repoRoot, o.chain[i])}`);
    }
    console.error("");
  }
  console.error("  Fix: replace `import { toast } from \"sonner\"` with");
  console.error("       `import { toast } from \"@/shared/ui/lazyToast\"`.");
  console.error("       Same surface (toast.info/error/success/warning/message); returns Promise<id>.");
  console.error("       The 5 callers in cold-landing files all ignore the id, so the async wrap is invisible.");
  process.exit(1);
}

console.log(`✓ check-cold-landing-sonner OK — ${visited.size} cold-landing-reachable files scanned, zero static sonner imports.`);
