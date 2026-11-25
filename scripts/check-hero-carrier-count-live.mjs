import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { deriveCanonical } from "./check-hero-path-claims.mjs";

// Persistence-mandate LIVE guard — Hero carrier count vs the server number the
// page actually renders. MP-WIB-HERO-CARRIER-LIVE (2026-11-17).
//
// THE SOURCE/LIVE SPLIT. check-hero-path-claims (static) keeps every FRONTEND
// carrier-count literal in lockstep with HeroSection's `carriers[]` logo-wall
// length (22) — Hero stat pill, partnerPaths prose, CareerPathwaySection's
// `?? 22` fallback, the index.html meta. Its own header notes "Server truth
// (landing_live_stats().carriers_partnered) is also 22" as a point-in-time
// fact it DELIBERATELY does not verify ("does NOT reach the network"). That is
// the seam: HeroSection hardcodes "22 carriers" (×2) while CareerPathwaySection
// renders the LIVE `landing_live_stats().carriers_partnered` in three visible
// spots ("Contract with up to ${carriers} carriers", "${carriers} carrier
// partners", the "Carrier Partners" stat tile). The two agree today (both 22).
// The day the book crosses the floor — carriers_partnered = greatest(count(
// active carriers), 22), and the book is at 21 active and GROWING (3 carriers
// added 2026-09-01) — the RPC returns 23, CareerPathwaySection renders 23, the
// Hero still says 22, and a recruit reads a same-page numeric contradiction on
// the #1 conversion surface. The static guard stays green: it only grades the
// frontend against itself. Same disease class as robots-indexable (static) vs
// robots-indexable-live, share-card vs share-card-live.
//
// WHAT IT COMPARES, AND WHY THAT OPERAND. It asserts the frontend canonical
// count (carriers[] length, via the ONE shared parser deriveCanonical — no
// detector dup) equals the number landing_live_stats() ACTUALLY RETURNS — i.e.
// the floored value CareerPathwaySection renders — NOT the raw count(active
// carriers). The floor greatest(count,22) is a DELIBERATE marketing floor; a
// guard that compared against the raw count would fight that decision and fire
// forever the moment the book dipped below 22 (21 today). The guard's purpose
// is cross-SURFACE render parity (Hero vs CareerPathway), so the right operand
// is exactly what the page renders. When the book is >= 22 the floor is inert
// and this reduces to "is the Hero's 22 still the truth the page shows."
//
// NO-FAKE-SUCCESS / can't-cry-wolf exit contract:
//   exit 1 DEFECT      -> a CLEAN authoritative RPC read disagrees with the
//                         frontend canonical: FAIL (red). A transient can never
//                         produce this — only a 200 with a well-formed
//                         landing_live_stats payload carrying a finite integer
//                         carriers_partnered is trusted.
//   exit 3 UNRESOLVED  -> site/bundle/RPC transiently unreachable or malformed
//                         (5xx/timeout/DNS/non-JSON/missing field) WITH egress
//                         proven up, or the frontend canonical can't be derived
//                         (the static guard owns source-shape): warning, green.
//   exit 0 CLEAN       -> frontend canonical == live carriers_partnered.
//   exit 0 UNKNOWN     -> the egress control (generate_204) is itself down, so
//                         no non-answer is trusted: green (a runner/network blip
//                         must never read as a defect — MP-291).
//
// The RPC uses the PUBLIC anon key extracted from the LIVE deployed bundle (the
// exact key the page ships), so a stale on-disk .env can't mask a rotation that
// never reached prod (MP-300), and the guard needs no secret -> CI-runnable.

const __dirname = dirname(fileURLToPath(import.meta.url));

const HERO_SOURCE =
  process.env.HERO_CARRIER_CLAIMS_SOURCE ||
  process.env.HERO_CARRIER_HERO_SOURCE ||
  resolve(__dirname, "../src/lib/publicRecruitingClaims.ts");
const SITE_ORIGIN = process.env.HERO_CARRIER_SITE_ORIGIN || "https://galaxyfinancial.org";
const CONTROL = process.env.HERO_CARRIER_CONTROL_URL || "https://www.google.com/generate_204";
// Test seam (HERO_CARRIER_RPC_URL/KEY): when set, resolveRpc() uses this RPC
// endpoint + key directly and skips live bundle extraction — lets --selftest
// drive the fetch->parse->verdict pipeline against a local double. Read LIVE
// inside resolveRpc (not a load-time const) so it cannot capture a stale env.
// Prod leaves both unset and extracts from the deployed bundle.

