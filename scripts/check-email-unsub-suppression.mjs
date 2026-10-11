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
// Entries with directResend:false must also not build a Resend client: they
// go through _shared/email.ts sendEmail, which adds the unsubscribe footer and
// List-Unsubscribe headers and reports a provider refusal as ok:false.
//
// Adding a sender: add it here once it suppresses. Removing one needs a reason
// in the commit, because removal is the only way this guard can go green on a
// regression.
//
// Exit 0 = every listed sender suppresses. Exit 1 = a violation (named).
// Exit 2 = a listed file is missing or unreadable (never reported as clean).

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

if (missing.length) {
  console.error(`check-email-unsub-suppression: cannot read ${missing.length} listed sender(s):\n  ${missing.join("\n  ")}`);
  process.exit(2);
}
if (failures.length) {
  console.error(`check-email-unsub-suppression: ${failures.length} violation(s):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-email-unsub-suppression: ${SENDERS.length}/${SENDERS.length} listed senders read email_unsubscribes before sending`);
