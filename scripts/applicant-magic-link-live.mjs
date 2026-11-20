#!/usr/bin/env node
// applicant-magic-link-live.mjs — API-liveness of the applicant AUTH / one-click
// login mint. Owned by the Website Integrity Bot. Third sibling of
// landing-feeds-live.mjs (funnel READ side) and submit-application-live.mjs
// (funnel WRITE side); this is the AUTH side.
//
// WHY THIS EXISTS (the blind spot it closes). After a recruit submits, the
// post-application confirmation page (ApplicationConfirmationV2, rendered by
// /apply/success, /apply/success/licensed and /apply/success/unlicensed AND
// /status/:id) invokes the anon, verify_jwt=false edge function
// `applicant-magic-link` to mint a Supabase NATIVE magic-login URL — Sam's
// explicit "point and clear, they're logged in" flow (2026-06-15). The licensed
// branch surfaces it as the "Activate portal & start contracting" CTA; the
// unlicensed branch uses it so the "Watch the licensing video" button auto-logs
// the applicant in and lands on the course. BOTH branches FALL BACK SILENTLY:
// ApplicationConfirmationV2.tsx:98-108 treats any error as non-fatal, leaves
// autoLoginUrl null, and the licensed Activate-portal CTA never renders at all
// while the unlicensed link drops to a plain non-authenticated /get-licensed. So
// a boot-dead / 404 (not deployed) / 5xx (crashing) / anon-rejected (401/403)
// mint is INVISIBLE: the applicant just loses the frictionless one-click login
// Sam built, and NOTHING pages him.
//
// What already references this function is all STATIC, none live:
//   - check-deployed-function-freshness.mjs proves the DEPLOYED bytes match
//     source (a freshness diff), not that the running function answers.
//   - check-pg-anon-bearer.mjs / check-credential-minting.mjs are SECURITY
//     source scans (MP-447 account-takeover hardening). They cannot see a
//     deployed-but-dead function. The mint endpoint itself has had zero runtime
//     liveness.
//
// THE INVERSION THAT MATTERS (read this before "fixing" the guard). Like the
// WRITE probe, the HEALTHY STATE HERE IS A 400 — specifically the MP-447
// no-credential refusal. The probe sends bodies PROVEN live to refuse BEFORE any
// mint: `{}` (no email, no applicationId) and a nil-UUID applicationId that
// resolves to no row. Both hit index.ts:143 `if (!email) -> 400 {"error":"email
// or applicationId required"}` — which runs BEFORE sb.auth.admin.createUser
// (:180) and generateLink (:200). So a 400 here means: deployed + boots + routes
// + anon-invokable + the MP-447 gate is intact — WITHOUT ever creating an auth
// user or returning a working login link. A 2xx on these bodies is the DEFECT,
// not the pass: it means the no-credential gate was BYPASSED and the endpoint is
// minting a session on empty/nonexistent input — the exact account-takeover
// regression MP-447 closed. Anyone who reads "400 = bad, require 200" would
// invert this into fake-success AND re-open a credential-minting hole. The 400
// is the pass.
//
// NOTHING IS MINTED, NO USER IS CREATED. Both probe bodies fail at :143 before
// createUser/generateLink — proven live, and self-checked every run: if either
// ever returns 2xx the probe reports DEFECT (gate bypassed) rather than treating
// a mint as success. The nil-UUID 00000000-0000-0000-0000-000000000000 is a
// valid UUID that matches no applications.id (they are random v4s); maybeSingle
// returns null, email stays null, and the refusal fires with zero side effects.
//
// NON-FLAPPING BY CONSTRUCTION. Grades LIVENESS, not applicant volume:
//   OK          = a 4xx refusal (400/422) carrying the function's own JSON error
//                 shape ({error:"..."}). Alive, the no-credential gate is up.
//   DEFECT      = 2xx on a no-credential body (mint gate BYPASSED — MP-447
//                 regression), 404 (not deployed — the auto-login CTA is dead),
//                 401/403 (anon invoke rejected — the confirmation page literally
//                 cannot mint; the function's OWN 403 (not_eligible) and 503
//                 (eligibility_unverifiable) are unreachable on these bodies
//                 because they require a resolved email, so a 403/5xx here is a
//                 gateway/infra failure, not a business refusal), 5xx (crashing),
//                 a 4xx with a non-JSON body (HTML error/login page), or a 4xx
//                 with no error shape. The mint path is down.
//   UNKNOWN     = 429 (rate-limited — alive but can't confirm cleanly this tick;
//                 transient, retried next cron, NEVER a false-red), or the fetch
//                 threw (DNS/offline/timeout — Sam's known DNS drops must never
//                 page, the same discipline the sibling legs use).
// Overall: DEFECT if any leg is DEFECT (exit 1, cron pages). If NO leg is OK (all
// UNKNOWN/UNREACHABLE) -> UNKNOWN (exit 0, can't-see != is-broken). Else CLEAN.
//
// NAMING: intentionally NOT check-*.mjs — this is a network/live probe run by
// cron (apex-live-render-cron.sh), not a verify:core / pre-commit gate. A flaky
// prod network call must NEVER block a push. Same convention + owner as its
// siblings live-render-integrity.mjs, landing-feeds-live.mjs and
// submit-application-live.mjs; check-guard-wiring.mjs governs only check-*.mjs
// gates, so this is correctly outside it.
//
// Run:        node scripts/applicant-magic-link-live.mjs
// Selftest:   node scripts/applicant-magic-link-live.mjs --selftest   (both ways, live)

import { writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.LANDING_SUPABASE_URL || "https://xrzweoneiieddzxogewk.supabase.co";
// The publishable (anon) key is public BY DESIGN — it ships in the client bundle and is
// exactly what ApplicationConfirmationV2 uses to invoke this function. Env override tracks
// a key rotation.
const ANON = process.env.LANDING_ANON_KEY || "sb_publishable_bVcDNOOdWJemjyveYpAaKQ_plKNXMAw";
const RESULT_FILE = process.env.RESULT_FILE || "";
const TIMEOUT_MS = Number(process.env.MAGIC_LINK_PROBE_TIMEOUT_MS || 12000);
const FN = "applicant-magic-link";

// Two no-credential bodies, each PROVEN live to refuse at index.ts:143 BEFORE any
// createUser/generateLink. `label` is what a page/log names; `body` is sent verbatim.
//   full-refuse : {} — no email, no applicationId. Proves the pre-lookup gate.
//   nil-applicant: a valid UUID that matches no applications row. Proves the DB
//                  lookup path runs and STILL refuses (no row -> null email ->
//                  400). A nonexistent applicationId can never mint.
const LEGS = [
  { label: "full-refuse", body: "{}" },
  { label: "nil-applicant", body: '{"applicationId":"00000000-0000-0000-0000-000000000000","redirectPath":"/dashboard"}' },
];

// ---- PURE CLASSIFIER (unit-tested by --selftest with mock inputs; no network) ----
// Given the HTTP status and raw body text, return OK | DEFECT | UNKNOWN. UNREACHABLE
// (a thrown fetch) is decided by the caller, never here, so this stays deterministic.
export function classify(status, bodyText) {
  // A 2xx on a no-credential body means the MP-447 gate was BYPASSED — the endpoint
  // is minting a login session on empty/nonexistent input. Account takeover, not a pass.
  if (status >= 200 && status < 300) return { state: "DEFECT", reason: `mint gate BYPASSED (HTTP ${status} on no-credential body) — MP-447 regression` };
  if (status === 404) return { state: "DEFECT", reason: "function not deployed (404) — the one-click auto-login mint is dead" };
  if (status === 401 || status === 403) return { state: "DEFECT", reason: `anon invoke rejected (HTTP ${status}) — the confirmation page cannot mint the auto-login` };
  if (status === 429) return { state: "UNKNOWN", reason: "rate-limited (429, transient)" };
  if (status >= 500) return { state: "DEFECT", reason: `function erroring (HTTP ${status})` };
  // Remaining: a 4xx we expect to be the no-credential refusal (400/422).
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { state: "DEFECT", reason: `non-JSON body on HTTP ${status} (HTML error/login?)` };
  }
  const hasErrorShape =
    body && typeof body === "object" && !Array.isArray(body) && typeof body.error === "string";
  if (hasErrorShape) return { state: "OK", reason: `no-credential refusal (HTTP ${status}: ${body.error})` };
  return { state: "DEFECT", reason: `HTTP ${status} without the function's error shape` };
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
  ok("400 + error shape -> OK (the healthy no-credential-refusal state)",
    classify(400, '{"error":"email or applicationId required"}').state === "OK");
  ok("422 + error shape -> OK (alive, a post-refusal 4xx)",
    classify(422, '{"error":"something"}').state === "OK");
  ok("200 on no-credential body -> DEFECT (mint gate BYPASSED — MP-447 regression)",
    classify(200, '{"success":true,"action_link":"https://...","created_user":true}').state === "DEFECT");
  ok("201 on no-credential body -> DEFECT", classify(201, "{}").state === "DEFECT");
  ok("404 -> DEFECT (not deployed, auto-login CTA dead)",
    classify(404, '{"code":"NOT_FOUND","message":"Requested function was not found"}').state === "DEFECT");
  ok("401 -> DEFECT (anon invoke rejected)", classify(401, '{"message":"JWT"}').state === "DEFECT");
  ok("403 -> DEFECT (anon invoke rejected; the fn's own not_eligible 403 is unreachable on these bodies)",
    classify(403, '{"message":"forbidden"}').state === "DEFECT");
  ok("500 -> DEFECT (crashing)", classify(500, '{"error":"create_user_failed"}').state === "DEFECT");
  ok("503 -> DEFECT (the fn's eligibility_unverifiable 503 needs a resolved email; unreachable here = infra)",
    classify(503, '{"error":"eligibility_unverifiable"}').state === "DEFECT");
  ok("429 -> UNKNOWN (rate-limited, transient, never false-red)", classify(429, '{"error":"Too many requests."}').state === "UNKNOWN");
  ok("400 + non-JSON (HTML error page) -> DEFECT", classify(400, "<!doctype html><html>error</html>").state === "DEFECT");
  ok("400 + JSON but no error string -> DEFECT", classify(400, '{"foo":1}').state === "DEFECT");

  // --- overall() verdict composition ---
  ok("overall: any DEFECT -> DEFECT", overall([{ state: "OK" }, { state: "DEFECT" }]) === "DEFECT");
  ok("overall: all UNREACHABLE -> UNKNOWN (DNS drop, never false-red)",
    overall([{ state: "UNREACHABLE" }, { state: "UNREACHABLE" }]) === "UNKNOWN");
  ok("overall: all UNKNOWN (both 429) -> UNKNOWN", overall([{ state: "UNKNOWN" }, { state: "UNKNOWN" }]) === "UNKNOWN");
  ok("overall: one OK among unreachable -> CLEAN (not UNKNOWN)",
    overall([{ state: "UNREACHABLE" }, { state: "OK" }]) === "CLEAN");
  ok("overall: both OK -> CLEAN", overall([{ state: "OK" }, { state: "OK" }]) === "CLEAN");

  // --- LIVE both-direction proof against prod ---
  const realFull = await probe(LEGS[0]);   // {} -> 400 no-credential refusal
  ok(`LIVE GREEN: full-refuse {} -> OK (${realFull.state}: ${realFull.reason})`, realFull.state === "OK");
  const realNil = await probe(LEGS[1]);    // nil-UUID -> 400, lookup ran, no row, no mint
  ok(`LIVE GREEN: nil-applicant UUID -> OK (${realNil.state}: ${realNil.reason})`, realNil.state === "OK");
  // Proof the pass carries NO mint: a healthy run must never return action_link/success.
  const realFullBody = await (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${FN}`, {
        method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: "{}",
      });
      return await res.text();
    } catch { return ""; }
  })();
  ok(`LIVE SAFE: healthy response carries NO action_link / no mint (${realFullBody.slice(0, 60)})`,
    !/action_link|"success"\s*:\s*true/.test(realFullBody));
  // RED direction, live: an undeployed function name must read DEFECT (404).
  const bogusRes = await (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/applicant-magic-link-does-not-exist-probe`, {
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
