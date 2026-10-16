import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Persistence-mandate guard — silent-import-graph rot detector.
//
// Ports the head-to-toe rebuild lesson: an import specifier can pass tsc
// (thanks to `moduleResolution: "bundler"` + `.tsx` filename gymnastics)
// but still 404 at Vite chunk-graph time — or vice versa — when a page
// is renamed/moved and one of the callers is missed. The bug is usually
// caught by a route smoke test AFTER the deploy, not before commit.
//
// This guard walks every src/**/*.{ts,tsx,js,jsx} file, tokenizes just
// enough to skip comments and unrelated string literals, extracts every
// static + dynamic import + re-export specifier, and verifies each
// relative (./x, ../x) OR aliased (@/x) target resolves to a file on
// disk. External packages (no leading dot / @/) are ignored.
//
// Extension resolution mirrors what Vite + tsc do in this repo:
//   - as-is
//   - + .ts / .tsx / .js / .jsx / .mjs / .cjs
//   - + /index.{ts,tsx,js,jsx,mjs,cjs}
//   - static assets: .css / .json / .svg / .png / .jpg / .jpeg / .webp / .gif / .avif / .md
//
// Exit 0 clean, 1 with a listing of every unresolved specifier and its
// call site. No supabase, no network, walks 1 tree — sub-second.
//
// GRADED ON THE GIT INDEX, NOT THE DISK (PL-WIB-INDEX-IMPORTS, 2026-10-16).
// What ships is the commit, and the commit is the index. Until this change the
// guard walked the working tree, so an import whose target existed only as an
// UNTRACKED file passed here and then failed in every clean checkout. Measured
// on 8493017d: src/App.tsx imported @/lib/legacyRedirect, the file sat untracked
// in the shared worktree, pre-commit ran this guard (App.tsx is a trigger path)
// and passed, and every Vercel production build failed for ~8.4h while the site
// kept serving the previous deploy. Now the importer list, the importer
// contents and the existence test all come from the index (`git ls-files -s` +
// `git cat-file --batch`), so the guard grades exactly the tree a commit makes.
// A target that is on disk but not in the index is named as such, with the
// `git add` that fixes it. In CI the checkout's index IS the commit, so CI and
// pre-commit now answer the same question. `--disk` restores the old operand
// (used by the proof harness to show it passes the 8493017d tree).
// supabase/functions is graded too: deploy-supabase.yml deploys from the same
// checkout, so an untracked _shared module fails the function's deploy the
// same way.

const repoRoot = path.resolve(import.meta.dirname, "..");

const TRACKED_DIRS = ["src", "supabase/functions"];

const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/;
const SKIP_FILE = /\.(test|spec|stories)\.(tsx?|jsx?)$/;

// Ordered candidate suffixes appended to a bare specifier. First hit wins.
const RESOLVE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
  "/index.mjs",
  "/index.cjs",
  ".css",
  ".json",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".md",
];

// ---- operand: the git index (default) or the working tree (--disk) ----
const FORCE_DISK = process.argv.includes("--disk");

function toRel(abs) {
  return path.relative(repoRoot, abs).split(path.sep).join("/");
}

// Returns { files: Set<rel>, read(rel) } for the index, or null when no index
// can be read (not a git checkout). Regular blobs only: a symlink's blob is
// its target path and a gitlink has no blob, so neither is read as source, but
// both still count as present.
function loadIndex() {
  let listing;
  try {
    listing = execFileSync("git", ["ls-files", "-s", "-z"], {
      cwd: repoRoot,
      maxBuffer: 256 * 1024 * 1024,
    }).toString("utf8");
  } catch {
    return null;
  }
  const files = new Set();
  const blobOf = new Map();
  for (const rec of listing.split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    const [mode, sha, stage] = rec.slice(0, tab).split(" ");
    const rel = rec.slice(tab + 1);
    files.add(rel);
    // Unmerged paths list stages 1-3; stage 0 or "ours" (2) is what a resolved
    // commit would hold. Either way the path exists.
    if (mode === "100644" || mode === "100755") {
      if (stage === "0" || stage === "2" || !blobOf.has(rel)) blobOf.set(rel, sha);
    }
  }
  return { files, blobOf };
}

