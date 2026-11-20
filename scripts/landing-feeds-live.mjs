#!/usr/bin/env node
// check-landing-feeds-live.mjs — API-liveness of the public landing social-proof
// data layer. Owned by the Website Integrity Bot.
//
// WHY THIS EXISTS (the blind spot it closes). The public hero renders four
// anon-callable Supabase RPCs as its only dynamic social proof:
//   landing_live_stats       -> the AnimatedCounter strip (active agents / apps / carriers)
//   landing_deal_highlights  -> DealsTicker "NAME closed $X ALP" (top of page)
//   landing_recent_hires     -> RecentHiresTicker
//   landing_recent_applicants-> RecentApplicantsTicker
//
// live-render-integrity.mjs (the 6h browser probe) asserts the RENDERED numbers
// are real — but it is structurally blind to a dead stats feed. LiveStatsCounterStrip
// carries a HARDCODED_FLOOR (active_agents 40) and the useAnimatedCounter backstop,
// so if landing_live_stats() returns null/errors, the counter renders the FLOOR
// (a plausible 40) and the render probe stays GREEN while the real number (87) is
// gone. The three tickers return null on empty, so a dead feed renders as an
// absent ticker — again invisible to a render check (an empty ticker and a quiet
// week look identical on screen). No source guard can see any of this: they read
// SOURCE, this layer is computed from LIVE RPCs. So the ONLY way to catch a dead
// landing feed is to call it at the API level and look at the HTTP + body shape.
//
// NON-FLAPPING BY CONSTRUCTION. This probe grades LIVENESS, not content:
//   DEFECT      = non-200, non-JSON, or an error-shaped body (PostgREST {code,message}).
//                 A real failure: the RPC was dropped, anon lost EXECUTE, RLS broke,
//                 or the gateway is erroring. The public hero's social proof is down.
//   QUIET       = 200 + a valid-but-empty array (a genuinely slow hiring/apply week).
//                 TOLERATED, never a defect — grading "must have rows" would page on
//                 weather, the permanently-noisy-alarm anti-pattern this fleet keeps
//                 relearning. A ticker legitimately empties; that is not a site bug.
//   UNREACHABLE = the fetch threw (DNS/offline/timeout). Mapped to UNKNOWN, NEVER a
//                 defect, so Sam's known DNS drops cannot false-red the funnel — the
//                 same discipline apex-live-render-cron.sh uses for the browser legs.
//   OK          = 200 + real payload.
// Overall verdict: DEFECT if any feed is DEFECT (exit 1). If every feed is
// UNREACHABLE -> UNKNOWN (exit 0, can't see != is broken). Else CLEAN (exit 0).
//
// It writes its verdict to $RESULT_FILE (same hook as live-render-integrity.mjs)
// so apex-live-render-cron.sh can page on a transition without re-storming.
// It is NOT a verify:core gate: it hits prod over the network, and a flaky
// network call must never block a push (the lesson from every live-check).
//
// NAMING: intentionally NOT check-*.mjs — this is a network/live probe run by
// cron (apex-live-render-cron.sh), not a verify:core / pre-commit gate (a flaky
// prod network call must never block a push). Same convention + owner as its
// sibling live-render-integrity.mjs; check-guard-wiring.mjs only governs
// check-*.mjs gates, so this is correctly outside its purview.
//
// Run:        node scripts/landing-feeds-live.mjs
// Selftest:   node scripts/landing-feeds-live.mjs --selftest   (proven both ways)

import { writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.LANDING_SUPABASE_URL || "https://xrzweoneiieddzxogewk.supabase.co";
// The publishable (anon) key is public BY DESIGN — it ships in the client bundle.
// Env override lets the probe track a key rotation without a code change.
const ANON = process.env.LANDING_ANON_KEY || "sb_publishable_bVcDNOOdWJemjyveYpAaKQ_plKNXMAw";
const RESULT_FILE = process.env.RESULT_FILE || "";
const TIMEOUT_MS = Number(process.env.LANDING_PROBE_TIMEOUT_MS || 12000);

// Per-feed shape contract. `object` feeds (live_stats) are never "empty"; a 200
// must carry the named key or the feed is lying. `array` feeds (the tickers) may
// legitimately be empty (QUIET).
const FEEDS = [
  { fn: "landing_live_stats", shape: "object", requireKey: "active_agents" },
  { fn: "landing_deal_highlights", shape: "array" },
  { fn: "landing_recent_hires", shape: "array" },
  { fn: "landing_recent_applicants", shape: "array" },
];

// ---- PURE CLASSIFIER (unit-tested by --selftest with mock inputs; no network) ----
// Given the HTTP status, the raw body text, and the feed contract, return one of
// OK | QUIET | DEFECT. UNREACHABLE is decided by the caller (a thrown fetch),
// never here, so this function is deterministic.
export function classify(feed, status, bodyText) {
  if (status < 200 || status >= 300) return { state: "DEFECT", reason: `HTTP ${status}` };
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { state: "DEFECT", reason: "non-JSON body" };
  }
  // PostgREST surfaces RPC errors as a 200-less status normally, but a {code,message}
  // object with no payload is an error shape even if a proxy rewrote the status.
  const looksLikeError =
    body && !Array.isArray(body) && typeof body === "object" &&
    typeof body.message === "string" && ("code" in body || "hint" in body || "details" in body);
  if (looksLikeError) return { state: "DEFECT", reason: `error body ${body.code || ""}`.trim() };

  if (feed.shape === "array") {
    if (!Array.isArray(body)) return { state: "DEFECT", reason: "expected array" };
    return body.length === 0
      ? { state: "QUIET", reason: "200 + empty (tolerated)" }
      : { state: "OK", reason: `${body.length} rows` };
  }
  // object feed
  if (Array.isArray(body) || body === null || typeof body !== "object")
    return { state: "DEFECT", reason: "expected object" };
  if (feed.requireKey && !(feed.requireKey in body))
    return { state: "DEFECT", reason: `missing ${feed.requireKey}` };
  return { state: "OK", reason: `has ${feed.requireKey}` };
}

