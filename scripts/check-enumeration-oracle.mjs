#!/usr/bin/env node
// check-enumeration-oracle — MP-453 (2026-09-06)
//
// THE BUG THIS EXISTS FOR:
// supabase/functions/send-password-reset is PUBLIC BY DESIGN — Login.tsx's
// forgot-password and MagicLogin.tsx's resend both call it with no session, and
// the reset link always mails to the address that OWNS the account rather than
// to the caller. MP-452 correctly left it ungated for that reason. But it
// answered DIFFERENTLY depending on whether the address owned an account:
//
//   no account  -> {"success":true,"message":"If an account exists, ..."}
//   an account  -> {"success":true}
//
// so the mere PRESENCE OF THE `message` FIELD told any stranger, with no
// credential, whether a given address has an APEX login — and every hit on a
// real address also mailed that person. The file's own comment said the
// response was "deliberately IDENTICAL in all three cases"; it was identical
// across the three FAILURE paths and different on success, one branch over.
// A comment is not a guard.
//
// Proven on live prod 2026-09-06 rather than argued: a POST with NO auth header
// for an absent address returned the message form, and auth.admin.generateLink
// answers 200 for a real address and 404 user_not_found for an absent one,
// which is exactly the branch predicate the response shape follows.
//
// THE PROPERTY, STATED ONCE:
//   A function that adopts the "If an account exists" idiom is promising its
//   caller that the answer does not depend on whether the account exists.
//   Every success body it can emit must therefore carry the same `message`
//   field. A success body without `message` breaks that promise.
//
// SCOPE IS THE IDIOM, NOT THE FILE. Keying on send-password-reset by name would
// grade one instance; keying on the idiom means the next function that adopts
// it is graded from its first commit, which is the failure MP-345 recorded
// (a sweep that stops at the instance you noticed).
//
// THE CONTRACT IS ABSOLUTE, NOT A COUNT: deliberately no numeric baseline.
// MP-356/357 proved a count-only floor is fungible — a real regression sits red
// until an unrelated pay-down launders it green.
//
// WHAT THIS GUARD DOES NOT CLAIM. It grades the RESPONSE BODY only. A timing
// side channel remains: the account-exists path calls Resend and the absent
// path returns after a 404, so the two differ in latency. That channel was not
// sized, because sizing it means mailing a real person. It is named here rather
// than quietly folded into "enumeration is fixed".

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const FUNCTIONS_DIR = "supabase/functions";
const IDIOM = "If an account exists";

// Strip comments WITHOUT blanking string bodies. MP-277 shipped a scanner that
// counted a call named inside a CODE COMMENT, and its first fix also blanked
// string literals, which would have made every site unreadable. Both directions
// are wrong, so this walks the source once and tracks which it is inside.
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let quote = null;      // ' " or ` when inside a string
  let depth = 0;         // ${ } nesting inside a template literal
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (quote) {
      if (c === "\\") { out += c + (c2 ?? ""); i += 2; continue; }
      if (quote === "`" && c === "$" && c2 === "{") { depth++; out += "${"; i += 2; continue; }
      if (quote === "`" && c === "}" && depth > 0) { depth--; out += c; i++; continue; }
      if (c === quote && depth === 0) { quote = null; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && c2 === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

// Extract the balanced object literal that starts at the '{' at or after `from`.
function objectAt(src, from) {
  const start = src.indexOf("{", from);
  if (start === -1) return null;
  let d = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") d++;
    else if (src[i] === "}") { d--; if (d === 0) return src.slice(start, i + 1); }
  }
  return null;
}

const violations = [];
const passing = [];
let scanned = 0;

const dirs = existsSync(FUNCTIONS_DIR)
  ? readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
      .map((d) => d.name)
      .sort()
  : [];

for (const name of dirs) {
  const file = join(FUNCTIONS_DIR, name, "index.ts");
  if (!existsSync(file)) continue;
  const raw = readFileSync(file, "utf8");
  const code = stripComments(raw);
  // The idiom must appear in real CODE, not only in a comment explaining it —
  // otherwise this very guard's own prose would enrol files it never governs.
  if (!code.includes(IDIOM)) continue;
  scanned++;

  const bad = [];
  let idx = 0;
  while ((idx = code.indexOf("JSON.stringify(", idx)) !== -1) {
    const obj = objectAt(code, idx + "JSON.stringify(".length - 1);
    idx += "JSON.stringify(".length;
    if (!obj) continue;
    if (!/\bsuccess\s*:\s*true\b/.test(obj)) continue;   // not a success body
    if (/\bmessage\b/.test(obj)) continue;               // carries the uniform field
    const line = code.slice(0, code.indexOf(obj)).split("\n").length;
    bad.push({ line, snippet: obj.replace(/\s+/g, " ").slice(0, 80) });
  }

  if (bad.length > 0) violations.push({ name, file, bad });
  else passing.push(name);
}

if (violations.length > 0) {
  console.error("FAIL enumeration-oracle: a function using the \"If an account exists\" idiom emits a success");
  console.error("body WITHOUT a `message` field, so the shape of the answer reveals whether the account exists.");
  console.error("");
  for (const v of violations) {
    for (const b of v.bad) {
      console.error(`  ${v.file}:${b.line}`);
      console.error(`    ${b.snippet}`);
    }
  }
  console.error("");
  console.error("FIX: return the same body on every account-dependent outcome — success, not-found, ambiguous,");
  console.error("and a failed send alike. Route them all through one helper so the shapes cannot drift apart.");
  console.error("Do NOT 'fix' this by deleting the idiom string: an endpoint that answers honestly about which");
  console.error("addresses own an account is the bug, not the wording.");
  process.exit(1);
}

if (scanned === 0) {
  console.error("FAIL enumeration-oracle: no function uses the \"If an account exists\" idiom.");
  console.error("send-password-reset is expected to. A guard that grades nothing must not report green (MP-399).");
  process.exit(1);
}

console.log(`ok enumeration-oracle: ${scanned} function(s) use the silent-ok idiom; every success body they emit carries \`message\``);
for (const p of passing) console.log(`  - supabase/functions/${p}/index.ts`);
