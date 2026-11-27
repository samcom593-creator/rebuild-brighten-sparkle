#!/usr/bin/env node
/**
 * check-edge-email-emdash — WIB MP-WIB-EDGE-EMAIL-AITELL (2026-11-27)
 *
 * THE PROBLEM: the raw em-dash (—) and en-dash (–) CHARACTERS are the single
 * loudest "an LLM wrote this" tell, and they reach real inboxes. The existing
 * AI-tell guard (check-forbidden-language.mjs) scans the whole repo for AI-tell
 * PHRASES but not these characters, so they ship silently in recruit/agent/
 * applicant email copy. A 2026-11-27 sweep found 25 recipient-facing edge
 * functions emitting raw em/en-dashes without ever humanizing them.
 *
 * THE FIX THIS GUARD DEFENDS:
 *   - _shared/email.ts::sendEmail() now runs humanize() on subject/html/text at
 *     the single send boundary (—→" - ", –→"-", smart quotes, AI preambles).
 *     Every caller that sends ONLY through sendEmail() is therefore clean at
 *     runtime no matter what literal it built -> EXEMPT here.
 *   - A function that calls humanize() on its own copy before a direct
 *     resend.emails.send() is likewise clean -> EXEMPT here.
 *   - A function that builds email copy and sends it via `new Resend(...)`
 *     directly WITHOUT humanizing is the leak -> COUNTED here.
 *
 * WHAT IS COUNTED, per file, in supabase/functions-slash-<fn>/index.ts that
 * is recipient-facing email (references resend / emails.send / new Resend /
 * send-sms-via-email), excluding _shared and *.test.ts: the number of raw em
 * (—) and en (–) dash characters in CODE (comments stripped via
 * lib/strip-comments; string bodies kept, because the tell IS inside a string).
 *
 * EXEMPT (count forced to 0): a file that either
 *   - calls humanize( ... )               (self-cleans its own copy), or
 *   - imports sendEmail from _shared/email AND has no `new Resend(`
 *                                         (every send goes through the boundary)
 *
 * RATCHET, PER FILE (a global count would let a new tell in one file hide
 * behind a fix in another): a file above its baseline fails, and a file not in
 * the baseline fails if it has any. A file below its baseline passes and prints
 * the line to lower; `--update` rewrites the baseline from the current tree and
 * refuses to RAISE any entry unless `--allow-raise` is also given.
 *
 * `--selftest` proves the detector can fail: it runs the matcher over fixtures
 * that must count 2, 1, 0, 0 and 0, and exits non-zero if any comes out wrong.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { stripComments } from "./lib/strip-comments.mjs";

const BASELINE = "scripts/data/edge-email-emdash-baseline.json";
const FN_DIR = "supabase/functions";

// Recipient-facing email surface (same net the 2026-11-27 sweep used).
const EMAIL_SEND = /\bresend\b|emails\.send|new Resend\(|send-sms-via-email|react-email/i;

function isExempt(source) {
  const callsHumanize = /\bhumanize\s*\(/.test(source);
  const usesSendEmail = /\bsendEmail\s*\(/.test(source) && /_shared\/email/.test(source);
  const directResend = /new Resend\(/.test(source);
  return callsHumanize || (usesSendEmail && !directResend);
}

// Count raw em/en-dash chars in code (comments stripped, strings kept).
export function countEmDashes(source) {
  if (isExempt(source)) return 0;
  const code = stripComments(source);
  let n = 0;
  for (const ch of code) {
    if (ch === "—" || ch === "–") n++;
  }
  return n;
}

function selftest() {
  const EM = "—", EN = "–";
  const cases = [
    // 2 raw dashes in email copy, direct Resend, no humanize -> counted
    [`const r = new Resend(k); r.emails.send({ html: "Welcome${EM}let's go${EN}today" });`, 2],
    // 1 raw dash, direct Resend -> counted
    [`new Resend(k).emails.send({ subject: "Your license${EM}next step" });`, 1],
    // raw dash only inside a comment -> 0
    [`// resend copy with ${EM} in a comment\nnew Resend(k).emails.send({ html: x });`, 0],
    // humanize()'d before send -> exempt -> 0
    [`import { humanize } from "../_shared/humanize.ts"; new Resend(k).emails.send({ html: humanize("hi${EM}there") });`, 0],
    // routed through sendEmail boundary, no direct Resend -> exempt -> 0
    [`import { sendEmail } from "../_shared/email.ts"; await sendEmail({ to, subject: "a${EM}b", html });`, 0],
  ];
  let bad = 0;
  for (const [src, want] of cases) {
    const got = countEmDashes(src);
    if (got !== want) { console.error(`SELFTEST FAIL: want ${want} got ${got} for: ${src.slice(0, 60)}`); bad++; }
  }
  if (bad) { console.error(`check-edge-email-emdash selftest: ${bad} case(s) wrong`); process.exit(1); }
  console.log("check-edge-email-emdash selftest: OK (5 cases)");
  process.exit(0);
}

function scan() {
  const out = {};
  let dirs = [];
  try { dirs = readdirSync(FN_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return out; }
  for (const d of dirs) {
    if (d === "_shared") continue;
    const p = `${FN_DIR}/${d}/index.ts`;
    if (!existsSync(p)) continue;
    let src;
    try { src = readFileSync(p, "utf8"); } catch { continue; }
    if (!EMAIL_SEND.test(src)) continue;
    const n = countEmDashes(src);
    if (n > 0) out[p] = n;
  }
  return out;
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return { files: {} };
  try { return JSON.parse(readFileSync(BASELINE, "utf8")); } catch { return { files: {} }; }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) return selftest();

  const current = scan();
  const total = Object.values(current).reduce((a, b) => a + b, 0);

  if (args.includes("--update")) {
    const prev = loadBaseline().files || {};
    const allowRaise = args.includes("--allow-raise");
    if (!allowRaise) {
      for (const [f, n] of Object.entries(current)) {
        if (prev[f] !== undefined && n > prev[f]) {
          console.error(`REFUSING to raise baseline for ${f}: ${prev[f]} -> ${n}. Fix the regression or pass --allow-raise.`);
          process.exit(1);
        }
      }
    }
    const data = {
      note: "WIB em-dash ratchet: per-file count of raw em/en-dash chars in recipient-facing edge-email functions (see scripts/check-edge-email-emdash.mjs). Only lower these. sendEmail() humanizes at the boundary, so routing a function through it (and dropping its direct `new Resend(`) is the way to clear an entry.",
      total,
      files: current,
    };
    writeFileSync(BASELINE, JSON.stringify(data, null, 2) + "\n");
    console.log(`check-edge-email-emdash: baseline updated -> ${total} raw em/en-dash chars across ${Object.keys(current).length} files`);
    return;
  }

  const baseline = loadBaseline().files || {};
  const failures = [];
  const improvements = [];
  for (const [f, n] of Object.entries(current)) {
    const base = baseline[f];
    if (base === undefined) failures.push(`${f}: ${n} raw em/en-dash char(s) — NEW offender, not in baseline. Humanize this copy (route via sendEmail() or call humanize() before send).`);
    else if (n > base) failures.push(`${f}: ${n} raw em/en-dash char(s) > baseline ${base} — regression.`);
  }
  for (const [f, base] of Object.entries(baseline)) {
    const n = current[f] ?? 0;
    if (n < base) improvements.push(`${f}: ${n} < baseline ${base} — lower the baseline with: node scripts/check-edge-email-emdash.mjs --update`);
  }

  if (improvements.length) { console.log("check-edge-email-emdash: improvements available (ratchet can tighten):"); for (const i of improvements) console.log("  " + i); }

  if (failures.length) {
    console.error("check-edge-email-emdash: FAIL — raw em/en-dash AI-tell in recipient-facing email copy:");
    for (const f of failures) console.error("  " + f);
    process.exit(1);
  }
  console.log(`check-edge-email-emdash: OK — ${total} baselined raw em/en-dash char(s); no new/regressed offenders.`);
}

main();
