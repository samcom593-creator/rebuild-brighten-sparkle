import fs from "node:fs";
import path from "node:path";

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

const repoRoot = path.resolve(import.meta.dirname, "..");

const TRACKED_DIRS = ["src"];

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
    if (fs.existsSync(publicCandidate)) return publicCandidate;
    return null;
  } else {
    return "EXTERNAL";
  }

  bareAbs = bareAbs.split("?")[0].split("#")[0];

  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = bareAbs + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
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
    while (i < n && src[i] !== quote) {
      if (src[i] === "\\" && i + 1 < n) {
        i += 2;
        continue;
      }
      if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
        // Template with expression — bail on capture.
        return null;
      }
      i++;
    }
    if (i >= n) return null;
    const end = i;
    i++;
    return { value: src.slice(start, end), offset: start };
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

const files = TRACKED_DIRS
  .flatMap(walk)
  .filter((p) => SOURCE_EXT.test(p))
  .filter((p) => !SKIP_FILE.test(p));

const violations = [];
let specCount = 0;

for (const rel of files) {
  const abs = path.join(repoRoot, rel);
  const content = fs.readFileSync(abs, "utf8");
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
    violations.push(`${rel}:${line}: unresolved import "${spec}"`);
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
  process.exit(1);
}

console.log(
  `check:unresolved-imports OK — ${files.length} files scanned, ${specCount} import specifiers, 0 unresolved.`,
);
