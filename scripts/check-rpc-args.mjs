#!/usr/bin/env node
// Guards the RPC analog of the class MP-345 closed for `.from()`.
//
// PostgREST resolves an RPC by function name AND parameter names. `.rpc("f", {
// p_idd: x })` against `f(p_id uuid)` is PGRST202 "Could not find the function
// in the schema cache" -- and supabase-js RESOLVES with {error} rather than
// throwing, so a call site that does not read `error` fails silently and the
// surface renders as if the function returned nothing.
//
// WHY NOTHING ELSE CATCHES THIS:
//   - tsc DOES catch it, but only on an un-cast call. Measured at the commit
//     that added this guard: 113 of 146 src/ call sites are written
//     `(supabase as any).rpc(...)` or `.rpc("name" as never, ...)`, and the cast
//     removes the check entirely. Proven on a scratch file against the repo's
//     real tsconfig: a wrong arg name with no cast is `error TS2561`; the same
//     error behind a cast, and a call to a function that does not exist at all,
//     both type-check completely clean.
//   - types.ts declares 362 functions against 556 live, so 5 names this repo
//     actually calls are absent from it -- all 5 are cast sites, which is
//     precisely why tsc is silent about them.
//   - supabase/functions is Deno and is not type-checked against types.ts at all.
//
// SCOPE: this grades CALL SITES against a committed catalog of the live
// catalog. It is deliberately not a second oracle for deployed state --
// check-function-contracts.mjs says in its own header that apex-doctor querying
// pg_proc is the authority there, and apex-doctor Check #42 grades catalog drift.
//
// This guard reports MISMATCHES, not a count. It was written against a tree with
// zero of them, so it has no baseline to ratchet: any mismatch is new.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CATALOG = path.join(__dirname, "data/rpc-catalog.json");
const ROOTS = ["src", "supabase/functions"];

// ---------------------------------------------------------------------------
// Lexer. Returns the source with comments blanked (offsets preserved) plus a
// mask marking every offset that lies INSIDE a string literal body.
//
// The mask is load-bearing, not defensive tidiness. src/data/shipped-data.ts
// documents past waves by quoting their code verbatim, so it contains the text
// `.rpc('generate_invite_token', {p_kind:'hire', ...})` inside a prose string.
// Without the mask this guard reports 8 call sites that no process ever makes --
// a token matched inside a message, which is MP-277's footnote bug and has now
// caught its own author in five separate waves.
// ---------------------------------------------------------------------------
function lex(s) {
  const out = new Array(s.length);
  const inStr = new Uint8Array(s.length);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out[i] = c;
      i++;
      while (i < s.length) {
        if (s[i] === "\\") { inStr[i] = 1; out[i] = " "; if (i + 1 < s.length) { inStr[i + 1] = 1; out[i + 1] = " "; } i += 2; continue; }
        if (s[i] === q) { out[i] = q; i++; break; }
        inStr[i] = 1;
        out[i] = s[i] === "\n" ? "\n" : s[i];
        i++;
      }
      continue;
    }
    if (c === "/" && s[i + 1] === "/") { while (i < s.length && s[i] !== "\n") { out[i] = " "; i++; } continue; }
    if (c === "/" && s[i + 1] === "*") {
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) { out[i] = s[i] === "\n" ? "\n" : " "; i++; }
      out[i] = " "; if (i + 1 < s.length) out[i + 1] = " ";
      i += 2; continue;
    }
    out[i] = c; i++;
  }
  for (let k = 0; k < out.length; k++) if (out[k] === undefined) out[k] = " ";
  return { code: out.join(""), inStr };
}

// Top-level keys of an object literal body.
//
// Only the FIRST depth-0 colon of each comma-separated segment separates a key
// from its value. A later depth-0 colon belongs to a ternary
// (`p_role: licensed ? "a" : "b"`). Reading those as keys mislabelled 14 real
// call sites as un-gradeable while this guard was being written -- which would
// have excused exactly the sites a bug is most likely to hide in.
function objectKeys(body) {
  const keys = [];
  let depth = 0, cur = "", haveKey = false;
  for (const ch of body) {
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    if (ch === "," && depth === 0) { cur = ""; haveKey = false; continue; }
    cur += ch;
    if (ch === ":" && depth === 0 && !haveKey) {
      const k = cur.slice(0, -1).trim().replace(/^['"`]|['"`]$/g, "");
      keys.push(/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : "?DYNAMIC?");
      cur = ""; haveKey = true;
    }
  }
  if (/(^|[\s,{])\.\.\./.test(body)) keys.push("?SPREAD?");
  return [...new Set(keys)].sort();
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "tests") continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) acc.push(p);
  }
  return acc;
}

