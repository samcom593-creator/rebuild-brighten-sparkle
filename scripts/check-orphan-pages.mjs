import { stripComments } from "./lib/strip-comments.mjs";
import fs from "node:fs";
import path from "node:path";
import { splitUncommittable, noticeBanner } from "./lib/committable.mjs";

// Persistence-mandate guard — orphan-page (dead route) detector.
//
// Every file under src/pages/**/*.tsx must either:
//   1. Be reached via a real import — either statically or lazily — from
//      src/App.tsx (a top-level route), OR from any other page/component
//      that itself is wired (nested composition, e.g. Dashboard.tsx
//      renders <ManagerCommandView />, Apply.tsx renders
//      <QuickQualifyStep />). We approximate this by requiring that
//      SOMETHING under src/ imports the page. The transitive close-back
//      to App.tsx is what the unresolved-imports + sidebar-routes guards
//      cover together; this guard specifically kills leaves nothing
//      touches.
//   2. Carry an intentional-orphan marker comment in the file header:
//        // intentionally-orphan:<reason>
//      Legit cases: WIP scaffolds pinned for a future release, page
//      variants opened only via feature-flag branch, dev-only surfaces
//      compiled out of prod bundle.
//
// Why: an orphan page rots. It stays in git as "we support this," ships
// zero JS to prod (no importer -> no chunk), but its dependencies drift
// out from under it until the eventual re-wire ships broken code and
// nobody remembers what it was for. Kill the graveyard at commit time.
//
// Exit 0 clean, 1 with a listing of every orphan page + resolutions.

const repoRoot = path.resolve(import.meta.dirname, "..");

const PAGES_DIR = "src/pages";
const SRC_DIR = "src";

const MARKER = /intentionally-orphan:/;
const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/;
const SKIP_FILE = /\.(test|spec|stories)\.(tsx?|jsx?)$/;

function walk(rel) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [rel];
  const out = [];
  for (const entry of fs.readdirSync(abs)) {
    if (entry === "node_modules" || entry === ".git") continue;
    out.push(...walk(path.join(rel, entry)));
  }
  return out;
}

// Static + dynamic + re-export specifiers that COULD point at a page.
const IMPORT_PATTERNS = [
  /(?:^|[\s;{}()])import\s+(?:type\s+)?(?:[^"'`;]+?\s+from\s+)?["']((?:@\/|\.\/|\.\.\/)[^"'`]+)["']/g,
  /(?:^|[\s;{}()])export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+["']((?:@\/|\.\/|\.\.\/)[^"'`]+)["']/g,
  /\bimport\s*\(\s*["']((?:@\/|\.\/|\.\.\/)[^"'`]+)["']\s*[),]/g,
];

// Strip comments before scanning so a `// 2026-06-18 cruft strip:
// ManagerCommandView's lazy() entry was retired` doesn't count as an
// import. Preserves offsets — replaces comment bodies with spaces so
// downstream regex remains simple.

function normalizeSpec(spec, fromAbs) {
  let bare;
  if (spec.startsWith("@/")) {
    bare = path.join(repoRoot, "src", spec.slice(2));
  } else {
    bare = path.resolve(path.dirname(fromAbs), spec);
  }
  bare = bare.split("?")[0].split("#")[0];
  return path.relative(repoRoot, bare).replace(/\\/g, "/");
}

// Build the set of "wired" targets — anything imported by ANY .ts/.tsx
// file under src/ (excluding page files' self-imports isn't needed
// because a page can't import itself). Then any page whose normalized
// on-disk path (without extension) appears in that set is wired.
const wired = new Set();

const srcFiles = walk(SRC_DIR)
  .filter((p) => SOURCE_EXT.test(p))
  .filter((p) => !SKIP_FILE.test(p));

for (const rel of srcFiles) {
  const abs = path.join(repoRoot, rel);
  const src = stripComments(fs.readFileSync(abs, "utf8"));
  for (const pat of IMPORT_PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(src)) !== null) {
      wired.add(normalizeSpec(m[1], abs));
    }
  }
}

const pageFiles = walk(PAGES_DIR)
  .filter((p) => p.endsWith(".tsx"))
  .filter((p) => !SKIP_FILE.test(p));

const orphans = [];

for (const rel of pageFiles) {
  const base = path.basename(rel);
  if (base === "index.ts" || base === "index.tsx") continue;

  const withoutExt = rel.replace(/\.tsx$/, "");
  if (wired.has(withoutExt) || wired.has(rel)) continue;

  // Marker check — first 30 lines.
  const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
  const head = src.split("\n").slice(0, 30).join("\n");
  if (MARKER.test(head)) continue;

  orphans.push(rel);
}