// Batch-read the blobs for the importer files in one git process.
function readBlobs(index, rels) {
  const shas = rels.map((r) => index.blobOf.get(r));
  const out = execFileSync("git", ["cat-file", "--batch"], {
    cwd: repoRoot,
    input: shas.join("\n") + "\n",
    maxBuffer: 1024 * 1024 * 1024,
  });
  const contents = new Map();
  let pos = 0;
  for (let k = 0; k < rels.length; k++) {
    const nl = out.indexOf(10, pos);
    const header = out.slice(pos, nl).toString("utf8").split(" ");
    if (header[1] === "missing") throw new Error(`blob ${shas[k]} for ${rels[k]} missing from the odb`);
    const size = Number(header[2]);
    contents.set(rels[k], out.slice(nl + 1, nl + 1 + size).toString("utf8"));
    pos = nl + 1 + size + 1;
  }
  return contents;
}

const index = FORCE_DISK ? null : loadIndex();
const MODE = index ? "index" : "disk";
if (!index && !FORCE_DISK) {
  console.error(
    "check:unresolved-imports NOTE — no git index readable here; grading the working tree instead. " +
      "Untracked files cannot be told apart from committed ones in this mode.",
  );
}

function existsFile(abs) {
  if (index) return index.files.has(toRel(abs));
  return fs.existsSync(abs) && fs.statSync(abs).isFile();
}

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

