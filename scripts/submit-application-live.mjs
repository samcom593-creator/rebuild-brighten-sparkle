#!/usr/bin/env node
// submit-application-live.mjs — API-liveness of the public recruiting WRITE path.
// Owned by the Website Integrity Bot. Sibling of landing-feeds-live.mjs (read side).
//
// WHY THIS EXISTS (the blind spot it closes). Every recruit the agency gets flows
// through ONE endpoint: the public, anon-invokable `submit-application` edge function
// (verify_jwt=false). Apply.tsx invokes it for BOTH entry points — the full submit
// (onSubmit, src/pages/Apply.tsx:923) and the quick-qualify path (:784). If that
// function is boot-dead, 404 (not deployed), 5xx (crashing), or has lost anon invoke
// (401/403), the browser shows a "Failed to submit" toast and the applicant walks —
// and NOTHING pages Sam. This is the highest-$ write path in the business.
//
// What already watches the apply funnel is all SOURCE or DOWNSTREAM, none of it live:
//   - check-apply-field-parity / check-apply-form-render / check-funnel-capture-handler
//     etc. read SOURCE in verify:core. They cannot see a deployed-but-dead function.
//   - apex-doctor.d/54-applicant-lane.sh reads v_applicant_lane_pkg1_health — the
//     EMAIL LADDER that runs AFTER an applicant row exists. If submit-application
//     stops creating rows, nothing new enters the lane, and #54 reads that as a quiet
//     week, not a dead endpoint (the same quiet==dead trap landing-feeds-live closed
//     on the read side). The write endpoint itself has had zero runtime liveness.
//
// THE INVERSION THAT MATTERS (read this before "fixing" the guard). Unlike the read
// side, where a 200 is healthy, the HEALTHY STATE OF THIS WRITE PROBE IS A 400
// VALIDATION REJECTION. The probe POSTs a body that is GUARANTEED to fail Zod
// validation BEFORE any DB write (proven live: `{}` -> 400 Invalid input data,
// firstName Required; `{"quickQualify":true}` -> 400 same). Validation at
// index.ts:1256/1260 (full) and :1241/1244 (quick) precedes every .insert (the first
// is at :1084). So a 400 here means: deployed + boots + routes + validates + the
// write-gate is intact — WITHOUT ever creating a junk applicant or firing an
// onboarding email. A 2xx on an empty body would mean the write-gate was BYPASSED
// (an empty payload could write, or validation moved) -> that is the DEFECT, not the
// 400. Anyone who reads "400 = bad, flip it to require 200" would invert this guard
// into exactly the fake-success the APEX ledger keeps relearning. The 400 is the pass.
//
// NON-FLAPPING BY CONSTRUCTION. Grades LIVENESS, not applicant volume:
//   OK          = a 4xx validation rejection (400/422) carrying the function's own
//                 JSON error shape ({error:"...",details:[...]}). Alive, write-gate up.
//   DEFECT      = 2xx on an empty body (validation BYPASSED), 404 (not deployed),
//                 401/403 (anon invoke rejected — the front-end literally can't submit),
//                 5xx (crashing/boot-dead), a 4xx with a non-JSON body (HTML error/login
//                 page), or a 4xx with no validation shape. The write funnel is down.
//   UNKNOWN     = 429 (rate-limited — the function is alive but we can't confirm the
//                 write-gate cleanly this tick; transient, retried next cron, NEVER a
//                 false-red), or the fetch threw (DNS/offline/timeout — Sam's known DNS
//                 drops must never page, the same discipline the browser legs use).
// Overall: DEFECT if any leg is DEFECT (exit 1, cron pages). If NO leg is OK (all
// UNKNOWN/UNREACHABLE) -> UNKNOWN (exit 0, can't-see != is-broken). Else CLEAN (exit 0).
//
// IT NEVER WRITES A ROW. Both probe bodies fail validation before the insert — proven
// live, and self-checked every run: if either ever returns 2xx the probe reports DEFECT
// (validation bypassed) rather than treating a write as success.
//
// NAMING: intentionally NOT check-*.mjs — this is a network/live probe run by cron
// (apex-live-render-cron.sh), not a verify:core / pre-commit gate. A flaky prod network
// call must NEVER block a push (the lesson from every live-check). Same convention +
// owner as its siblings live-render-integrity.mjs and landing-feeds-live.mjs;
// check-guard-wiring.mjs governs only check-*.mjs gates, so this is correctly outside it.
//
// Run:        node scripts/submit-application-live.mjs
// Selftest:   node scripts/submit-application-live.mjs --selftest   (proven both ways, live)

import { writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.LANDING_SUPABASE_URL || "https://xrzweoneiieddzxogewk.supabase.co";
// The publishable (anon) key is public BY DESIGN — it ships in the client bundle and is
// exactly what Apply.tsx uses to invoke this function. Env override tracks a key rotation.
const ANON = process.env.LANDING_ANON_KEY || "sb_publishable_bVcDNOOdWJemjyveYpAaKQ_plKNXMAw";
const RESULT_FILE = process.env.RESULT_FILE || "";
const TIMEOUT_MS = Number(process.env.SUBMIT_PROBE_TIMEOUT_MS || 12000);
const FN = "submit-application";

// The two public recruit entry points, each with a body PROVEN to 400 before any write.
// `label` is what a page/log names; `body` is sent verbatim.
const LEGS = [
  { label: "full-submit", body: "{}" },
  { label: "quick-qualify", body: '{"quickQualify":true}' },
];

// ---- PURE CLASSIFIER (unit-tested by --selftest with mock inputs; no network) ----
// Given the HTTP status and raw body text, return OK | DEFECT | UNKNOWN. UNREACHABLE
// (a thrown fetch) is decided by the caller, never here, so this stays deterministic.
export function classify(status, bodyText) {
  // A 2xx on a deliberately-invalid body means validation was BYPASSED — the write-gate
  // moved or an empty payload can now write. This is the catastrophic case, not the pass.
  if (status >= 200 && status < 300) return { state: "DEFECT", reason: `validation BYPASSED (HTTP ${status} on empty body)` };
  if (status === 404) return { state: "DEFECT", reason: "function not deployed (404)" };
  if (status === 401 || status === 403) return { state: "DEFECT", reason: `anon invoke rejected (HTTP ${status}) — the front-end cannot submit` };
  if (status === 429) return { state: "UNKNOWN", reason: "rate-limited (429, transient)" };
  if (status >= 500) return { state: "DEFECT", reason: `function erroring (HTTP ${status})` };
  // Remaining: a 4xx we expect to be a validation rejection (400/422).
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { state: "DEFECT", reason: `non-JSON body on HTTP ${status} (HTML error/login?)` };
  }
  const hasValidationShape =
    body && typeof body === "object" && !Array.isArray(body) &&
    (typeof body.error === "string" || Array.isArray(body.details));
  if (hasValidationShape) return { state: "OK", reason: `validation rejection (HTTP ${status})` };
  return { state: "DEFECT", reason: `HTTP ${status} without the function's validation shape` };
}