const RPC = /\.rpc\(\s*['"`]([A-Za-z0-9_]+)['"`]/g;
// `.rpc("name" as never, ...)` / `(supabase as any).rpc("name", ...)`
const CAST = /^\s*as\s+(?:const|any|never|unknown|[A-Za-z0-9_.<>\[\]| ]+?)(?=\s*[,)])/;

function collect() {
  const sites = [];
  for (const root of ROOTS) {
    for (const file of walk(path.join(REPO_ROOT, root))) {
      const rel = path.relative(REPO_ROOT, file);
      const raw = fs.readFileSync(file, "utf8");
      const { code, inStr } = lex(raw);
      let m;
      RPC.lastIndex = 0;
      while ((m = RPC.exec(code)) !== null) {
        if (inStr[m.index]) continue; // prose, not a call
        const line = code.slice(0, m.index).split("\n").length;
        let j = m.index + m[0].length;
        const cm = CAST.exec(code.slice(j));
        if (cm) j += cm[0].length;
        while (j < code.length && /\s/.test(code[j])) j++;
        if (code[j] === ")") { sites.push({ rel, line, fn: m[1], keys: [], kind: "noargs" }); continue; }
        if (code[j] === ",") {
          j++;
          while (j < code.length && /\s/.test(code[j])) j++;
          if (code[j] === "{") {
            let depth = 0, k = j;
            for (; k < code.length; k++) {
              if (code[k] === "{") depth++;
              else if (code[k] === "}") { depth--; if (depth === 0) break; }
            }
            sites.push({ rel, line, fn: m[1], keys: objectKeys(code.slice(j + 1, k)), kind: "obj" });
          } else sites.push({ rel, line, fn: m[1], keys: null, kind: "nonliteral" });
        } else sites.push({ rel, line, fn: m[1], keys: null, kind: "unparsed" });
      }
    }
  }
  return sites;
}

// --- grade -----------------------------------------------------------------
if (!fs.existsSync(CATALOG)) {
  console.error(`FAIL: no catalog at ${path.relative(REPO_ROOT, CATALOG)}. Run: bash scripts/refresh-rpc-catalog.sh`);
  process.exit(1);
}
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const fns = catalog.functions || {};
// An empty or truncated catalog would let this exit 0 while grading nothing --
// the 465 fake-success rows in a JSON file.
if (Object.keys(fns).length < 300) {
  console.error(`FAIL: catalog has ${Object.keys(fns).length} functions (expected >=300). Refusing to grade against a truncated snapshot.`);
  process.exit(1);
}

const sites = collect();
const mismatches = [], unprovable = [];

for (const s of sites) {
  if (s.kind === "nonliteral" || s.kind === "unparsed") { unprovable.push([s, s.kind]); continue; }
  const keys = new Set(s.keys || []);
  if (keys.has("?SPREAD?") || keys.has("?DYNAMIC?")) { unprovable.push([s, "computed argument keys"]); continue; }
  const overloads = fns[s.fn];
  if (!overloads) { mismatches.push([s, `no function named "${s.fn}" in schema public`]); continue; }
  // An overload with positional-only params cannot be addressed by name; a
  // caller passing any key can never resolve to it, and a caller passing none
  // always can. Recorded, never silently treated as a match.
  let ok = false;
  const why = [];
  for (const o of overloads) {
    if (o.unnamed && keys.size > 0) { why.push(`sig(${o.raw || "<no args>"}) has positional-only params`); continue; }
    const extra = [...keys].filter((k) => !o.all.includes(k));
    const missing = o.required.filter((r) => !keys.has(r));
    if (extra.length === 0 && missing.length === 0) { ok = true; break; }
    why.push(`sig(${o.raw || "<no args>"}) unknown=[${extra.join(",")}] missing_required=[${missing.join(",")}]`);
  }
  if (!ok) mismatches.push([s, why.join(" || ")]);
}

const graded = sites.length - unprovable.length;
if (mismatches.length > 0) {
  console.error(`FAIL: ${mismatches.length} .rpc() call site(s) cannot resolve against the live function catalog.`);
  console.error("PostgREST returns PGRST202 and supabase-js RESOLVES with {error} — these fail silently at runtime.\n");
  for (const [s, w] of mismatches) {
    console.error(`  ${s.rel}:${s.line}  ${s.fn}({${(s.keys || []).join(", ")}})`);
    console.error(`      ${w}`);
  }
  console.error(`\nIf the function changed, refresh the snapshot: bash scripts/refresh-rpc-catalog.sh`);
  process.exit(1);
}

console.log(`OK  ${graded} .rpc() call site(s) resolve against ${Object.keys(fns).length} live functions; ${unprovable.length} unprovable (reported, never counted as passing).`);
for (const [s, w] of unprovable) console.log(`    unprovable ${s.rel}:${s.line} ${s.fn} — ${w}`);
