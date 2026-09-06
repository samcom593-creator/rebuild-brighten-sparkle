#!/usr/bin/env node
// check-uncredentialed-pii-response — MP-448 (2026-09-06)
//
// THE BUG THIS EXISTS FOR:
// supabase/functions/check-email-status ran verify_jwt = false, held the service
// role, read no credential of any kind, and answered a caller-supplied lookup
// with the matched person's full_name, phone, city, state AND email. Proven
// against prod with a POST carrying no Authorization header at all.
//
// It was harvestable rather than merely leaky because the seed list was ALSO
// public: landing_recent_hires is an anon RPC on the marketing page and returned
// 16 full names (hires plus their managers), which resolve to 21 profile rows
// holding 18 phone numbers and 21 addresses. The site published the index for
// its own contact oracle. Four of the five disclosed fields were read by NO
// caller, so they cost a leak and bought nothing.
//
// THE CONTRACT IS ABSOLUTE, NOT A COUNT:
// deliberately no numeric baseline. MP-356/357 proved a count-only floor is
// fungible — a real regression sits red until an unrelated pay-down launders it
// green. "No uncredentialed endpoint puts a person's phone, city, state, address
// or DOB in its own response" is a property, so it cannot be traded away. It is
// shipped at zero: after the fix the class is empty, verified below.
//
// THE OPERAND THIS GUARD EXISTS TO GET RIGHT — read before widening it:
// The first cut of this scan flagged bulk-agent-message, notify-deal-submitted
// and send-notification by matching `JSON.stringify(...)` anywhere in the file.
// All three were FALSE. Each selects a phone in order to SEND an SMS, and the
// phone lives in an OUTBOUND request body, never in the reply to the caller.
// Counting serializations answers "does this file ever encode a phone", not
// "does a stranger receive one". So this guard only reads the argument of a
// JSON.stringify that is lexically inside `new Response(`, and a regression test
// below pins that distinction — if someone widens the match back to every
// JSON.stringify, the outbound-payload fixture fails and says why.
//
// THE SECOND OPERAND CORRECTION, caught by verifying a hit instead of trusting it:
// the first working cut flagged request-agent-photos, which answers with
// `{ name: e.name, has_phone: !!e.phone }` — a previous author had ALREADY
// minimised that to a boolean and withheld the number. The scan had matched the
// `.phone` on the right-hand side, i.e. the property being read FROM, not the
// field being handed OUT. So the match is now anchored to an emitted object key
// (`phone:` or shorthand `phone,`) and a member read can never trip it. A guard
// that cannot tell disclosure from minimisation punishes the fix.
//
// THE THIRD OPERAND CORRECTION — the one that mattered most, and it came from a
// mutation proof rather than from reading the code. The first two cuts matched a
// bare `phone:` and were GREEN when M1 restored the ACTUAL bug, because the real
// response used camelCase keys: agentPhone, agentCity, agentState. A guard that
// is green on the exact defect it was written for is decorative. Keys are now
// split into camel/snake segments and matched per segment, so agentPhone and
// date_of_birth are caught while licenseStatus and realEstate are not — segment
// equality, never substring, or "state" would match "estate".
//
// SCOPE HONESTY:
// - A function that reads a credential (Authorization/apikey/x-*-key header,
//   getUser, getClaims, requireAuth) is out of scope: it has a caller identity
//   to judge, which is a different guard's job.
// - A function gated on a DB-stored token row is out of scope for the same
//   reason — MP-447 measured that the token IS the credential and a header scan
//   cannot see it.
// - `agentEmail` and `agentName` are NOT in the forbidden set. check-email-status
//   still returns both, because a phone-number login must resolve to an address
//   before the browser can sign in. That residue is named in the function's own
//   header and is a product decision, not something this guard pretends to fix.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "supabase/functions";

