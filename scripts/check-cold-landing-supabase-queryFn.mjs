#!/usr/bin/env node
// wave-44 (2026-06-08): pre-commit guard against cold-landing-reachable files
// that fire useQuery sync-on-mount with a queryFn that dynamic-imports
// `@/integrations/supabase/client` and DON'T gate on useInteractionGate.
//
// Why this exists:
//   Wave-42 killed every static `import { supabase }` in cold-landing chunks
//   but vendor-supabase still transferred 45 KB on cold landing because
//   CTASection + CareerPathwaySection both called useQuery on mount with a
//   queryFn that did `await import("@/integrations/supabase/client")`. React
//   Query fires queryFn within ~16ms of mount, the dynamic import resolves
//   vendor-supabase inside Lighthouse's measurement window, the audit
//   captures it. Wave-43 fixed that exact instance by adding useInteractionGate
//   to both. This guard prevents the next landing-eager component (or refactor
//   touching an existing one) from re-shipping the regression.
//
// Algorithm:
//   1. Start from src/pages/Index.tsx + src/App.tsx (cold-landing roots)
//   2. Walk static import graph (NOT through dynamic import() or React.lazy)
//   3. At each node, if file contains BOTH:
//        - useQuery( or useSuspenseQuery( or useQueries(
//        - import("@/integrations/supabase/client"
//      AND does NOT import useInteractionGate
//      → FAIL with the import chain + fix instruction.
//
// Override: any file that genuinely needs to fire on mount (e.g. server-side
// rendered + hydrated + cached upstream) can opt out by adding the literal
// comment marker `cold-landing-supabase-queryFn-allow` somewhere in the file.

import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(repoRoot, "src");

const ROOTS = ["src/pages/Index.tsx", "src/App.tsx"].map((p) => path.join(repoRoot, p));

const IMPORT_RE = /^\s*import\s+(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"];?\s*$/gm;

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

function resolveSource(fromFile, source) {
  if (source.startsWith(".")) return resolveExt(path.resolve(path.dirname(fromFile), source));
  if (source.startsWith("@/")) return resolveExt(path.join(srcRoot, source.slice(2)));
  return null;
}

const USE_QUERY_RE = /\b(useQuery|useSuspenseQuery|useQueries)\s*\(/;
const DYNAMIC_SUPABASE_RE = /import\s*\(\s*['"]@\/integrations\/supabase\/client['"]/;
const INTERACTION_GATE_IMPORT_RE = /from\s+['"]@\/shared\/hooks\/useInteractionGate['"]/;
const OPT_OUT_MARKER = "cold-landing-supabase-queryFn-allow";

const visited = new Set();
const offenders = [];

function walk(file, chain) {
  if (!file || visited.has(file)) return;
  visited.add(file);
  const text = readFileSync(file, "utf-8");

  const hasUseQuery = USE_QUERY_RE.test(text);
  const hasDynamicSupabase = DYNAMIC_SUPABASE_RE.test(text);
  const hasInteractionGate = INTERACTION_GATE_IMPORT_RE.test(text);
  const optOut = text.includes(OPT_OUT_MARKER);

  if (hasUseQuery && hasDynamicSupabase && !hasInteractionGate && !optOut) {
    offenders.push({
      file: path.relative(repoRoot, file),
      chain: [...chain, file].map((c) => path.relative(repoRoot, c)),
    });
  }

  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(text)) !== null) {
    const r = resolveSource(file, m[1]);
    if (r) walk(r, [...chain, file]);
  }
}

for (const root of ROOTS) walk(root, []);

if (offenders.length > 0) {
  console.error("✗ check-cold-landing-supabase-queryFn FAILED — cold-landing-reachable file fires useQuery on mount with supabase dynamic-import but does NOT gate on useInteractionGate.");
  console.error("  This drags vendor-supabase (45 KB gz) onto every cold landing transfer log inside Lighthouse's audit window.");
  console.error("");
  for (const o of offenders) {
    console.error(`  ${o.file}`);
    console.error(`    static-import chain (root → leaf):`);
    for (let i = 0; i < o.chain.length; i++) {
      console.error(`      ${"  ".repeat(i)}${o.chain[i]}`);
    }
    console.error("");
  }
  console.error("  Fix (pick one):");
  console.error("    1. Add `import { useInteractionGate } from \"@/shared/hooks/useInteractionGate\"`");
  console.error("       call `const gateOpen = useInteractionGate()` and pass `enabled: gateOpen` to useQuery.");
  console.error("       See src/components/landing/CTASection.tsx for the wave-43 pattern.");
  console.error("    2. If the query genuinely must fire on mount and the first paint depends on its result,");
  console.error("       add the comment marker `cold-landing-supabase-queryFn-allow` somewhere in the file");
  console.error("       and document the reason inline.");
  process.exit(1);
}

console.log(`✓ check-cold-landing-supabase-queryFn OK — ${visited.size} cold-landing-reachable files scanned, zero ungated useQuery+supabase-dynamic-import combos.`);