// MP-472. This box runs several workers against ONE checkout and this guard
// walks the working tree, so an untracked, unstaged page — another worker
// mid-wave — was blocking every other worker's commit. It blocked this wave's
// own commit over src/pages/RecoveryCommand.tsx, a file this wave never staged.
// Its sibling check:supabase-relation-types already splits exactly this way
// (MP-457), and MP-403 moved a guard's verdict off the working tree onto the
// index for the same reason; the two escapes otherwise are `git add -A`
// (absorption, this environment's documented failure) and --no-verify.
//
// Coverage is not narrowed: a new page is graded the moment it is staged, and
// tracked pages are graded always. Findings in uncommittable files are still
// PRINTED as a non-voting notice — dropping another worker's real orphan
// silently would be the fake-success disease in a politeness costume.
// MP-wib 2026-10-09. The page check above scans src/pages only, so a
// COMPONENT, hook or lib module that lost its last importer was invisible.
// Measured the day this landed: 43 such modules (~5k lines) in src/components,
// src/hooks and src/lib, and they were still being edited. 48b7c132 (the
// site-wide readability pass) and c774b147 (production copy fixes) both changed
// files no page renders, and check-metric-truth, check-supabase-relation-types
// and several unit tests grade some of them. That work never reaches a user.
//
// Graded BY NAME against a shrink-only baseline, not by count: a count floor
// is fungible (MP-356), so deleting one old orphan would buy room for a new
// one. Two ways to fail:
//   * a module with no importer that is not on the list (a new dead module)
//   * a listed module that is wired again or deleted (take it off the list,
//     so the list only ever names files that are really dead)
const MODULE_DIRS = ["src/components", "src/hooks", "src/lib"];
const MODULE_BASELINE = "scripts/data/orphan-modules-baseline.json";

const moduleFiles = MODULE_DIRS.flatMap((d) => walk(d))
  .filter((p) => /\.tsx?$/.test(p) && !p.endsWith(".d.ts"))
  .filter((p) => !SKIP_FILE.test(p));

const moduleOrphans = [];
for (const rel of moduleFiles) {
  const base = path.basename(rel);
  if (base === "index.ts" || base === "index.tsx") continue;
  const withoutExt = rel.replace(/\.tsx?$/, "");
  if (wired.has(withoutExt) || wired.has(rel)) continue;
  const head = fs.readFileSync(path.join(repoRoot, rel), "utf8").split("\n").slice(0, 30).join("\n");
  if (MARKER.test(head)) continue;
  moduleOrphans.push(rel);
}

const baselineList = JSON.parse(fs.readFileSync(path.join(repoRoot, MODULE_BASELINE), "utf8")).files;
if (!Array.isArray(baselineList) || baselineList.some((f) => typeof f !== "string")) {
  console.error(`check:orphan-pages — ${MODULE_BASELINE} has no string array "files"; refusing to grade against it.`);
  process.exit(1);
}
const baselineSet = new Set(baselineList);
const orphanSet = new Set(moduleOrphans);
const [newModuleOrphans, moduleNotices] = splitUncommittable(
  moduleOrphans.filter((rel) => !baselineSet.has(rel)),
  (rel) => rel,
);
const staleBaseline = baselineList.filter((rel) => !orphanSet.has(rel));

if (moduleNotices.length > 0) {
  console.log(noticeBanner(moduleNotices.length));
  for (const rel of moduleNotices) console.log("    " + rel);
}

let moduleFailed = false;
if (newModuleOrphans.length > 0) {
  moduleFailed = true;
  console.error("check:orphan-pages — modules under src/components, src/hooks or src/lib with no importer in src/:");
  for (const rel of newModuleOrphans) console.error("  " + rel);
  console.error("  Nothing renders or calls them, so edits to them never reach a user. Import it where it is");
  console.error("  used, delete it, or add `// intentionally-orphan:<reason>` in its first 30 lines.");
  console.error(`  Do not add it to ${MODULE_BASELINE}: that list only shrinks.`);
}
if (staleBaseline.length > 0) {
  moduleFailed = true;
  console.error(`check:orphan-pages — ${MODULE_BASELINE} lists modules that are no longer dead (wired again or deleted):`);
  for (const rel of staleBaseline) console.error("  " + rel);
  console.error("  Remove them from the list so it keeps naming only real orphans.");
}

const [gradedOrphans, orphanNotices] = splitUncommittable(orphans, (rel) => rel);

if (orphanNotices.length > 0) {
  console.log(noticeBanner(orphanNotices.length));
  for (const rel of orphanNotices) console.log("    " + rel);
}

if (gradedOrphans.length > 0) {
  console.error(
    "check:orphan-pages — page files with no importer anywhere in src/ and no orphan marker:",
  );
  for (const rel of gradedOrphans) console.error("  " + rel);
  console.error("");
  console.error(
    "Why this exists: an orphan page rots — it stays in git, but has zero",
  );
  console.error(
    "callers. Its dependencies drift until the eventual re-wire ships broken",
  );
  console.error("code. Fix one of three ways:");
  console.error(
    "  1. Add a <Route path=\"...\" element={<PageName />} /> in src/App.tsx",
  );
  console.error(
    "     (or import + render from a page that already has a Route).",
  );
  console.error("  2. Delete the page file if it's dead.");
  console.error(
    "  3. Add `// intentionally-orphan:<reason>` in the first 30 lines if it's",
  );
  console.error("     a pinned WIP scaffold or feature-flag-only variant.");
  process.exit(1);
}

if (moduleFailed) process.exit(1);

console.log(
  `check:orphan-pages OK — ${pageFiles.length} pages scanned, 0 orphaned; ` +
    `${moduleFiles.length} modules scanned, ${moduleOrphans.length} dead and all on the shrink-only list.`,
);