function resolveSpec(spec, fromFileAbs) {
  let bareAbs;
  if (spec.startsWith("@/")) {
    bareAbs = path.join(repoRoot, "src", spec.slice(2));
  } else if (
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec === "." ||
    spec === ".."
  ) {
    bareAbs = path.resolve(path.dirname(fromFileAbs), spec);
  } else if (spec.startsWith("/")) {
    const publicCandidate = path.join(repoRoot, "public", spec);
    if (existsFile(publicCandidate)) return publicCandidate;
    return null;
  } else {
    return "EXTERNAL";
  }

  bareAbs = bareAbs.split("?")[0].split("#")[0];

  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = bareAbs + suffix;
    if (existsFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

// In index mode, a miss may still resolve on disk: the target exists but the
// commit will not contain it. That is the 8493017d failure, so name it.
function diskOnlyTarget(spec, fromFileAbs) {
  if (!index) return null;
  let bareAbs;
  if (spec.startsWith("@/")) bareAbs = path.join(repoRoot, "src", spec.slice(2));
  else if (spec.startsWith(".")) bareAbs = path.resolve(path.dirname(fromFileAbs), spec);
  else if (spec.startsWith("/")) bareAbs = path.join(repoRoot, "public", spec);
  else return null;
  bareAbs = bareAbs.split("?")[0].split("#")[0];
  for (const suffix of spec.startsWith("/") ? [""] : RESOLVE_SUFFIXES) {
    const candidate = bareAbs + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return toRel(candidate);
  }
  return null;
}

// Tokenizer that yields (specifier, offset) tuples only for real import
// contexts: `import ... from "spec"`, `import "spec"`, `import type ... from
// "spec"`, `export ... from "spec"`, and `import("spec")`. String literals
// and comments containing the word "import" or "from" are skipped because
// we only enter the specifier-collect state when the keyword appears
// OUTSIDE any string / comment.
function extractImports(src) {
  const out = [];
  const n = src.length;
  let i = 0;

  // Emit specifier iff we're at a quote and last real token was one of the
  // enter-tokens (import, from, import().
  let awaitingSpec = false;

  // Track just enough to recognize keyword tokens.
  function skipWs() {
    while (i < n) {
      const c = src[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        i++;
      } else if (c === "/" && src[i + 1] === "/") {
        while (i < n && src[i] !== "\n") i++;
      } else if (c === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
        if (i < n) i += 2;
      } else {
        return;
      }
    }
  }

  function readIdent() {
    const start = i;
    while (i < n && /[A-Za-z0-9_$]/.test(src[i])) i++;
    return src.slice(start, i);
  }

  function readString(quote) {
    const start = i + 1;
    i++;
    let hasExpr = false;
    while (i < n && src[i] !== quote) {
      if (src[i] === "\\" && i + 1 < n) {
        i += 2;
        continue;
      }
      if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
        // Template expression: skip it whole, then keep scanning to the
        // closing backtick. This used to `return null` with the cursor still
        // inside the template, so the closing backtick was read as an OPENING
        // one and every string boundary after it inverted. Measured
        // 2026-10-16: src/pages/Apply.tsx:117 (`... ${props.className ?? ""}`)
        // hid the static imports at :129-131 from this guard.
        hasExpr = true;
        i += 2;
        skipTemplateExpr();
        continue;
      }
      if (quote !== "`" && src[i] === "\n") {
        // A '…' or "…" string cannot hold a raw newline, so this quote was
        // not a string (an apostrophe in JSX text, a quote inside a regex
        // literal). Stop here and resume as code, so the damage is one line.
        return null;
      }
      i++;
    }
    if (i >= n) return null;
    const end = i;
    i++;
    if (hasExpr) return null; // a template with an expression is not a static specifier
    return { value: src.slice(start, end), offset: start };
  }

  // Skips a `${ … }` template expression (cursor just past the `${`). The
  // expression can hold strings, nested templates, comments and braces.
  function skipTemplateExpr() {
    let depth = 1;
    while (i < n) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") {
        readString(c);
        continue;
      }
      if (c === "/" && src[i + 1] === "/") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
        if (i < n) i += 2;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        i++;
        return;
      }
      i++;
    }
  }

  while (i < n) {
    const c = src[i];

    // Skip comments
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      if (i < n) i += 2;
      continue;
    }

    // Strings — consume without treating contents as tokens.
    if (c === '"' || c === "'" || c === "`") {
      if (awaitingSpec) {
        const s = readString(c);
        awaitingSpec = false;
        if (s) out.push(s);
      } else {
        readString(c);
      }
      continue;
    }

    // Identifier — check for import / from / export.
    if (/[A-Za-z_$]/.test(c)) {
      const identStart = i;
      const ident = readIdent();

      if (ident === "import") {
        // Dynamic `import(` or static `import ... from "spec"` or `import "spec"`.
        skipWs();
        if (src[i] === "(") {
          // Dynamic — next token should be a string.
          i++;
          skipWs();
          if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
            const quote = src[i];
            const s = readString(quote);
            if (s) out.push(s);
          }
          continue;
        }
        // Static — walk until `from` OR direct string (side-effect import).
        // Track parens/braces depth so a type import with complex clauses
        // doesn't confuse us.
        let staticDepth = 0;
        while (i < n) {
          skipWs();
          const sc = src[i];
          if (!sc) break;
          if (sc === '"' || sc === "'" || sc === "`") {
            // Could be either `import "spec"` (side-effect, at depth 0)
            // or a stray string. Only emit at depth 0 immediately after
            // whitespace from the initial `import`.
            const s = readString(sc);
            if (s && staticDepth === 0) out.push(s);
            // Static import statement ends here (side-effect form).
            break;
          }
          if (sc === "{" || sc === "(") {
            staticDepth++;
            i++;
            continue;
          }
          if (sc === "}" || sc === ")") {
            staticDepth = Math.max(0, staticDepth - 1);
            i++;
            continue;
          }
          if (/[A-Za-z_$]/.test(sc)) {
            const sub = readIdent();
            if (sub === "from" && staticDepth === 0) {
              skipWs();
              if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
                const s = readString(src[i]);
                if (s) out.push(s);
              }
              break;
            }
            continue;
          }
          if (sc === ";" || sc === "\n") {
            i++;
            break;
          }
          i++;
        }
        continue;
      }

      if (ident === "export") {
        // Look for `export ... from "spec"`.
        let exportDepth = 0;
        while (i < n) {
          skipWs();
          const sc = src[i];
          if (!sc) break;
          if (sc === '"' || sc === "'" || sc === "`") {
            readString(sc);
            break;
          }
          if (sc === "{" || sc === "(") {
            exportDepth++;
            i++;
            continue;
          }
          if (sc === "}" || sc === ")") {
            exportDepth = Math.max(0, exportDepth - 1);
            i++;
            continue;
          }
          if (/[A-Za-z_$]/.test(sc)) {
            const sub = readIdent();
            if (sub === "from" && exportDepth === 0) {
              skipWs();
              if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
                const s = readString(src[i]);
                if (s) out.push(s);
              }
              break;
            }
            if (sub === "class" || sub === "function" || sub === "const" ||
                sub === "let" || sub === "var" || sub === "default" ||
                sub === "async" || sub === "interface" || sub === "type" ||
                sub === "enum") {
              // Not a re-export.
              break;
            }
            continue;
          }
          if (sc === ";" || sc === "=") {
            break;
          }
          i++;
        }
        continue;
      }

      // Not import/export — move on.
      continue;
    }

    i++;
  }

  return out;
}