async function probe(feed) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${feed.fn}`, {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: ctrl.signal,
    });
    const text = await res.text();
    const c = classify(feed, res.status, text);
    return { fn: feed.fn, ...c, status: res.status };
  } catch (e) {
    // DNS drop / offline / timeout — the network, not the site. Never a defect.
    return { fn: feed.fn, state: "UNREACHABLE", reason: String(e?.name || e), status: 0 };
  } finally {
    clearTimeout(t);
  }
}

function overall(results) {
  if (results.some((r) => r.state === "DEFECT")) return "DEFECT";
  if (results.length && results.every((r) => r.state === "UNREACHABLE")) return "UNKNOWN";
  return "CLEAN";
}

async function main() {
  const results = [];
  for (const f of FEEDS) results.push(await probe(f));
  const verdict = overall(results);
  const out = { verdict, ts: new Date().toISOString(), base: SUPABASE_URL, feeds: results };

  if (RESULT_FILE) {
    try { writeFileSync(RESULT_FILE, JSON.stringify(out, null, 1)); }
    catch (e) { console.error(`result-file write failed: ${e}`); }
  }

  for (const r of results) {
    const glyph = r.state === "OK" ? "✓" : r.state === "QUIET" ? "·" : r.state === "UNREACHABLE" ? "?" : "✗";
    console.log(`  ${glyph} ${r.fn.padEnd(26)} ${r.state.padEnd(12)} ${r.reason}`);
  }
  console.log(`\nVERDICT: ${verdict}`);
  // DEFECT -> exit 1 (cron pages). UNKNOWN/CLEAN -> exit 0 (never false-red).
  process.exit(verdict === "DEFECT" ? 1 : 0);
}

// ---------------------------- SELFTEST ----------------------------
async function selftest() {
  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };
  const arr = FEEDS[1]; // array-shape feed
  const obj = FEEDS[0]; // object-shape feed

  // --- pure classifier, mock inputs (deterministic, no network) ---
  ok("200 object with key -> OK", classify(obj, 200, '{"active_agents":87,"applications_30d":33}').state === "OK");
  ok("200 object missing key -> DEFECT", classify(obj, 200, '{"foo":1}').state === "DEFECT");
  ok("200 array with rows -> OK", classify(arr, 200, '[{"agent":"EDWIN","amount":34011}]').state === "OK");
  ok("200 empty array -> QUIET (tolerated, not a defect)", classify(arr, 200, "[]").state === "QUIET");
  ok("404 -> DEFECT", classify(arr, 404, '{"code":"PGRST202","message":"not found"}').state === "DEFECT");
  ok("401 -> DEFECT (anon lost access)", classify(arr, 401, '{"message":"JWT"}').state === "DEFECT");
  ok("200 PostgREST error-shape body -> DEFECT", classify(arr, 200, '{"code":"P0001","message":"boom","hint":"x"}').state === "DEFECT");
  ok("200 non-JSON (HTML login) -> DEFECT", classify(arr, 200, "<!doctype html><html>login</html>").state === "DEFECT");
  ok("200 array-expected-but-object -> DEFECT", classify(arr, 200, '{"active_agents":1}').state === "DEFECT");

  // --- overall() verdict composition ---
  ok("overall: any DEFECT -> DEFECT", overall([{ state: "OK" }, { state: "DEFECT" }, { state: "QUIET" }]) === "DEFECT");
  ok("overall: all UNREACHABLE -> UNKNOWN (DNS drop, never false-red)",
    overall([{ state: "UNREACHABLE" }, { state: "UNREACHABLE" }]) === "UNKNOWN");
  ok("overall: OK+QUIET, no defect -> CLEAN", overall([{ state: "OK" }, { state: "QUIET" }]) === "CLEAN");
  ok("overall: one reachable among unreachable, no defect -> CLEAN (not UNKNOWN)",
    overall([{ state: "UNREACHABLE" }, { state: "OK" }]) === "CLEAN");

  // --- LIVE both-direction proof against prod ---
  const realGreen = await probe(FEEDS[0]); // landing_live_stats
  ok(`LIVE GREEN: landing_live_stats OK (${realGreen.state})`, realGreen.state === "OK");
  const realTicker = await probe(FEEDS[1]); // landing_deal_highlights
  ok(`LIVE GREEN: landing_deal_highlights not-DEFECT (${realTicker.state})`, realTicker.state !== "DEFECT" && realTicker.state !== "UNREACHABLE");
  const bogus = await probe({ fn: "landing_does_not_exist_probe", shape: "array" });
  ok(`LIVE RED: dropped RPC -> DEFECT (${bogus.state} ${bogus.reason})`, bogus.state === "DEFECT");

  console.log(`\nselftest: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

if (process.argv.includes("--selftest")) selftest();
else main();
