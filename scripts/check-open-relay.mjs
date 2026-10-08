#!/usr/bin/env node
import { stripComments } from "./lib/strip-comments.mjs";
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

// Sends outbound to a recipient it was handed.
const SENDS = [
  /from\s+["'`]\.\.\/_shared\/(email|sms|notify)[^"'`]*["'`]/,
  /api\.resend\.com/,
  /api\.twilio\.com/,
  /\bsendEmail\s*\(/,
  // PL-WIB-SEND-ADMIN-EMAIL-AUTH (2026-10-08). The Resend SDK. Without this the
  // 51 functions that call resend.emails.send() were outside the population:
  // not violations, not even notices. send-admin-email (caller-chosen to, from
  // and html, no credential read) printed "0 of 239" here for its whole life.
  /\.emails\s*\.\s*(send|batch\s*\.\s*send)\s*\(/,
  // PL-WIB-SEND-INSTAGRAM-DM-AUTH (2026-10-08). Instagram / Meta Graph sends: a
  // DM (/messages) or a public comment reply (/replies) posted as Sam's account.
  // send-instagram-dm took the text and the target off the body with no
  // credential read and printed "0 of 239" here, because this list only knew
  // email and SMS. Graph READS (comments, insights) are not sends and stay out.
  /graph\.(instagram|facebook)\.com[^"'`\n]*\/(messages|replies)\b/,
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
  // Destructured off the body: `const { to, subject, html } = await req.json()`
  // then `to,` shorthand. No `body.` ever appears, so the three above cannot
  // see it. Only to/recipients/recipient: a destructured `email` is usually the
  // applicant being looked up, which is the false positive described above.
  // Measured 2026-10-08 against all 239 functions: flags send-admin-email
  // before its gate and nothing after it.
  /\{[^{}]*\b(to|recipients|recipient)\b[^{}]*\}\s*=\s*(await\s+req\s*\.\s*json\s*\(\s*\)|(body|payload|input)\b)/,
  // Instagram targets: an IGSID or a comment id taken off the body
  // (`const recipientId = body.recipient_id ?? ...`, `commentId = body.comment_id`).
  // A comment id IS a recipient: a private reply DMs its author, a public one
  // posts under it.
  /\b(recipient_?[Ii]d|comment_?[Ii]d|igsid)\s*[:=]\s*[^;\n]*\b(body|payload|input)\s*\.\s*(recipient_id|comment_id|igsid|to)\b/,
];
// PL-WIB-OPEN-RELAY-ONE-HOP (2026-10-08). One hop from the body to `to:`.
// send-notification did `const { userId, title, message, url, email } = await
// req.json()`, then `const recipientEmail = email || profileData?.email`, then
// `to: [recipientEmail]`. No `body.` and no destructured `to`, so every pattern
// above missed it and it printed as a non-voting notice for its whole life while
// any stranger could mail any address. send-aged-lead-email did the same with no
// alias at all (`to: [email]`). The destructured-`email` exclusion above is right
// about a lookup key; it is wrong once that identifier is the thing in `to:`.
//
// Alias = `const|let X = NAME` followed only by .trim()/.toLowerCase()/.toString()
// and then `||`, `??` or end of statement. A comparison (`to = channel === "sms"
// ? profile.phone : profile.email`, bulk-agent-message) is not an alias: the
// recipient there is DB-derived. Measured 2026-10-08 over 239 functions with
// both pre-gate files restored: 6 hits, of which send-notification,
// send-aged-lead-email and send-password-reset read no credential.
function bodyAliasRecipient(code) {
  const names = new Set();
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=\s*(?:await\s+req\s*\.\s*json\s*\(\s*\)|(?:body|payload|input)\b)/g)) {
    for (const part of m[1].split(",")) {
      const n = part.split(":").pop().split("=")[0].trim().replace(/^\.\.\./, "");
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
    }
  }
  if (names.size === 0) return null;
  const alias = new Set();
  for (const m of code.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)(?:\s*\??\.\s*(?:trim|toLowerCase|toString)\s*\(\s*\))*\s*(?:\|\||\?\?|;|\n)/g)) {
    if (names.has(m[2])) alias.add(m[1]);
  }
  for (const m of code.matchAll(/\bto\s*:\s*\[?\s*([A-Za-z_$][\w$]*)\s*[\],\n}]/g)) {
    if (names.has(m[1]) || alias.has(m[1])) return m[1];
  }
  return null;
}

// Public BY DESIGN, and only while the reason still holds: each entry names the
// pattern that makes the body recipient safe. Remove that code and the exemption
// lapses on its own, so this list cannot outlive the property it records. It
// exempts from the one-hop detector only, never from BODY_RECIPIENT.
//   send-password-reset (MP-453): Login.tsx and MagicLogin.tsx call it with no
//   session. It mails only after auth.admin.generateLink finds the account, and
//   the body is a fixed reset link, never caller text.
const ONE_HOP_BY_DESIGN = {
  "send-password-reset": /auth\s*\.\s*admin\s*\.\s*generateLink\s*\(/,
};

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
const byDesign = [];
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
  else if (bodyAliasRecipient(code)) {
    const proof = ONE_HOP_BY_DESIGN[dir];
    if (proof && proof.test(code)) byDesign.push(dir);
    else violations.push(dir);
  }
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
for (const d of byDesign) console.log(`by-design open-relay: ${d} takes its recipient off the body and is public on purpose (see ONE_HOP_BY_DESIGN)`);
console.log(`ok open-relay: 0 of ${scanned} edge functions send to a body-supplied recipient without reading a credential`);