const inScope = (p) =>
  TRACKED_DIRS.some((d) => p === d || p.startsWith(d + "/")) &&
  !p.split("/").includes("node_modules") &&
  SOURCE_EXT.test(p) &&
  !SKIP_FILE.test(p);

const files = index
  ? [...index.blobOf.keys()].filter(inScope).sort()
  : TRACKED_DIRS.flatMap(walk).map((p) => p.split(path.sep).join("/")).filter(inScope);
const contents = index ? readBlobs(index, files) : null;

// Untracked importers are not part of the commit, so they are not graded;
// counted so a reader can see the guard knows they exist.
const untrackedImporters = index
  ? TRACKED_DIRS.flatMap(walk)
      .map((p) => p.split(path.sep).join("/"))
      .filter(inScope)
      .filter((p) => !index.files.has(p)).length
  : 0;

const violations = [];
const diskOnly = [];
let specCount = 0;

for (const rel of files) {
  const abs = path.join(repoRoot, rel);
  const content = index ? contents.get(rel) : fs.readFileSync(abs, "utf8");
  const imports = extractImports(content);
  for (const { value: spec, offset } of imports) {
    if (!spec) continue;
    if (
      spec.startsWith("virtual:") ||
      spec.startsWith("node:") ||
      spec.startsWith("data:") ||
      spec.startsWith("http:") ||
      spec.startsWith("https:")
    ) {
      continue;
    }
    specCount++;
    const resolved = resolveSpec(spec, abs);
    if (resolved === "EXTERNAL" || resolved) continue;

    const line = content.slice(0, offset).split("\n").length;
    const onDisk = diskOnlyTarget(spec, abs);
    if (onDisk) {
      diskOnly.push(onDisk);
      violations.push(
        `${rel}:${line}: import "${spec}" resolves only to ${onDisk}, which is on disk but NOT in the git index — the commit will not contain it (git add ${onDisk})`,
      );
    } else {
      violations.push(`${rel}:${line}: unresolved import "${spec}"`);
    }
  }
}

if (violations.length > 0) {
  console.error(
    "check:unresolved-imports — imports pointing at missing files:",
  );
  for (const v of violations) console.error("  " + v);
  console.error("");
  console.error(
    "Why this exists: silent import-graph rot is the #1 way a rename/move ships",
  );
  console.error(
    "a page that 404s at chunk-load time — tsc + Vite dev can miss it because",
  );
  console.error(
    "the caller is only wired on a route the dev never clicks. This guard fails",
  );
  console.error(
    "the build the moment any relative or @/ specifier stops resolving.",
  );
  console.error(
    "Fix: rename the caller, delete the dead import, or commit the missing file.",
  );
  if (diskOnly.length > 0) {
    console.error(
      `${diskOnly.length} of these resolve on disk and not in the index: a clean checkout (Vercel, CI, ` +
        "deploy-supabase) will not have them. That is how 8493017d froze production for ~8.4h.",
    );
  }
  process.exit(1);
}

console.log(
  `check:unresolved-imports OK — graded the ${MODE}: ${files.length} files scanned, ${specCount} import specifiers, 0 unresolved.` +
    (untrackedImporters ? ` (${untrackedImporters} untracked source file(s) on disk not graded: not part of the commit)` : ""),
);
