import fs from "node:fs";
import path from "node:path";

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
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    // Line comment
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    // Block comment
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    // String literal — copy through, respecting escapes so a `//` inside
    // a string doesn't get mis-eaten.
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") {
          out += src[i];
          if (i + 1 < n) {
            out += src[i + 1];
            i += 2;
            continue;
          }
        }
        out += src[i];
        i++;
      }
      if (i < n) {
        out += src[i];
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

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

if (orphans.length > 0) {
  console.error(
    "check:orphan-pages — page files with no importer anywhere in src/ and no orphan marker:",
  );
  for (const rel of orphans) console.error("  " + rel);
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

console.log(
  `check:orphan-pages OK — ${pageFiles.length} pages scanned, 0 orphaned.`,
);
