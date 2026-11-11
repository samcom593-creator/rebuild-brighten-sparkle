#!/usr/bin/env node
/**
 * check-funnel-capture-handler — does the recruit-capture POST handler RUN?
 *
 * WHY THIS EXISTS (MP-WIB-FUNNEL-CAPTURE-HANDLER, 2026-11-11). Every recruit
 * lead on apex-financial.org — the quick-qualify step AND the full submit —
 * flows through ONE edge function: submit-application (src/pages/Apply.tsx:784
 * and :923, both `supabase.functions.invoke("submit-application")`). It is the
 * single highest-$ endpoint on the funnel: if it stops capturing, the agency's
 * recruiting pipeline goes silent and nothing on the site looks wrong.
 *
 * check-edge-boot already probes it daily — but with OPTIONS, DELIBERATELY, to
 * avoid side effects across 228 functions. OPTIONS is answered by createHandler's
 * CORS branch BEFORE any handler logic runs. So a function whose module loads
 * fine (OPTIONS 200, edge-boot GREEN) but whose POST handler throws before it
 * validates — a top-of-handler env read, a synchronous throw, a broken
 * `await req.json()` path — passes edge-boot while EVERY real submission 500s.
 * OPTIONS structurally cannot see that class. This guard asks the one question
 * OPTIONS cannot: does an anonymous POST reach the handler and get the handler's
 * OWN response?
 *
 * THE PROBE IS AN EMPTY-BODY POST, AND IT IS SIDE-EFFECT-SAFE. `{}` is not
 * `quickQualify:true`, so it takes the FullSubmitApplicationSchema branch
 * (index.ts:1432), fails zod with every required field missing, and returns
 * index.ts:1437 — `{ error: "Invalid input data", details: <zod issues> }` —
 * BEFORE any insert, email, or Discord ping. Verified against live prod
 * 2026-11-11: HTTP 400 with that exact body, no lead created. A healthy response
 * therefore proves the POST handler executed all the way to validation, which is
 * strictly more than "the module loaded".
 *
 * ONLY submit-application is probed. A function earns a place in TARGETS only
 * after its empty-body path is PROVEN to reject before any side effect — do not
 * add one on the assumption that it does.
 *
 * VERDICTS — 'could not look' is never laundered into 'healthy':
 *   HEALTHY        4xx carrying the handler's validation body (error + non-empty
 *                  details/issues) — the POST handler ran and validated.
 *   DEAD           5xx with WORKER_ERROR/BOOT_ERROR — the handler threw. The
 *                  boots-but-broken class edge-boot's OPTIONS cannot reach.
 *   ABSENT         404 — not deployed.
 *   ACCEPTED_EMPTY 2xx to an empty body — validation bypassed; a capture
 *                  endpoint that accepts a blank submission is broken and would
 *                  mint junk leads.
 *   AUTH_WALLED    401/403 — an anonymous caller (even carrying the public anon
 *                  key) was refused at the gateway, so no recruit reaches the
 *                  handler.
 *   UNVALIDATED    4xx with no handler-validation body — the response was not
 *                  authored by the handler's validator; its contract changed or
 *                  the request died before it.
 *   unknown        transport failure, or a 5xx with no boot marker, that
 *                  survives retries. Control-gated against a plain OPTIONS: if
 *                  the control is ALSO unreachable it is this network, not a
 *                  dead handler — reported, never counted as healthy, never
 *                  paged as a red.
 *
 * This grades PRODUCTION, not the working tree, so the LIVE probe is NOT a
 * commit gate — a correct tree can front last week's deployed bytes (MP-398).
 * The pure classifier is proven every commit via `--selftest` (no network);
 * the live probe runs on a schedule (.github/workflows/funnel-capture.yml) and
 * by hand.
 */

const BASE = process.env.APEX_FUNCTIONS_BASE ?? "https://xrzweoneiieddzxogewk.supabase.co/functions/v1";
const SITE = process.env.APEX_SITE_ORIGIN ?? "https://apex-financial.org";
const ATTEMPTS = 3;

// Only functions whose empty-body POST is PROVEN to reject before any side
// effect. See the header. Probe body is `{}` — never quickQualify, so it can
// never satisfy the full schema and can never write.
const TARGETS = ["submit-application"];

const DEFECT = new Set(["DEAD", "ABSENT", "ACCEPTED_EMPTY", "AUTH_WALLED", "UNVALIDATED"]);
const BOOT_MARKER = /WORKER_ERROR|BOOT_ERROR|worker boot error|Function exited due to an error/i;

/**
 * Pure classifier — the whole verdict, given only what the wire returned.
 * Kept side-effect-free so --selftest can drive every branch with no network.
 * `transport` is true when no HTTP response came back at all.
 */
