import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { walk, stripComments } from "./lib/scan-utils.mjs";
// check-resend-gate — PL-WIB-RESEND-GATE (2026-10-22)
//
// Every send to Resend must pass the email_suppressions gate. Resend accepts a
// send to an address on its suppression list, returns an id, and never
// attempts it, so a sender that skips the gate logs "sent" for mail that
// cannot arrive and spends the domain reputation applicant onboarding rides on.
//
// 3c9d136f put the gate in sendEmail (_shared/email.ts). It covered 11
// senders. 82 constructed the SDK themselves and 26 posted to the REST API, so
// on the gate's first full day three already-suppressed addresses were mailed
// anyway. The SDK senders now wrap their instance: gateResend(new Resend(k)).
//
// Rules, all graded on code with comments stripped (a `new Resend(` inside a
// comment is not a call site):
//   1. Every `new Resend(` is the direct argument of `gateResend(`, unless the
//      file is in GATED_ELSEWHERE (gates by another route, reason given) or in
//      UNGATED_SDK (known debt).
//   2. Every file that names api.resend.com/emails is in RAW_REST (known debt)
//      or REST_READERS (reads, never sends).
//   3. The debt lists only shrink: a listed file that no longer needs listing
//      fails until it is removed, so a fixed file cannot be silently re-broken
//      under cover of its old entry. Named sets, never a count: a count lets a
//      new offender hide behind an unrelated fix (MP-356).
//
// --selftest drives the grader over fixtures, including a red for each rule.

const ROOT = resolve(import.meta.dirname, "..");
const FN_DIR = resolve(ROOT, "supabase/functions");

const GATED_ELSEWHERE = {
  "_shared/email.ts": "sendEmail filters recipients through lookupSuppressed before its own send",
};
const REST_READERS = {
  "resend-suppression-sync/index.ts": "GETs /emails to build the suppression list; sends nothing",
};
// Known debt. Remove a line when its file is fixed; never add one.
const UNGATED_SDK = new Set([
  "seminar-confirmation/index.ts", // held by a concurrent worker's uncommitted edit on 2026-10-22
]);
const RAW_REST = new Set([
  "apex-outbox-dispatcher/index.ts", "brand-collab/index.ts", "check-early-performance/index.ts",
  "check-low-aop-friday/index.ts", "detect-dropped-leads/index.ts", "detect-production-gaps/index.ts",
  "manychat-webhook/index.ts", "monday-starter-reminders/index.ts", "notify-all-managers-leaderboard/index.ts",
  "notify-hire-announcement/index.ts", "notify-seminar-signup/index.ts", "notify-test-reminder/index.ts",
  "notify-test-scheduled/index.ts", "onboarding-call-invites/index.ts", "outreach-sender/index.ts",
  "schedule-auto-populate/index.ts", "schedule-interview/index.ts", "seminar-register/index.ts",
  "send-agent-onboarding-email/index.ts", "send-bulk-unlicensed-outreach/index.ts", "send-calendly-invite/index.ts",
  "send-candidate-confirmation/index.ts", "send-couldnt-reach-email/index.ts", "send-daily-producer-spotlight/index.ts",
  "send-proactive-coaching/index.ts", "welcome-new-agent/index.ts",
]);

