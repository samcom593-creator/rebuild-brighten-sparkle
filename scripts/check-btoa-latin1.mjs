import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// check-btoa-latin1 — MP-550 (2026-09-16)
//
// btoa() encodes a BINARY STRING. It reads each UTF-16 code unit as one byte and
// throws InvalidCharacterError on any code point above 0xFF. Handed human-authored
// text it works until one character leaves Latin1, and then it throws -- it never
// degrades and never truncates, so there is no partial output to notice.
//
// WHAT THIS COST, measured: seminar-confirmation built its .ics event title as the
// literal "Apex Seminar — Welcome Zoom" with a U+2014 em-dash. btoa(icsBody) threw
// on EVERY invocation, uncaught, before the email send and before all three DB
// writes. submit-application fires that function on every submission. 825
// applications, 0 rows ever stamped with seminar_invited_at. The throw was
// data-independent -- it crashed just as hard on a pure-ASCII applicant, because
// the bad character was in the template, not the input.
//
// Status-code monitoring is STRUCTURALLY BLIND to this class. The same is true of
// MP-274, where Deno threw while constructing a Request over an emoji in an HTTP
// header. Validation at an encoding boundary fires before any byte reaches the
// network, so there is no response to inspect and nothing to alert on.
//
// ── WHY THIS IS A SET AND NOT A COUNT ────────────────────────────────────────
// MP-356: a count-only floor is fungible. A real regression can sit red until an
// unrelated pay-down absorbs it, and the guard goes green having laundered the bug.
// So each allowed site is keyed by its own source text and carries the reason it
// is Latin1-safe. Move the line and nothing breaks; CHANGE the call and it must be
// re-justified. A new btoa() anywhere under supabase/functions fails until someone
// writes down why its argument cannot exceed 0xFF.
//
// The honest limit, stated rather than implied: a static scanner cannot prove an
// arbitrary expression stays under 0xFF. It can force the question to be answered
// in writing at the moment the call is introduced, which is the only point where
// anyone knows the answer.

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN_ROOT = join(ROOT, "supabase/functions");

// file :: exact trimmed source line  ->  why this argument cannot exceed 0xFF
const ALLOWED = new Map(Object.entries({
  "supabase/functions/_shared/base64-utf8.ts :: return btoa(bin);":
    "THE shared UTF-8-safe encoder. `bin` is built from TextEncoder bytes via String.fromCharCode, so every unit is <= 0xFF by construction.",
  "supabase/functions/_shared/header-safe.ts :: return `=?UTF-8?B?${btoa(bin)}?=`;":
    "MP-274's RFC 2047 encoder. Same construction: `bin` comes from TextEncoder bytes.",
  "supabase/functions/_shared/google-sheets.ts :: return btoa(s).replace(/\\+/g, \"-\").replace(/\\//g, \"_\").replace(/=+$/, \"\");":
    "b64url(bytes: Uint8Array) -- `s` is accumulated from a Uint8Array one byte at a time.",
  "supabase/functions/send-plaque-recognition/index.ts :: return btoa(binary);":
    "`binary` is accumulated from a Uint8Array of PNG bytes.",
  "supabase/functions/send-push-notification/index.ts :: const base64 = btoa(String.fromCharCode(...data));":
    "Argument is String.fromCharCode over a byte array -- Latin1-safe by construction.",
  "supabase/functions/generate-monthly-awards/index.ts :: return `data:${ct};base64,${btoa(bin)}`;":
    "`bin` is accumulated from image bytes.",
  "supabase/functions/render-all-plaques/index.ts :: const b64 = btoa(Array.from(buf).map(b => String.fromCharCode(b)).join(\"\"));":
    "Explicit byte-wise fromCharCode over a buffer.",
  "supabase/functions/generate-award-graphics/index.ts :: function toBase64(bytes: Uint8Array): string { let b = \"\"; for (const byte of bytes) b += String.fromCharCode(byte); return btoa(b); }":
    "Byte-wise fromCharCode over a Uint8Array.",
  "supabase/functions/next-step-dispatch/index.ts :: const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);":
    "HTTP Basic credentials. Twilio account SIDs and auth tokens are ASCII hex.",
  "supabase/functions/send-license-milestone/index.ts :: const auth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);":
    "HTTP Basic credentials. Twilio account SIDs and auth tokens are ASCII hex.",
  "supabase/functions/_shared/base64-utf8.test.ts :: () => btoa(body),":
    "The test ASSERTS this throws. If it ever stops throwing, base64-utf8.test.ts fails and says so.",
  "supabase/functions/_shared/base64-utf8.test.ts :: assertEquals(base64Utf8(s), btoa(s));":
    "Pure-ASCII equivalence assertion inside the encoder's own test.",
}));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const found = [];
for (const file of walk(SCAN_ROOT)) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // A comment mentioning btoa is prose, not a call site. MP-277 shipped a guard
    // that counted its own footnotes; this repo has paid that bill twice.
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (!/\bbtoa\s*\(/.test(line)) return;
    found.push({ key: `${rel} :: ${trimmed}`, rel, line: i + 1, trimmed });
  });
}

const unjustified = found.filter((f) => !ALLOWED.has(f.key));
const stale = [...ALLOWED.keys()].filter((k) => !found.some((f) => f.key === k));

console.log(`check-btoa-latin1: ${found.length} btoa() call site(s) under supabase/functions, ${ALLOWED.size} justified.`);

if (stale.length) {
  console.log(`\nNOTE: ${stale.length} justified site(s) no longer present (the call moved or was removed).`);
  for (const k of stale) console.log(`  - ${k}`);
  console.log("Delete them from ALLOWED so the set keeps describing this repo.");
}

if (unjustified.length) {
  console.error(`\nFAIL: ${unjustified.length} unjustified btoa() call site(s).\n`);
  for (const f of unjustified) {
    console.error(`  ${f.rel}:${f.line}`);
    console.error(`    ${f.trimmed}`);
  }
  console.error(`
btoa() throws InvalidCharacterError on any code point above 0xFF, uncaught and
with no partial output. If this argument is ever human-authored text -- a title,
a name, a value out of system_settings -- one accent or em-dash takes the whole
function down, exactly as it did to seminar-confirmation for 825 applications.

  Encoding TEXT?   import { base64Utf8 } from "../_shared/base64-utf8.ts"
  Encoding BYTES?  keep btoa, and add the site to ALLOWED in this file with the
                   reason its argument cannot exceed 0xFF.
`);
  process.exit(1);
}

if (stale.length) {
  console.error("FAIL: stale entries above. The set must keep describing this repo.");
  process.exit(1);
}

console.log("OK: every btoa() call site under supabase/functions is accounted for.");