export function classify({ status, body, transport }) {
  if (transport) return "unknown";
  if (status === 404) return "ABSENT";
  if (status === 401 || status === 403) return "AUTH_WALLED";
  if (status >= 500) return BOOT_MARKER.test(body || "") ? "DEAD" : "unknown";
  if (status >= 200 && status < 300) return "ACCEPTED_EMPTY";
  if (status === 400 || status === 422) {
    let json = null;
    try { json = JSON.parse(body); } catch { /* non-JSON 4xx handled below */ }
    const issues = json && (json.details ?? json.issues ?? json.errors);
    // The handler at index.ts:1437 returns { error, details:[zod issues] }. Accept
    // any 4xx whose body carries a non-empty validation array so a benign message
    // change ("Invalid input data" -> something else) does not false-red; require
    // the array to be non-empty so an empty details:[] cannot pass for validation.
    if (Array.isArray(issues) && issues.length > 0) return "HEALTHY";
    return "UNVALIDATED";
  }
  return "UNVALIDATED";
}

async function fetchAnonKey() {
  // The publishable anon key is public (shipped in the browser bundle). MP-300:
  // the bundle is truth. Best-effort; a keyless POST still reaches a
  // verify_jwt=false function, so a failure here does not fail the probe.
  if (process.env.APEX_SUPABASE_ANON_KEY) return process.env.APEX_SUPABASE_ANON_KEY;
  try {
    const html = await (await fetch(SITE, { signal: AbortSignal.timeout(15000) })).text();
    const asset = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
    if (!asset) return null;
    const js = await (await fetch(SITE + asset, { signal: AbortSignal.timeout(20000) })).text();
    return js.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function post(slug, anonKey) {
  const headers = { "Content-Type": "application/json", Origin: SITE };
  if (anonKey) { headers.apikey = anonKey; headers.Authorization = `Bearer ${anonKey}`; }
  let lastErr = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BASE}/${slug}`, {
        method: "POST",
        headers,
        body: "{}",
        signal: AbortSignal.timeout(20000),
      });
      // Classify on the FULL body — the validator's JSON response carries one
      // issue per missing required field and runs well past 1KB, so truncating
      // before JSON.parse would break it and read a HEALTHY reject as
      // UNVALIDATED (the first draft of this script did exactly that). Keep a
      // short slice only for the human-facing line.
      const full = await res.text();
      const verdict = classify({ status: res.status, body: full, transport: false });
      // A lone 5xx-without-marker can be a gateway blip; give retries a chance
      // before settling on unknown.
      if (verdict === "unknown" && attempt < ATTEMPTS) { await sleep(attempt * 2000); continue; }
      return { slug, verdict, status: res.status, body: full.slice(0, 600) };
    } catch (e) {
      lastErr = e;
      if (attempt < ATTEMPTS) await sleep(attempt * 2000);
    }
  }
  return { slug, verdict: "unknown", status: 0, body: String(lastErr?.message ?? lastErr), transport: true };
}

async function controlReachable(slug) {
  // A plain OPTIONS, no side effects. Proves the base URL + this network can
  // reach the worker at all, so a transport-dead POST can be told apart from a
  // dead endpoint (MP-291/MP-304: a wifi outage must never read as a defect).
  try {
    const res = await fetch(`${BASE}/${slug}`, {
      method: "OPTIONS",
      headers: { Origin: SITE, "Access-Control-Request-Method": "POST" },
      signal: AbortSignal.timeout(15000),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── selftest: prove every branch of classify() both directions, no network ───
function selftest() {
  const cases = [
    // [name, input, expected]
    ["healthy zod reject (live prod shape)", { status: 400, body: JSON.stringify({ error: "Invalid input data", details: [{ path: ["email"], message: "Required", code: "invalid_type" }] }) }, "HEALTHY"],
    ["healthy 422 with issues[]", { status: 422, body: JSON.stringify({ issues: [{ path: ["phone"], message: "Required" }] }) }, "HEALTHY"],
    ["healthy after benign message change", { status: 400, body: JSON.stringify({ error: "validation failed", details: [{ path: ["firstName"] }] }) }, "HEALTHY"],
    ["boots-but-broken handler throw", { status: 500, body: "WORKER_ERROR: Uncaught TypeError in handler" }, "DEAD"],
    ["undeployed", { status: 404, body: "" }, "ABSENT"],
    ["validation bypassed", { status: 200, body: JSON.stringify({ ok: true }) }, "ACCEPTED_EMPTY"],
    ["accepted 201", { status: 201, body: "{}" }, "ACCEPTED_EMPTY"],
    ["gateway auth wall (verify_jwt flipped / anon key rejected)", { status: 401, body: "{\"message\":\"Invalid JWT\"}" }, "AUTH_WALLED"],
    ["403 forbidden", { status: 403, body: "" }, "AUTH_WALLED"],
    ["4xx but NOT the validator (contract changed)", { status: 400, body: "Bad Request" }, "UNVALIDATED"],
    ["4xx with empty details[] must NOT pass for validation", { status: 400, body: JSON.stringify({ error: "Invalid input data", details: [] }) }, "UNVALIDATED"],
    ["unexpected 418", { status: 418, body: "teapot" }, "UNVALIDATED"],
    ["5xx without boot marker is not a confident DEAD", { status: 503, body: "upstream timeout" }, "unknown"],
    ["transport failure", { status: 0, body: "fetch failed", transport: true }, "unknown"],
  ];
  let fail = 0;
  for (const [name, input, expected] of cases) {
    const got = classify(input);
    const ok = got === expected;
    if (!ok) fail++;
    console.log(`  ${ok ? "✓" : "✗"} ${name} — expected ${expected}, got ${got}`);
  }
  // Prove the DEFECT set is exactly what we think, so a future edit to the set
  // can't silently stop paging on a real break.
  const defectExpected = ["DEAD", "ABSENT", "ACCEPTED_EMPTY", "AUTH_WALLED", "UNVALIDATED"].sort().join(",");
  const defectActual = [...DEFECT].sort().join(",");
  const setOk = defectExpected === defectActual;
  if (!setOk) fail++;
  console.log(`  ${setOk ? "✓" : "✗"} DEFECT set is {${defectActual}}`);
  if (fail) {
    console.log(`\ncheck:funnel-capture-handler --selftest FAILED — ${fail} case(s) wrong.`);
    process.exit(1);
  }
  console.log(`\n✓ check:funnel-capture-handler --selftest — ${cases.length + 1} classifier assertions pass (both directions).`);
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

// ── live probe ───────────────────────────────────────────────────────────────
const anonKey = await fetchAnonKey();
const results = [];
for (const slug of TARGETS) results.push(await post(slug, anonKey));

console.log(`check:funnel-capture-handler — empty-POST probe of ${TARGETS.length} capture function(s) at ${BASE}`);
console.log(`  anon key: ${anonKey ? "present (from " + (process.env.APEX_SUPABASE_ANON_KEY ? "env" : "bundle") + ")" : "absent — keyless POST (valid for verify_jwt=false)"}`);

const defects = results.filter((r) => DEFECT.has(r.verdict));
const unknowns = results.filter((r) => r.verdict === "unknown");
const healthy = results.filter((r) => r.verdict === "HEALTHY");

for (const r of results) {
  const line = `  ${r.verdict.padEnd(14)} ${r.slug} — HTTP ${r.status}`;
  console.log(DEFECT.has(r.verdict) || r.verdict === "unknown" ? `${line}  ${String(r.body).replace(/\s+/g, " ").slice(0, 110)}` : line);
}

// Nothing observed is NOT an all-clear (the blank-reads-green disease this
// repo keeps paying for). Control-gate it: if even a plain OPTIONS can't reach
// the worker, it is the network, and a network outage is not a dead handler.
if (!defects.length && !healthy.length) {
  const anyControl = (await Promise.all(TARGETS.map(controlReachable))).some(Boolean);
  if (anyControl) {
    console.log(`\ncheck:funnel-capture-handler — could not validate the handler, but OPTIONS reached the worker.`);
    console.log(`  Reported as unknown, NOT healthy and NOT a red: a 5xx blip or transport hiccup on the`);
    console.log(`  POST path while boot is fine. Re-runs on the next schedule. See the lines above.`);
    process.exit(0);
  }
  console.log(`\ncheck:funnel-capture-handler — 0 of ${TARGETS.length} reachable and OPTIONS control also down.`);
  console.log(`  This network cannot see production, so handler state is UNKNOWN — not an all-clear,`);
  console.log(`  not a defect in the site. Check the base URL and connectivity.`);
  process.exit(0);
}

if (defects.length) {
  console.log(`\ncheck:funnel-capture-handler FAILED — ${defects.length} capture function(s) do not accept an anonymous submission.`);
  console.log(`  This is the recruit-capture path. Every lead that reaches one of these is lost until fixed:`);
  for (const r of defects) {
    const why = {
      DEAD: "module loads but the POST handler throws (edge-boot's OPTIONS cannot see this)",
      ABSENT: "not deployed — `supabase functions deploy " + r.slug + "`",
      ACCEPTED_EMPTY: "accepted an EMPTY body — validation bypassed; it is minting junk or broken",
      AUTH_WALLED: "gateway refused an anonymous caller (verify_jwt, or the anon key is rejected)",
      UNVALIDATED: "4xx that the handler's validator did not author — its contract changed or the request died first",
    }[r.verdict];
    console.log(`    ${r.slug} (${r.verdict}, HTTP ${r.status}) — ${why}`);
  }
  process.exit(1);
}

const tail = unknowns.length ? ` (${unknowns.length} unknown, see above — reported, not counted as healthy)` : "";
console.log(`\nok — ${healthy.length} capture function(s) accept an anonymous POST and validate it${tail}.`);
