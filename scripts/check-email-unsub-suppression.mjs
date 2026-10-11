#!/usr/bin/env node
// check-email-unsub-suppression.mjs — PL-WIB-UNSUB-SUPPRESSION (2026-10-11)
//
// The unsubscribe link writes email_unsubscribes. Until this commit no
// commercial sender to applicants read it: the one person who opted out
// (2026-05-05) got 195 "Still interested" follow-ups from system-health-check
// afterwards and was still in send-push-optin-email's audience. The follow-up
// stopped only because contacted_at got stamped, which is not a suppression.
//
// This guard grades a NAMED list, never a count: a count floor is fungible and
// lets one sender's regression hide behind another's fix (MP-356). Each listed
// sender must, in code (comments stripped):
//   1. read email_unsubscribes, and
//   2. do it BEFORE its first send call, so the suppression decides the send.
//   3. not use _shared/email.ts isUnsubscribed(), which fails open (added
//      2026-10-11 with send-bulk-email).
//   4. (browser side, added 2026-10-11 PL-WIB-BULK-NO-FALLBACK) a src/ file
//      that invokes a listed sender must not also invoke send-email. send-email
//      never reads email_unsubscribes, and the one place that did both was a
//      fallback that re-mailed every recipient, opt-outs included, whenever the
//      suppressing sender returned an error (including its own fail-closed 503).
//      Browser callers are DERIVED by scanning src/, never listed, so a new
//      caller is graded the day it lands.
// Entries with directResend:false must also not build a Resend client: they
// go through _shared/email.ts sendEmail, which adds the unsubscribe footer and
// List-Unsubscribe headers and reports a provider refusal as ok:false.
//
// Adding a sender: add it here once it suppresses. Removing one needs a reason
// in the commit, because removal is the only way this guard can go green on a
// regression.
//
// Exit 0 = every listed sender suppresses. Exit 1 = a violation (named).
// Exit 2 = a listed file is missing or unreadable, or the src/ scan found no
// browser caller of any listed sender (never reported as clean).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FN = (name) => path.resolve(ROOT, process.env.UNSUB_GUARD_FUNCTIONS_DIR ?? "supabase/functions", name, "index.ts");

// send: a regex for the call that actually emails someone in that file.
export const SENDERS = [
  // Admin blast to every non-terminated applicant (836 on 2026-10-11).
  { name: "send-push-optin-email", send: /\bsendEmail\s*\(/, directResend: false },
  // Every-15-min follow-up to applicants stalled 3+ days, via send-notification.
  { name: "system-health-check", send: /functions\/v1\/send-notification/, directResend: true },
  // Admin Bulk Compose (BulkComposeDrawer): recipients come off the request body.
  { name: "send-bulk-email", send: /\bsendEmail\s*\(/, directResend: false },
];

const READ = /\.from\(\s*["'`]email_unsubscribes["'`]\s*\)|\bisUnsubscribed\s*\(/;
const DIRECT = /\bnew\s+Resend\s*\(|api\.resend\.com\/emails/;
// _shared/email.ts isUnsubscribed() returns false on a read error, so a sender
// that relies on it mails opt-outs whenever the list is unreadable. Listed
// senders read the list themselves and stop if the read fails.
const FAIL_OPEN = /\bisUnsubscribed\s*\(/;

export function grade(name, code, rule) {
  const problems = [];
  const read = code.search(READ);
  const send = code.search(rule.send);
  if (send < 0) problems.push(`no send call matching ${rule.send} (rule is stale, update SENDERS)`);
  if (read < 0) problems.push("never reads email_unsubscribes");
  else if (send >= 0 && read > send) problems.push("reads email_unsubscribes only AFTER its first send");
  if (FAIL_OPEN.test(code)) {
    problems.push("uses isUnsubscribed(), which sends to everyone when the list is unreadable; read email_unsubscribes once and stop on error");
  }
  if (rule.directResend === false && DIRECT.test(code)) {
    problems.push("builds its own Resend client; route through _shared/email.ts sendEmail");
  }
  return problems.map((p) => `${name}: ${p}`);
}

const invokes = (name) =>
  new RegExp(`\\binvoke\\(\\s*["'\`]${name}["'\`]|functions/v1/${name}(?![\\w-])`);
const UNSUPPRESSED = invokes("send-email");

export function gradeClient(file, code) {
  const callers = SENDERS.filter((r) => invokes(r.name).test(code)).map((r) => r.name);
  if (callers.length === 0 || !UNSUPPRESSED.test(code)) return { callers, problems: [] };
  return {
    callers,
    problems: [
      `${file}: invokes ${callers.join(", ")} and also send-email, which never reads email_unsubscribes; ` +
        "a fallback to it re-mails opt-outs and everyone the first call already reached",
    ],
  };
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(ent.name) && !/\.test\./.test(ent.name)) out.push(p);
  }
  return out;
}

const failures = [];
const missing = [];
for (const rule of SENDERS) {
  let raw;
  try {
    raw = fs.readFileSync(FN(rule.name), "utf8");
  } catch (e) {
    missing.push(`${rule.name}: ${e.code ?? e.message}`);
    continue;
  }
  failures.push(...grade(rule.name, stripComments(raw), rule));
}

const SRC = path.resolve(ROOT, process.env.UNSUB_GUARD_SRC_DIR ?? "src");
let clientCallers = 0;
try {
  for (const file of walk(SRC)) {
    const { callers, problems } = gradeClient(path.relative(ROOT, file), stripComments(fs.readFileSync(file, "utf8")));
    if (callers.length) clientCallers++;
    failures.push(...problems);
  }
} catch (e) {
  missing.push(`src scan (${SRC}): ${e.code ?? e.message}`);
}
if (clientCallers === 0 && !missing.length) {
  missing.push(`src scan (${SRC}): found no browser caller of any listed sender, so it is not looking where the code is`);
}

if (missing.length) {
  console.error(`check-email-unsub-suppression: cannot grade ${missing.length} input(s):\n  ${missing.join("\n  ")}`);
  process.exit(2);
}
if (failures.length) {
  console.error(`check-email-unsub-suppression: ${failures.length} violation(s):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(
  `check-email-unsub-suppression: ${SENDERS.length}/${SENDERS.length} listed senders read email_unsubscribes before sending; ` +
    `${clientCallers} browser caller file(s), none falls back to send-email`,
);