async function probe(leg) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${FN}`, {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        "Content-Type": "application/json",
      },
      body: leg.body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    const c = classify(res.status, text);
    return { leg: leg.label, ...c, status: res.status };
  } catch (e) {
    // DNS drop / offline / timeout — the network, not the site. Never a defect.
    return { leg: leg.label, state: "UNREACHABLE", reason: String(e?.name || e), status: 0 };
  } finally {
    clearTimeout(t);
  }
}

export function overall(results) {
  if (results.some((r) => r.state === "DEFECT")) return "DEFECT";
  if (!results.some((r) => r.state === "OK")) return "UNKNOWN"; // all UNKNOWN/UNREACHABLE
  return "CLEAN";
}

async function main() {
  const results = [];
  for (const l of LEGS) results.push(await probe(l));
  const verdict = overall(results);
  const out = { verdict, ts: new Date().toISOString(), base: SUPABASE_URL, fn: FN, legs: results };

  if (RESULT_FILE) {
    try { writeFileSync(RESULT_FILE, JSON.stringify(out, null, 1)); }
    catch (e) { console.error(`result-file write failed: ${e}`); }
  }

  for (const r of results) {
    const glyph = r.state === "OK" ? "✓" : r.state === "UNKNOWN" || r.state === "UNREACHABLE" ? "?" : "✗";
    console.log(`  ${glyph} ${r.leg.padEnd(16)} ${r.state.padEnd(12)} ${r.reason}`);
  }
  console.log(`\nVERDICT: ${verdict}`);
  process.exit(verdict === "DEFECT" ? 1 : 0);
}

// ---------------------------- SELFTEST ----------------------------
async function selftest() {
  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

  // --- pure classifier, mock inputs (deterministic, no network) ---
  ok("400 + validation shape -> OK (the healthy write state)",
    classify(400, '{"error":"Invalid input data","details":[{"path":["firstName"],"message":"Required"}]}').state === "OK");
  ok("422 + error shape -> OK (alive, a post-validation reject)",
    classify(422, '{"error":"Email is suspended"}').state === "OK");
  ok("200 on empty body -> DEFECT (validation BYPASSED — write-gate moved)",
    classify(200, '{"applicationId":"abc","status":"quick_qualified"}').state === "DEFECT");
  ok("201 on empty body -> DEFECT", classify(201, "{}").state === "DEFECT");
  ok("404 -> DEFECT (not deployed)", classify(404, '{"code":"NOT_FOUND","message":"Requested function was not found"}').state === "DEFECT");
  ok("401 -> DEFECT (anon invoke rejected)", classify(401, '{"message":"JWT"}').state === "DEFECT");
  ok("403 -> DEFECT (anon invoke rejected)", classify(403, '{"message":"forbidden"}').state === "DEFECT");
  ok("500 -> DEFECT (crashing)", classify(500, '{"code":"BOOT_ERROR"}').state === "DEFECT");
  ok("503 -> DEFECT", classify(503, "service unavailable").state === "DEFECT");
  ok("429 -> UNKNOWN (rate-limited, transient, never false-red)", classify(429, '{"error":"Too many requests."}').state === "UNKNOWN");
  ok("400 + non-JSON (HTML error page) -> DEFECT", classify(400, "<!doctype html><html>error</html>").state === "DEFECT");
  ok("400 + JSON but no validation shape -> DEFECT", classify(400, '{"foo":1}').state === "DEFECT");

  // --- overall() verdict composition ---
  ok("overall: any DEFECT -> DEFECT", overall([{ state: "OK" }, { state: "DEFECT" }]) === "DEFECT");
  ok("overall: all UNREACHABLE -> UNKNOWN (DNS drop, never false-red)",
    overall([{ state: "UNREACHABLE" }, { state: "UNREACHABLE" }]) === "UNKNOWN");
  ok("overall: all UNKNOWN (both 429) -> UNKNOWN", overall([{ state: "UNKNOWN" }, { state: "UNKNOWN" }]) === "UNKNOWN");
  ok("overall: one OK among unreachable -> CLEAN (not UNKNOWN)",
    overall([{ state: "UNREACHABLE" }, { state: "OK" }]) === "CLEAN");
  ok("overall: both OK -> CLEAN", overall([{ state: "OK" }, { state: "OK" }]) === "CLEAN");

  // --- LIVE both-direction proof against prod ---
  const realFull = await probe(LEGS[0]);       // {} -> 400 validation
  ok(`LIVE GREEN: full-submit empty body -> OK (${realFull.state}: ${realFull.reason})`, realFull.state === "OK");
  const realQuick = await probe(LEGS[1]);      // {"quickQualify":true} -> 400 validation
  ok(`LIVE GREEN: quick-qualify empty body -> OK (${realQuick.state}: ${realQuick.reason})`, realQuick.state === "OK");
  // RED direction, live: an undeployed function name must read DEFECT (404).
  const bogusRes = await (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-application-does-not-exist-probe`, {
        method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: "{}",
      });
      return classify(res.status, await res.text());
    } catch (e) { return { state: "UNREACHABLE", reason: String(e?.name || e) }; }
  })();
  ok(`LIVE RED: undeployed function -> DEFECT (${bogusRes.state} ${bogusRes.reason})`, bogusRes.state === "DEFECT");

  console.log(`\nselftest: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

if (process.argv.includes("--selftest")) selftest();
else main();