/** files: Map<relPath, source>. Returns a list of violation strings. */
export function grade(files, lists = { GATED_ELSEWHERE, REST_READERS, UNGATED_SDK, RAW_REST }) {
  const out = [];
  const ungatedSeen = new Set();
  const restSeen = new Set();
  for (const [rel, src] of files) {
    const code = stripComments(src);
    const bare = [];
    for (const m of code.matchAll(/new\s+Resend\s*\(/g)) {
      const before = code.slice(Math.max(0, m.index - 40), m.index);
      if (!/gateResend\s*\(\s*$/.test(before)) bare.push(code.slice(0, m.index).split("\n").length);
    }
    if (bare.length && !(rel in lists.GATED_ELSEWHERE)) {
      if (lists.UNGATED_SDK.has(rel)) ungatedSeen.add(rel);
      else out.push(`${rel}:${bare[0]}: new Resend(...) is not wrapped. Use gateResend(new Resend(key)) from ../_shared/resend-gate.ts`);
    }
    if (/api\.resend\.com\/emails/.test(code) && !(rel in lists.REST_READERS)) {
      if (lists.RAW_REST.has(rel)) restSeen.add(rel);
      else out.push(`${rel}: posts to api.resend.com/emails directly, past the suppression gate. Send through sendEmail (_shared/email.ts) or gateResend(new Resend(key))`);
    }
  }
  for (const rel of lists.UNGATED_SDK) {
    if (!ungatedSeen.has(rel)) out.push(`${rel}: listed in UNGATED_SDK but has no unwrapped new Resend( (fixed or gone). Remove it from the list`);
  }
  for (const rel of lists.RAW_REST) {
    if (!restSeen.has(rel)) out.push(`${rel}: listed in RAW_REST but no longer names api.resend.com/emails (fixed or gone). Remove it from the list`);
  }
  return out;
}

function load() {
  const files = new Map();
  for (const abs of walk(FN_DIR)) {
    if (!abs.endsWith(".ts") || abs.endsWith(".test.ts")) continue;
    files.set(relative(FN_DIR, abs), readFileSync(abs, "utf8"));
  }
  return files;
}

function selftest() {
  const L = { GATED_ELSEWHERE: { "_shared/email.ts": "x" }, REST_READERS: { "r/index.ts": "x" }, UNGATED_SDK: new Set(["u/index.ts"]), RAW_REST: new Set(["p/index.ts"]) };
  const base = () => new Map([
    ["ok/index.ts", 'const r = gateResend(new Resend(Deno.env.get("K")));'],
    ["k/index.ts", "const r = k ? gateResend(\n  new Resend(k)\n) : null;"],
    ["_shared/email.ts", "const r = new Resend(k);"],
    ["u/index.ts", "const r = new Resend(k);"],
    ["p/index.ts", 'await fetch("https://api.resend.com/emails", {});'],
    ["r/index.ts", 'await fetch("https://api.resend.com/emails?limit=100");'],
    ["c/index.ts", "// was: new Resend(k)\n/* api.resend.com/emails */\nconst r = gateResend(new Resend(k));"],
  ]);
  const cases = [
    ["clean fixture set", (f) => f, 0],
    ["new unwrapped SDK file", (f) => f.set("n/index.ts", "const r = new Resend(k);"), 1],
    ["new raw REST sender", (f) => f.set("n/index.ts", 'fetch("https://api.resend.com/emails")'), 1],
    ["UNGATED_SDK entry gone stale", (f) => f.set("u/index.ts", "const r = gateResend(new Resend(k));"), 1],
    ["RAW_REST entry gone stale", (f) => f.set("p/index.ts", "await sendEmail({});"), 1],
    ["wrap removed from a fixed file", (f) => f.set("ok/index.ts", "const r = new Resend(k);"), 1],
  ];
  let bad = 0;
  for (const [name, mut, want] of cases) {
    const f = base(); mut(f);
    const got = grade(f, L).length;
    const pass = got === want;
    if (!pass) bad++;
    console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${got} violation(s), want ${want}`);
  }
  console.log(bad ? `selftest: ${bad} FAIL` : `selftest: ${cases.length}/${cases.length} PASS`);
  return bad ? 1 : 0;
}

if (process.argv.includes("--selftest")) process.exit(selftest());
if (!existsSync(FN_DIR)) { console.error(`check-resend-gate: ${FN_DIR} missing`); process.exit(2); }
const files = load();
if (files.size < 50) { console.error(`check-resend-gate: only ${files.size} function files found; refusing to call that clean`); process.exit(2); }
const v = grade(files);
if (v.length) {
  console.error(`check-resend-gate: ${v.length} violation(s)`);
  for (const line of v) console.error("  " + line);
  process.exit(1);
}
console.log(`check-resend-gate: OK (${files.size} files; SDK debt ${UNGATED_SDK.size}, raw REST debt ${RAW_REST.size})`);
