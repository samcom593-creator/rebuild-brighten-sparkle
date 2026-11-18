#!/usr/bin/env node
/**
 * check-apply-field-parity — every REQUIRED field the /apply form forces a
 * recruit to fill must actually be SENT in the submit-application invoke body.
 *
 * WHY THIS EXISTS (MP-WIB-APPLY-MOTIVATION, 2026-11-18). /apply is the single
 * conversion point of the recruiting funnel. On 2026-11-18 the step-4 field
 * `motivation` — "What motivates you to join Galaxy?", REQUIRED (z.string()
 * .min(25)), the user hard-blocked from submitting until they type >=25
 * characters — was collected, validated, rendered, and then NEVER added to the
 * supabase.functions.invoke("submit-application") body, never read by the edge
 * function, and never written to a column. Every applicant typed their
 * qualification pitch and it was discarded the instant they submitted (916
 * lifetime / ~44 per month). The same silent-data-loss class as the 2026-05-18
 * mobile-carrier drop, but worse: that field was optional; this one is required,
 * so it hit 100% of applicants.
 *
 * EVERY EXISTING GUARD WAS BLIND TO THIS CLASS (measured 2026-11-18):
 *   - check-apply-form-render proves the form RENDERS (selects populated, >=N
 *     controls). A fully-rendered form whose values are dropped on submit is
 *     GREEN to it.
 *   - check-funnel-capture-handler / check-function-contracts prove the ENDPOINT
 *     runs and its AUTH posture. Neither inspects which fields reach it.
 *   - live-render / route-smoke / mobile-overflow never look at the payload.
 * So a required field could be collected and silently dropped and every gate in
 * the repo stayed green — until a recruiter noticed a column was always empty.
 *
 * WHAT IT ASSERTS (static, no browser, no network — gates in verify:core):
 *   Every field in src/pages/Apply.tsx's Zod schema that is REQUIRED (its
 *   definition carries none of .optional( / .nullable( / .default( — i.e. the
 *   user cannot submit without it) must appear as a top-level key in the
 *   FULL-submit invoke body (the invoke that carries city + availability; the
 *   quick-qualify invoke is a deliberate subset and is NOT required to carry the
 *   full set). A required field absent from the body is a DROP → exit 1.
 *
 * This reads the committed tree, which is exactly what CI has, so the check
 * itself gates (unlike the live-probe guards, which can only run their selftest
 * in verify:core). `--selftest` proves the pure parser both directions with no
 * fs. "could not parse" is NEVER laundered into pass — an unreadable schema or a
 * missing full-submit body exits non-zero so a refactor that moves either can't
 * silently disable the guard.
 *
 * Exit: 0 parity OK | 1 a required field is dropped | 2 could-not-parse.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/strip-comments.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = resolve(REPO, "src/pages/Apply.tsx");

// Known-tolerated required-field -> body gaps. EMPTY BY DESIGN: a field the user
// is forced to fill and we then drop is always a bug. If a future field
// legitimately lives client-side only, document WHY here — never add a name to
// silence a real drop (that is the 465 fake-success rows, in a JSON set).
const BASELINE = new Set([]);

const REQUIRED_MODIFIERS = [".optional(", ".nullable(", ".default("];

// ── pure core (no fs / no network; every branch driven by --selftest) ──

// Replace the CONTENTS of string literals with spaces so a modifier-like token
// inside an error message ("use .default( …") or a ':' inside a URL string is
// never read as code. STRING-AWARE char walker (NOT a regex): a `'` only opens a
// string in code context and a matching `'` closes it, so a JSX contraction
// upstream (you're / don't) can never pair across the whole file and blank real
// code — the exact runaway a naive /'…'/ regex produced here on 2026-11-18.
// Backtick bodies are treated as opaque strings (the ${…} braces inside are
// ignored); the apply schema and the submit-body object contain no template
// literals, and the walker is only ever run on those pure-JS regions.
function codeOnly(text) {
  let out = "";
  let inStr = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") { out += "  "; i++; continue; } // skip escaped char, keep length
      if (c === inStr) { inStr = null; out += c; continue; }
      out += c === "\n" ? "\n" : " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; out += c; continue; }
    out += c;
  }
  return out;
}

// Index of the brace that closes the '{' at openIndex. STRING-AWARE: braces
// inside '…'/"…"/`…` never miscount. Run on stripComments() output (comments
// already spaces) starting at the brace, so it only ever lexes the object region.
function matchBrace(text, openIndex) {
  let depth = 0;
  let inStr = null;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Given the text INSIDE an object's braces (not the outer { }), return the
// depth-0 field entries [{ name, text }]. STRING-AWARE. A field key is an
// identifier followed by ':' at brace/paren/bracket depth 0 whose previous
// significant character is ',' or the start of the object — so a ternary branch
// (`cond ? a : b`), a nested object's keys, `data.foo` member access, and any
// identifier:colon inside a string are all correctly NOT counted as fields.
export function topLevelEntries(objBody) {
  const entries = [];
  let depth = 0;
  let inStr = null;
  let prevSig = null; // last non-space, non-string char consumed at scan point
  let cur = null; // { name, start }
  let i = 0;
  const openers = "({[";
  const closers = ")}]";
  while (i < objBody.length) {
    const ch = objBody[i];
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; prevSig = ch; i++; continue; }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
    if (depth === 0 && (prevSig === null || prevSig === ",")) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(objBody.slice(i));
      if (m) {
        if (cur) entries.push({ name: cur.name, text: objBody.slice(cur.start, i) });
        cur = { name: m[1], start: i };
        i += m[0].length;
        prevSig = ":";
        continue;
      }
    }
    if (openers.includes(ch)) depth++;
    else if (closers.includes(ch)) depth--;
    prevSig = ch;
    i++;
  }
  if (cur) entries.push({ name: cur.name, text: objBody.slice(cur.start) });
  return entries;
}

// The REQUIRED field names of the apply Zod schema — the z.object whose body
// mentions both firstName: and motivation: (or, in a selftest fixture, just the
// one we were handed). Required = definition has none of REQUIRED_MODIFIERS.
export function parseRequiredFields(src) {
  // `located`: comments → spaces, STRINGS INTACT (length-preserving), so the
  // z.object discriminator and firstName/motivation keys survive while a token
  // in a comment can never be read as code. All brace-matching and field
  // scanning below is string-aware and runs locally on the object region, so no
  // full-file string pass (and no apostrophe-pairing runaway) is needed.
  const located = stripComments(src);
  const re = /z\.object\s*\(\s*\{/g;
  let m, chosen = null;
  while ((m = re.exec(located))) {
    const open = located.indexOf("{", m.index);
    const close = matchBrace(located, open);
    if (close < 0) continue;
    const body = located.slice(open + 1, close);
    if (/\bfirstName\s*:/.test(body) && /\bmotivation\s*:/.test(body)) {
      chosen = body;
      break;
    }
  }
  if (chosen === null) return null; // could-not-parse — caller must NOT pass
  const required = new Set();
  for (const { name, text } of topLevelEntries(chosen)) {
    // a .default( / .optional( inside a STRING error message must not count —
    // scan the code-only projection of the field's definition.
    const def = codeOnly(text);
    const isOptional = REQUIRED_MODIFIERS.some((mod) => def.includes(mod));
    if (!isOptional) required.add(name);
  }
  return required;
}

// Top-level keys of the FULL-submit invoke body: the body of a
// functions.invoke("submit-application", { body: { … } }) whose keys include
// both `city` and `availability` (the quick-qualify invoke carries neither).
export function parseSubmitBodyKeys(src) {
  const located = stripComments(src); // strings INTACT so "submit-application" survives
  const re = /functions\s*\.\s*invoke\s*\(\s*["'`]submit-application["'`]/g;
  let m;
  const candidates = [];
  while ((m = re.exec(located))) {
    const bodyKey = located.indexOf("body:", m.index);
    if (bodyKey < 0) continue;
    const open = located.indexOf("{", bodyKey);
    if (open < 0) continue;
    const close = matchBrace(located, open); // string-aware; lexes only the body object
    if (close < 0) continue;
    const body = located.slice(open + 1, close);
    const keys = new Set(topLevelEntries(body).map((e) => e.name));
    candidates.push(keys);
  }
  // the full submit is the body that carries city AND availability.
  const full = candidates.find((k) => k.has("city") && k.has("availability"));
  return full ?? null; // could-not-parse — caller must NOT pass
}

export function missingRequired(src) {
  const required = parseRequiredFields(src);
  const bodyKeys = parseSubmitBodyKeys(src);
  if (required === null) return { parseError: "schema (z.object with firstName+motivation) not found" };
  if (bodyKeys === null) return { parseError: "full-submit invoke body (with city+availability) not found" };
  const missing = [...required].filter((f) => !bodyKeys.has(f) && !BASELINE.has(f));
  return { required: [...required], bodyKeys: [...bodyKeys], missing };
}

// ── selftest: prove the parser both directions, NO fs ──
function selftest() {
  let pass = 0, total = 0;
  const ok = (cond, name) => { total++; if (cond) { pass++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

  // topLevelEntries — field extraction edge cases.
  const entries = topLevelEntries(`
    firstName: z.string().min(2),
    carrier: z.string().optional(),
    customReferrer: cond === "other" && v.trim() ? v.trim() : null,
    consent: { smsConsentGiven: data.smsConsent, nested: true },
    recruiterId: referrerId ?? (picked ? picked : null),
  `);
  const names = entries.map((e) => e.name);
  ok(names.includes("firstName"), "captures firstName at depth 0");
  ok(names.includes("carrier"), "captures carrier");
  ok(names.includes("customReferrer"), "captures customReferrer (ternary value)");
  ok(names.includes("consent"), "captures consent (object value)");
  ok(names.includes("recruiterId"), "captures recruiterId (?? + ternary)");
  ok(!names.includes("smsConsentGiven") && !names.includes("nested"), "nested consent keys are NOT top-level");
  ok(!names.includes("trim") && !names.includes("picked") && !names.includes("v"), "ternary branches / members are NOT fields");

  // the 2026-11-18 runaway: an apostrophe and a colon INSIDE a string value must
  // not swallow the fields that follow it (a naive /'…'/ pass blanked the file).
  const stry = topLevelEntries(`
    note: "you're applying — url http://x so don't drop me",
    city: data.city,
    availability: data.availability,
  `).map((e) => e.name);
  ok(stry.includes("note") && stry.includes("city") && stry.includes("availability"), "apostrophe + colon inside a string value does not swallow later fields");
  ok(!stry.includes("http"), "a colon inside a string ('http:') is NOT read as a field key");

  const SCHEMA = `const applicationBaseSchema = z.object({
    firstName: z.string().min(2, "First name is required").max(50),
    email: z.string().email("Valid email is required"),
    instagramHandle: z.string().max(50).optional(),
    hasInsuranceExperience: z.boolean().default(false),
    licenseStatus: z.enum(["licensed", "unlicensed", "pending"]),
    niprNumber: z.string().max(20).optional(),
    availability: z.string().min(1, "req"),
    whyJoin: z.string().optional(),
    motivation: z.string().min(25, "share .default( is only in this string"),
    smsConsent: z.boolean().default(false),
  });`;
  const req = parseRequiredFields(SCHEMA);
  ok(req !== null, "schema parses (firstName+motivation present)");
  ok(req.has("firstName") && req.has("email") && req.has("licenseStatus") && req.has("availability") && req.has("motivation"), "required set = firstName,email,licenseStatus,availability,motivation");
  ok(!req.has("instagramHandle") && !req.has("niprNumber") && !req.has("whyJoin"), ".optional() fields excluded");
  ok(!req.has("hasInsuranceExperience") && !req.has("smsConsent"), ".default() fields excluded");
  ok(req.has("motivation"), "a .default( token INSIDE a string literal does not make motivation optional");

  const BODY_FULL = (withMotivation) => `
    await supabase.functions.invoke("submit-application", { body: {
      firstName: data.firstName,
      email: data.email,
      city: data.city,
      licenseStatus: data.licenseStatus,
      availability: data.availability,
      ${withMotivation ? "motivation: data.motivation," : ""}
      consent: { smsConsentGiven: data.smsConsent },
      ...getTrafficPayload(),
    } });`;
  const BODY_QUICK = `
    await supabase.functions.invoke("submit-application", { body: {
      quickQualify: true, firstName, email, phone, licenseStatus,
    } });`;

  const keysFull = parseSubmitBodyKeys(BODY_QUICK + BODY_FULL(true));
  ok(keysFull !== null, "full-submit body found (city+availability)");
  ok(keysFull.has("motivation") && keysFull.has("availability"), "full body keys include motivation+availability");
  ok(!keysFull.has("quickQualify"), "the quick-qualify body is NOT the one selected");

  // end-to-end: the real bug (motivation dropped) MUST red; wired MUST pass.
  const dropped = missingRequired(SCHEMA + BODY_QUICK + BODY_FULL(false));
  ok(Array.isArray(dropped.missing) && dropped.missing.includes("motivation"), "DROP direction: motivation missing from body -> flagged");
  const wired = missingRequired(SCHEMA + BODY_QUICK + BODY_FULL(true));
  ok(Array.isArray(wired.missing) && wired.missing.length === 0, "WIRED direction: motivation present -> clean");

  // could-not-parse is never pass.
  ok(missingRequired("const x = 1;").parseError, "no schema -> parseError (never laundered to pass)");
  ok(missingRequired(SCHEMA).parseError, "schema but no invoke body -> parseError");

  console.log(`\ncheck:apply-field-parity --selftest — ${pass}/${total} assertions pass (both directions).`);
  if (pass !== total) { console.error("SELFTEST FAILED — the apply field-parity parser is wrong."); process.exit(1); }
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

// Run the live check ONLY when invoked directly (`node scripts/check-apply-field-parity.mjs`),
// never on import — so a unit test can import the pure parsers above without the file
// reading the tree and exiting the process out from under it.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!invokedDirectly) {
  // imported for its exports; do nothing else.
} else {
  // ── live check against the committed tree ──
  let src;
  try {
    src = readFileSync(APPLY, "utf8");
  } catch (e) {
    console.error(`check:apply-field-parity — COULD NOT READ ${APPLY}: ${e.message}`);
    process.exit(2);
  }
  const res = missingRequired(src);
  if (res.parseError) {
  console.error(`check:apply-field-parity — COULD NOT PARSE: ${res.parseError}.`);
  console.error("  The apply schema or the full-submit invoke body moved. This guard must be");
  console.error("  updated to find them again — a parser that cannot see the form is not a pass.");
  process.exit(2);
}
if (res.missing.length) {
  console.error("check:apply-field-parity — REQUIRED /apply fields are COLLECTED but NOT SENT:");
  for (const f of res.missing) {
    console.error(`  🔴 ${f} — required in the Zod schema (user hard-blocked on it) but absent from the`);
    console.error(`        submit-application invoke body. It is discarded on submit (the motivation class).`);
  }
  console.error("  Add each to the full-submit body in src/pages/Apply.tsx (and read+persist it in");
  console.error("  supabase/functions/submit-application), or make it .optional() if it is truly not needed.");
  process.exit(1);
}
  console.log(`check:apply-field-parity — OK: all ${res.required.length} required /apply fields round-trip into the submit-application body.`);
  console.log(`  required: ${res.required.sort().join(", ")}`);
  process.exit(0);
}