const TIMEOUT_MS = Number(process.env.HERO_CARRIER_TIMEOUT_MS || 15000);
const RPC_PATH = "/rest/v1/rpc/landing_live_stats";

// ── pure: extract the Supabase URL + publishable (anon) key from bundle text ──
// The SPA bundle carries both as string literals. The key is a long JWT
// (eyJ...) or an sb_publishable_ token. Returns { url, key } or null (no match
// -> can't verify, never a defect).
export function extractCreds(bundleText) {
  const text = String(bundleText || "");
  const url = (text.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0] || null;
  const key =
    (text.match(/sb_publishable_[A-Za-z0-9_-]+/) || [])[0] ||
    (text.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/) || [])[0] ||
    null;
  if (!url || !key) return null;
  return { url, key };
}

// ── pure: pull a finite integer carriers_partnered out of an RPC payload ──
// Returns the integer, or null if the shape is wrong / value non-numeric (a
// malformed read is a non-answer, not a zero).
export function parseLiveCount(payload) {
  if (payload == null || typeof payload !== "object") return null;
  // landing_live_stats() returns a single json object (PostgREST may wrap it in
  // a one-element array depending on how it is defined; accept both).
  const obj = Array.isArray(payload) ? payload[0] : payload;
  if (obj == null || typeof obj !== "object") return null;
  const raw = obj.carriers_partnered;
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

// ── pure: the whole verdict, given what we managed to read ──
// canonical: integer | null (frontend carriers[] length; null = underivable)
// liveCount: integer | null (authoritative RPC read; null = no trustworthy read)
// controlUp: boolean (egress proven reachable)
export function decideVerdict({ canonical, liveCount, controlUp }) {
  if (!Number.isInteger(canonical)) {
    return {
      verdict: "UNRESOLVED",
      code: 3,
      msg: "frontend canonical carrier count could not be derived from publicRecruitingClaims — the static check:hero-path-claims owns source shape; not asserting any live defect.",
    };
  }
  if (Number.isInteger(liveCount)) {
    if (liveCount === canonical) {
      return {
        verdict: "CLEAN",
        code: 0,
        msg: `Hero carrier count (${canonical}) matches live landing_live_stats().carriers_partnered (${liveCount}) — the number CareerPathwaySection renders. No cross-surface drift.`,
      };
    }
    return {
      verdict: "DEFECT",
      code: 1,
      msg:
        `Hero hardcodes ${canonical} carriers but landing_live_stats().carriers_partnered is ${liveCount} — ` +
        `CareerPathwaySection renders ${liveCount} ("Contract with up to ${liveCount} carriers" / "${liveCount} carrier partners" / "Carrier Partners" tile) while the Hero stat pill + partnerPaths prose say ${canonical}: a same-page numeric contradiction on the public recruiting funnel. ` +
        `Update publicRecruitingClaims carriers[] and its matching stats to ${liveCount} (and retained public copy if it restates the count); the static check:hero-path-claims verifies the visible hero binding and cross-surface consistency.`,
    };
  }
  // No authoritative live read.
  if (controlUp) {
    return {
      verdict: "UNRESOLVED",
      code: 3,
      msg: "could not get an authoritative landing_live_stats() read (site/bundle/RPC transient 5xx/timeout/DNS/non-JSON) though egress is up — transient, not asserting drift. Re-run to confirm.",
    };
  }
  return {
    verdict: "UNKNOWN",
    code: 0,
    msg: "egress control unreachable — the runner's own network is down, so no non-answer is trusted (not a defect).",
  };
}

// ── network: reusable, all failures swallowed into null/false (never throw) ──
async function controlReachable(controlUrl) {
  try {
    const r = await fetch(controlUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
    return r.status >= 200 && r.status < 400;
  } catch {
    return false;
  }
}

async function fetchText(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!(r.status >= 200 && r.status < 300)) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// Resolve the RPC endpoint + anon key: either the test override, or extracted
// from the live deployed bundle at SITE_ORIGIN. Returns { rpcUrl, key } | null.
async function resolveRpc(origin) {
  const rpcOverride = process.env.HERO_CARRIER_RPC_URL || null;
  if (rpcOverride) return { rpcUrl: rpcOverride, key: process.env.HERO_CARRIER_RPC_KEY || "" };
  const idx = await fetchText(`${origin}/`);
  if (!idx) return null;
  const bundles = [...idx.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]);
  const seen = new Set();
  for (const b of bundles) {
    if (seen.has(b)) continue;
    seen.add(b);
    const js = await fetchText(`${origin}${b}`);
    if (!js) continue;
    const creds = extractCreds(js);
    if (creds) return { rpcUrl: `${creds.url}${RPC_PATH}`, key: creds.key };
  }
  return null;
}

// Call landing_live_stats() as anon. Returns an integer, or null (non-answer).
export async function fetchLiveCount(rpcUrl, key) {
  try {
    const r = await fetch(rpcUrl, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!(r.status >= 200 && r.status < 300)) return null;
    let json;
    try {
      json = JSON.parse(await r.text());
    } catch {
      return null;
    }
    return parseLiveCount(json);
  } catch {
    return null;
  }
}

async function run() {
  // Frontend canonical from the ONE shared parser (no detector dup).
  let canonical = null;
  try {
    canonical = deriveCanonical(readFileSync(HERO_SOURCE, "utf8")).carrierCount;
  } catch (e) {
    console.error(`[hero-carrier-count-live] UNRESOLVED — ${e.message}`);
    process.exit(3);
  }

  const resolved = await resolveRpc(SITE_ORIGIN);
  const liveCount = resolved ? await fetchLiveCount(resolved.rpcUrl, resolved.key) : null;
  const controlUp = await controlReachable(CONTROL);

  const { verdict, code, msg } = decideVerdict({ canonical, liveCount, controlUp });
  const tag = code === 0 && verdict === "CLEAN" ? "✓" : code === 1 ? "✗" : "⚠";
  const stream = code === 1 ? console.error : console.log;
  stream(`${tag} check:hero-carrier-count-live — ${verdict}: ${msg}`);
  process.exit(code);
}

// ───────────────────────── selftest (offline, both directions) ─────────────
async function selftest() {
  let pass = 0;
  let total = 0;
  const ok = (cond, name) => {
    total++;
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      console.error(`  ✗ ${name}`);
    }
  };

  // extractCreds
  ok(
    JSON.stringify(extractCreds('a="https://abc123.supabase.co";k="eyJ' + "x".repeat(30) + '.payload.sig"')) ===
      JSON.stringify({ url: "https://abc123.supabase.co", key: "eyJ" + "x".repeat(30) + ".payload.sig" }),
    "extractCreds: url + JWT key -> both",
  );
  ok(
    extractCreds('url="https://abc123.supabase.co";key="sb_publishable_AbC-123_xyz"')?.key === "sb_publishable_AbC-123_xyz",
    "extractCreds: sb_publishable_ key form",
  );
  ok(extractCreds('only a url https://abc123.supabase.co and no key') === null, "extractCreds: url but no key -> null");
  ok(extractCreds('eyJ' + "x".repeat(30) + ".p.s but no supabase url") === null, "extractCreds: key but no url -> null");
  ok(extractCreds("") === null, "extractCreds: empty -> null");

  // parseLiveCount
  ok(parseLiveCount({ carriers_partnered: 22 }) === 22, "parseLiveCount: numeric object -> int");
  ok(parseLiveCount([{ carriers_partnered: 23 }]) === 23, "parseLiveCount: one-element array wrap -> int");
  ok(parseLiveCount({ carriers_partnered: "24" }) === 24, "parseLiveCount: numeric string -> int");
  ok(parseLiveCount({ active_agents: 85 }) === null, "parseLiveCount: field missing -> null");
  ok(parseLiveCount({ carriers_partnered: "lots" }) === null, "parseLiveCount: non-numeric -> null");
  ok(parseLiveCount({ carriers_partnered: 22.5 }) === null, "parseLiveCount: non-integer -> null");
  ok(parseLiveCount(null) === null, "parseLiveCount: null -> null");
  ok(parseLiveCount("22") === null, "parseLiveCount: bare string -> null");

  // decideVerdict — every branch
  ok(decideVerdict({ canonical: 22, liveCount: 22, controlUp: true }).code === 0, "verdict: equal -> CLEAN(0)");
  ok(
    decideVerdict({ canonical: 22, liveCount: 23, controlUp: true }).verdict === "DEFECT" &&
      decideVerdict({ canonical: 22, liveCount: 23, controlUp: true }).code === 1,
    "verdict: live>frontend (book grew) -> DEFECT(1)",
  );
  ok(
    decideVerdict({ canonical: 25, liveCount: 23, controlUp: true }).code === 1,
    "verdict: frontend>live (wall over-claims) -> DEFECT(1)",
  );
  ok(
    decideVerdict({ canonical: 22, liveCount: null, controlUp: true }).code === 3,
    "verdict: no read + egress up -> UNRESOLVED(3)",
  );
  ok(
    decideVerdict({ canonical: 22, liveCount: null, controlUp: false }).code === 0 &&
      decideVerdict({ canonical: 22, liveCount: null, controlUp: false }).verdict === "UNKNOWN",
    "verdict: no read + egress DOWN -> UNKNOWN(0), not trusted",
  );
  ok(
    decideVerdict({ canonical: null, liveCount: 22, controlUp: true }).code === 3,
    "verdict: underivable canonical -> UNRESOLVED(3), never a live defect",
  );

  // ── e2e: real fetch layer against a local double, both verdicts ──
  // Serves: GET /ctl -> 204 ; GET / -> index referencing /assets/app.js ;
  // GET /assets/app.js -> bundle carrying a .supabase.co url (pointed back at
  // this server via a rewrite) + a fake key ; POST .../landing_live_stats ->
  // settable count or a 503. Proves fetch->extract->rpc->verdict end to end.
  let served = 22;
  let rpcStatus = 200;
  const server = createServer((req, res) => {
    if (req.url === "/ctl") {
      res.writeHead(204).end();
    } else if (req.url === RPC_PATH && req.method === "POST") {
      if (rpcStatus !== 200) {
        res.writeHead(rpcStatus).end("upstream");
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ carriers_partnered: served, active_agents: 85 }));
      }
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    // control reachable both directions
    ok((await controlReachable(`${base}/ctl`)) === true, "e2e: control /ctl reachable -> true");

    // CLEAN: served matches canonical 22
    served = 22;
    rpcStatus = 200;
    let live = await fetchLiveCount(`${base}${RPC_PATH}`, "testkey");
    ok(live === 22, "e2e: fetchLiveCount reads served 22");
    ok(decideVerdict({ canonical: 22, liveCount: live, controlUp: true }).code === 0, "e2e: served==canonical -> CLEAN(0)");

    // DEFECT: book grew to 23
    served = 23;
    live = await fetchLiveCount(`${base}${RPC_PATH}`, "testkey");
    ok(live === 23, "e2e: fetchLiveCount reads served 23 (book grew)");
    ok(decideVerdict({ canonical: 22, liveCount: live, controlUp: true }).code === 1, "e2e: served 23 vs Hero 22 -> DEFECT(1)");

    // UNRESOLVED: RPC 503 with egress up
    rpcStatus = 503;
    live = await fetchLiveCount(`${base}${RPC_PATH}`, "testkey");
    ok(live === null, "e2e: RPC 503 -> fetchLiveCount null (non-answer, not 0)");
    ok(decideVerdict({ canonical: 22, liveCount: live, controlUp: true }).code === 3, "e2e: 503 + egress up -> UNRESOLVED(3)");

    // resolveRpc override path (the --selftest seam prod never uses)
    process.env.HERO_CARRIER_RPC_URL = `${base}${RPC_PATH}`;
    process.env.HERO_CARRIER_RPC_KEY = "testkey";
    const resolved = await resolveRpc(base);
    ok(resolved?.rpcUrl === `${base}${RPC_PATH}`, "e2e: RPC override seam resolves without bundle extraction");
    delete process.env.HERO_CARRIER_RPC_URL;
    delete process.env.HERO_CARRIER_RPC_KEY;
  } finally {
    await new Promise((r) => server.close(r));
  }

  if (pass === total) {
    console.log(`\n✓ check:hero-carrier-count-live --selftest ${pass}/${total} PASS`);
    process.exit(0);
  }
  console.error(`\n✗ check:hero-carrier-count-live --selftest ${pass}/${total} — logic regressed`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--selftest")) selftest();
  else run();
}
