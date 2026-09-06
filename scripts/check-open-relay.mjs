#!/usr/bin/env node
// check-open-relay — MP-446 (2026-09-06)
//
// THE BUG THIS EXISTS FOR:
// supabase/functions/send-email and send-bulk-email each forwarded a recipient
// taken straight off the REQUEST BODY into _shared/email.ts#sendEmail, which
// sends from Sam's verified Resend domain. Neither read a credential of any
// kind. A bare POST with no Authorization header reached the handler — proven
// by the HTTP 400 it returned from its OWN body validation, which sits before
// the send loop, so reachability was established without sending mail.
//
// That is an open relay: anyone who knows the URL can mail any address on
// earth as Apex. The cost is not a data leak, it is Sam's sending domain —
// phishing his own agents and applicants, and a reputation burn that lands his
// real portal-login and onboarding mail in spam.
//
// WHY THE GATEWAY CANNOT BE THE GUARD:
// config.toml sets verify_jwt = false on both, and flipping it to true does
// not close it — MP-443 measured that the gateway ACCEPTS the public anon key,
// which ships inside the browser bundle. The credential check has to live in
// the function, so this guard grades the function source.
//
// THE CONTRACT IS ABSOLUTE, NOT A COUNT:
// deliberately no numeric baseline. MP-356/357 proved a count-only floor is
// fungible — a real regression sits red until an unrelated pay-down launders
// it green. "Zero functions send to a body-supplied recipient without reading
// a credential" is a property, so it cannot be traded against anything.
//
// SCOPE HONESTY: a function whose send target is read from the DB (an outbox
// drain, a nudge sweep) is NOT in scope here — the attacker does not choose
// the recipient. Those still want auth, but they are a different finding and
// this guard does not pretend to cover them.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "supabase/functions";

// Comments only. String bodies are load-bearing: both the env var name and the
// header name live inside string literals. An earlier cut of this scan blanked
// string bodies and reported 16 service-role functions where there are 192.
function stripComments(src) {
  let out = "", i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; }
    else if (c === "/" && src[i + 1] === "*") { i += 2; while (i + 1 < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; }
    else if (c === '"' || c === "'" || c === "`") {
      const q = c; out += q; i++;
      while (i < n) {
        if (src[i] === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
        if (src[i] === q) break;
        out += src[i]; i++;
      }
      out += q; i++;
    } else { out += c; i++; }
  }
  return out;
}

// Sends outbound to a recipient it was handed.
const SENDS = [
  /from\s+["'`]\.\.\/_shared\/(email|sms|notify)[^"'`]*["'`]/,
  /api\.resend\.com/,
  /api\.twilio\.com/,
  /\bsendEmail\s*\(/,
];
// Recipient chosen by the CALLER. The recipient must be SYNTACTICALLY bound to
// the request body — a mere mention of body.email elsewhere is not enough.
//
// The loose first cut ("sends" AND "body.email appears anywhere") reported 4
// violations and all 4 were WRONG: next-step-dispatch sends to person.email,
// notify-test-reminder and send-licensing-sequence to app.email, and
// seminar-register to [manager.email] — every one a DB-derived recipient the
// caller cannot choose, in functions that also happen to read other params off
// the body. A guard that goes red on four correct functions is one everybody
// learns to skip.
const BODY_RECIPIENT = [
  /\b(to|recipients|recipient|emails)\s*:\s*(\[\s*)?(body|payload|input)\s*\./,
  /\b(to|recipients|recipient|emails)\s*=\s*[^;\n]*\b(body|payload|input)\s*\./,
  /Array\s*\.\s*isArray\s*\(\s*(body|payload|input)\s*\.\s*(recipients|to|emails)\s*\)/,
];
// Reads a credential off the request.
const READS_CRED = [
  /requireSendAuth\s*\(/,
  /requireAuth\s*\(/,
  /headers\s*\.\s*get\s*\(\s*["'`]\s*[Aa]uthorization/,
  /headers\s*\.\s*get\s*\(\s*["'`][^"'`]*[Ss]ignature/,
  /auth\s*\.\s*get(User|Claims)\s*\(/,
];

const hit = (pats, s) => pats.some((r) => r.test(s));

if (!existsSync(ROOT)) {
  console.error(`check:open-relay FAILED — ${ROOT} not found; refusing to pass on nothing`);
  process.exit(1);
}

const violations = [];
const notices = [];
let scanned = 0;

for (const dir of readdirSync(ROOT).sort()) {
  if (dir.startsWith("_")) continue;
  const p = join(ROOT, dir, "index.ts");
  if (!existsSync(p)) continue;
  scanned++;
  const code = stripComments(readFileSync(p, "utf8"));
  if (!hit(SENDS, code)) continue;
  if (hit(READS_CRED, code)) continue;
  if (hit(BODY_RECIPIENT, code)) violations.push(dir);
  else notices.push(dir);
}

// A scan that silently matched nothing proves nothing (MP-399). If the
// population collapsed, something moved and this guard is no longer measuring.
if (scanned < 100) {
  console.error(`check:open-relay FAILED — only ${scanned} functions scanned; expected the full tree. Refusing to vouch.`);
  process.exit(1);
}

if (violations.length > 0) {
  console.error(`check:open-relay FAILED — ${violations.length} function(s) send to a body-supplied recipient with no credential check:`);
  for (const v of violations) console.error(`  supabase/functions/${v}/index.ts`);
  console.error("");
  console.error("Fix: import { requireSendAuth } from '../_shared/require-send-auth.ts' and gate BEFORE reading the body.");
  console.error("Do NOT 'fix' this by setting verify_jwt = true — the gateway accepts the public anon key (MP-443).");
  process.exit(1);
}

// Non-voting. These send without reading a credential, but to a recipient the
// caller does not choose (an outbox drain, a manager notification). That is a
// weaker and separate finding — printed so it cannot hide behind this guard's
// green, never graded, because grading it here would make this gate red for a
// reason it was not built to judge.
if (notices.length > 0) {
  console.log(`note open-relay: ${notices.length} function(s) send without reading a credential, but to a DB-derived recipient (not caller-chosen, not graded here):`);
  for (const n of notices) console.log(`  - ${n}`);
}
console.log(`ok open-relay: 0 of ${scanned} edge functions send to a body-supplied recipient without reading a credential`);