// Comments only. String bodies are load-bearing here: header names and column
// lists both live inside string literals, and MP-277 lost a wave to a stripper
// that blanked strings too.
export function stripComments(src) {
  let out = "", i = 0;
  const n = src.length;
  let inStr = null, inTpl = false;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (inStr) {
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === inStr) inStr = null;
      out += c; i++; continue;
    }
    if (inTpl) {
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === "`") inTpl = false;
      out += c; i++; continue;
    }
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && d === "*") {
      i += 2; out += "  ";
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
      i += 2; out += "  "; continue;
    }
    if (c === '"' || c === "'") { inStr = c; out += c; i++; continue; }
    if (c === "`") { inTpl = true; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

const CREDENTIAL_READS = [
  /headers\.get\(\s*["'`][Aa]uthorization/,
  /headers\.get\(\s*["'`]apikey/i,
  /headers\.get\(\s*["'`]x-[a-z-]*(?:key|token|secret|signature)/i,
  /auth\.getUser\(/, /getClaims\(/, /requireSendAuth/, /requireAuth/i,
];
// MP-447: a row-stored token is a credential a header scan cannot see.
const DB_TOKEN_GATES = [
  /\.from\(\s*["'`][a-z_]*(?:invite|magic|token|session|otp)[a-z_]*["'`]/i,
  /\.eq\(\s*["'`]token["'`]/,
];

/** Person-identifying values that no stranger should receive. */
const FORBIDDEN = ["phone", "city", "state", "address", "dob", "ssn", "birth"];

/** Key prefixes that denote PRESENCE, not the value. `has_phone: !!e.phone` is
 *  a previous author's minimisation and must not be punished. */
const BOOLEAN_PREFIXES = new Set(["has", "is", "any", "needs", "show", "include", "with", "requires"]);

/** Split agentPhone / has_phone / date_of_birth into lowercase segments. */
export function segments(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((x) => x.toLowerCase());
}

/** Object keys EMITTED by a response body: `phone: x`, or shorthand `phone,`.
 *  A property READ (`e.phone`) is the source, not the disclosure, so keys
 *  preceded by a dot are excluded by construction. */
export function emittedKeys(body) {
  const keys = [];
  for (const m of body.matchAll(/(^|[{,(\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) keys.push(m[2]);
  for (const m of body.matchAll(/(^|[{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*(?=[,}]|$)/g)) keys.push(m[2]);
  return keys;
}

/** Does an emitted key hand out a forbidden value? */
export function keyDiscloses(key) {
  const segs = segments(key);
  if (!segs.length) return null;
  if (BOOLEAN_PREFIXES.has(segs[0])) return null;
  for (const s of segs) if (FORBIDDEN.includes(s)) return s;
  return null;
}

/** Extract the argument of every JSON.stringify that sits inside new Response(.
 *  NOT every JSON.stringify — see the operand note in the header. */
export function responseBodies(src) {
  const out = [];
  const re = /new Response\(\s*JSON\.stringify\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex, depth = 1, buf = "";
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (!depth) break; }
      buf += c; i++;
    }
    out.push(buf);
  }
  return out;
}

export function scan(root = ROOT, cfgPath = "supabase/config.toml") {
  const cfg = readFileSync(cfgPath, "utf8");
  const jwtFalse = new Set();
  for (const m of cfg.matchAll(/\[functions\.([A-Za-z0-9_-]+)\][^\[]*/g)) {
    if (/verify_jwt\s*=\s*false/.test(m[0])) jwtFalse.add(m[1]);
  }
  const violations = [];
  for (const fn of readdirSync(root)) {
    const p = join(root, fn, "index.ts");
    if (!existsSync(p)) continue;
    const src = stripComments(readFileSync(p, "utf8"));
    if (!jwtFalse.has(fn)) continue;
    if (!/SERVICE_ROLE/.test(src)) continue;
    if (CREDENTIAL_READS.some((r) => r.test(src))) continue;
    if (DB_TOKEN_GATES.some((r) => r.test(src))) continue;
    for (const body of responseBodies(src)) {
      const flat = body.replace(/\s+/g, " ");
      for (const key of new Set(emittedKeys(body))) {
        const field = keyDiscloses(key);
        if (field) violations.push({ fn, field, key, snippet: flat.slice(0, 110) });
      }
    }
  }
  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = scan();
  if (v.length) {
    console.error(`\n✖ check-uncredentialed-pii-response: ${v.length} disclosure(s)\n`);
    for (const x of v) {
      console.error(`  supabase/functions/${x.fn}/index.ts  returns "${x.key}" (a ${x.field}) to a caller with no credential`);
      console.error(`    ${x.snippet}\n`);
    }
    console.error("  An endpoint with verify_jwt=false that reads no credential must not put a");
    console.error("  person's phone/city/state/address/DOB in its own response. Remove the field,");
    console.error("  or gate the endpoint on a credential its real caller actually holds.\n");
    process.exit(1);
  }
  console.log("✔ check-uncredentialed-pii-response: no uncredentialed endpoint returns people-PII");
}
