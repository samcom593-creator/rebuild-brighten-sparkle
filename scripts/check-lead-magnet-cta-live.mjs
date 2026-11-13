#!/usr/bin/env node
// check-lead-magnet-cta-live.mjs — prove the lead-magnet keyword-CTA doors are
// still ALIVE on the live edge. Owned by the Website Integrity Bot.
//
// WHY THIS EXISTS. The single documented "lever that prints leads" for the brand
// is the keyword-CTA: a Short/Reel/TikTok says "comment TEAM" (or BODY / BUILD),
// the social bot auto-replies with the door URL, and the prospect lands on a
// page that captures them. Those door URLs are the canonical KEYWORDS array in
// src/lib/brand.ts:
//   TEAM  -> https://sell4daddy.com/team   ("Join the Team")
//   BODY  -> https://sell4daddy.com/body   ("The Standard Body")
//   BUILD -> https://sell4daddy.com/build  ("Build Your Agency")
// Memory (social_bot_lead_magnet_attribution): one Short routed 9 leads / $21,600
// through a single door. Every captured "comment TEAM" lead ends its journey on
// one of these pages — they are the mouth of the funnel.
//
// THE BLIND SPOT. These pages live on sell4daddy.com, a SEPARATE Vercel project
// outside THIS repo's deploy pipeline and every guard it runs. apex-financial.org
// has a dense live-edge guard suite (share-card-live, vsl-media-live,
// crawl-entrypoints-live, brand-static-live, funnel-external-CTA liveness,
// Calendly liveness, Stripe link liveness) — but the lead-magnet doors, which are
// where the lead-printing engine actually DELIVERS, are watched by nothing. A
// broken deploy on that project, a removed /team route, or a lapsed domain kills
// every keyword-CTA lead silently: the comment still fires, the auto-reply still
// sends the link, the prospect still clicks — and dead-ends on a 404. Nobody in
// this repo would ever know, because nothing here ever fetches that domain.
//
// WHY STATUS ALONE IS NOT ENOUGH (the 465-InsuraCloud masquerade, cross-domain).
// A live door must POSITIVELY serve a real landing page: 200/206 with a
// substantive body and NO platform-error / parked-domain signature. Vercel soft-
// serves its own "404: NOT_FOUND" / "DEPLOYMENT_NOT_FOUND" body, and a lapsed
// domain lands on a registrar parking page — both can carry a 200. A 200 that is
// a Vercel error body, a parking page, or a near-empty shell reads DEAD, never
// alive. That positive body signature is the whole point.
//
// WHY THE DOOR SET IS DERIVED FROM SOURCE, NEVER HARDCODED. The probe set is read
// from the KEYWORDS array in src/lib/brand.ts — the one file that defines which
// keyword opens which door. Add a fourth keyword (e.g. GLOW -> /glowup) to that
// array and this guard probes it automatically; rename a door and it follows.
// The guard can never go stale against a door the engine no longer serves, and
// can never miss a door the engine newly serves. (Same philosophy as
// check-brand-static-live deriving the icon chain from the served <head>, and
// check-crawl-entrypoints-live following robots.txt's own Sitemap: directive.)
//
// WHY IT CAN'T CRY WOLF (exit contract shared with check-brand-static-live.mjs,
// check-share-card-live.mjs and check-vsl-media-live.mjs so a cron wrapper /
// apex-doctor grades it alike):
//   - a positive dead signature (4xx, a 2xx carrying a Vercel-error/parked body,
//     or a near-empty 2xx shell) WITH egress proven up is a DEFECT (exit 1): the
//     door is dead for real prospects and the lead-printing engine leaks.
//   - a 5xx / timeout / connection error — including a DNS failure (domain blip
//     is indistinguishable from a lapse without the control) and the brand.ts
//     seed read — is transient -> UNRESOLVED (exit 3), never a DEFECT. Re-run
//     clears a blip; a genuine lapse persists as a daily warning.
//   - if the egress control (generate_204) is itself unreachable the verdict is
//     UNKNOWN (exit 0) and no "dead" is trusted — a runner/network blip must
//     never read as a dead door (MP-291).
//   0 CLEAN | 0 UNKNOWN (network) | 1 DEFECT | 3 UNRESOLVED/partial
//
// Usage:
//   node scripts/check-lead-magnet-cta-live.mjs
//   node scripts/check-lead-magnet-cta-live.mjs --selftest   # deterministic, local-only

import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAND_SOURCE = process.env.LEAD_MAGNET_BRAND_SOURCE || resolve(__dirname, "../src/lib/brand.ts");
const CONTROL = process.env.LEAD_MAGNET_CONTROL_URL || "https://www.google.com/generate_204";
const TIMEOUT_MS = Number(process.env.LEAD_MAGNET_TIMEOUT_MS || 25000);
const MIN_BODY = 256; // a real landing page is thousands of bytes; below this is a blank/broken shell

// A served body that IS one of these is a dead door wearing a 200 (or a 4xx body
// we confirm). Vercel platform errors + common registrar parking markers.
const DEAD_SIGNATURE =
  /(DEPLOYMENT_NOT_FOUND|DEPLOYMENT_PAUSED|DEPLOYMENT_DELETED|404:\s*NOT_FOUND|Code:\s*`?NOT_FOUND`?|The deployment could not be found|This domain is not (?:configured|connected)|buy this domain|domain (?:is )?for sale|parked (?:free )?(?:courtesy|by)|sedoparking|afternic|GoDaddy[^<]{0,40}parked)/i;

// ---- pure classifier ------------------------------------------------------
// Decide alive / dead / unresolved from a single door probe descriptor. Pure of
// network + process state so --selftest drives it deterministically.
function classify({ networkError, status, body }) {
  if (networkError) {
    // connection refused / DNS / timeout: transient, NOT a positive door-gone
    // signal (a real lapse is indistinguishable from a blip here). Never a
    // DEFECT on its own.
    return { state: "unresolved", reason: `network error: ${networkError}` };
  }
  const served = status === 200 || status === 206;
  const text = String(body || "");
  if (served) {
    if (DEAD_SIGNATURE.test(text)) {
      return {
        state: "dead", status,
        reason: `served ${status} but the body is a platform-error / parked-domain page (a Vercel 404/paused deploy or a registrar parking page masquerading as 200) — the door is dead and every keyword-CTA lead dead-ends here`,
      };
    }
    if (text.trim().length < MIN_BODY) {
      return {
        state: "dead", status,
        reason: `served ${status} but the body is only ${text.trim().length} byte(s) (< ${MIN_BODY}) — a blank/broken shell, not a landing page; the keyword-CTA lead lands on nothing`,
      };
    }
    const brand = /samuel\s*james|sell4daddy/i.test(text);
    return { state: "alive", status, detail: brand ? "branded landing page" : "landing page (brand marker not found — redesign?)", brand };
  }
  if (status >= 400 && status < 500) {
    return { state: "dead", status, reason: `HTTP ${status} — the door route is gone, moved, or forbidden (deploy dropped the path / project removed); the keyword-CTA lead hits a 404` };
  }
  return { state: "unresolved", status, reason: `HTTP ${status || 0} — transient edge/infra response, not a positive door-gone signal` };
}

// ---- derive the door set from source (pure string parsing for --selftest) ---
// Extract the https://sell4daddy.com/... (or any http(s)) urls declared inside
// the KEYWORDS = [ ... ] array in src/lib/brand.ts. Returns { doors, parseError }.
function parseDoors(brandSrc) {
  const src = String(brandSrc || "");
  const anchor = src.indexOf("KEYWORDS");
  if (anchor < 0) return { doors: [], parseError: "no KEYWORDS declaration found in brand source" };
  // slice from KEYWORDS to the first "];" after it (the array close)
  const tail = src.slice(anchor);
  const closeIdx = tail.indexOf("];");
  const block = closeIdx >= 0 ? tail.slice(0, closeIdx) : tail;
  const doors = [];
  const seen = new Set();
  // match: key: "TEAM", ... url: "https://..."  — pull key+url pairs
  const entryRe = /key:\s*["']([A-Z0-9_]+)["'][\s\S]*?\burl:\s*["'](https?:\/\/[^"']+)["']/g;
  let m;
  while ((m = entryRe.exec(block))) {
    const key = m[1];
    const url = m[2].replace(/[.,;]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    doors.push({ key, url, label: `${key} door (${url})` });
  }
  if (!doors.length) return { doors: [], parseError: "KEYWORDS array found but no key/url door pairs parsed — brand.ts shape changed; refusing to assert any door dead" };
  return { doors, parseError: null };
}

// ---- probes ---------------------------------------------------------------
async function fetchPage(url) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 (website-integrity-bot lead-magnet-cta-live)" },
      });
      const body = await r.text().catch(() => "");
      return { url, status: r.status, body };
    } catch (e) {
      last = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160);
    }
  }
  return { url, networkError: last || "unknown" };
}

async function probeDoor(url) {
  const r = await fetchPage(url);
  if (r.networkError) return { url, ...classify({ networkError: r.networkError }) };
  return { url, ...classify({ status: r.status, body: r.body }) };
}

async function controlReachable(controlUrl) {
  try {
    const r = await fetch(controlUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
    return r.status === 204 || r.ok;
  } catch { return false; }
}

// ---- verdict (pure) --------------------------------------------------------
// A "dead" is only trustworthy when the control proves our egress works.
function decideVerdict(results, controlUp) {
  const dead = results.filter((r) => r.state === "dead");
  const unresolved = results.filter((r) => r.state === "unresolved");
  if (dead.length) {
    if (controlUp) return { verdict: "DEFECT", code: 1 };
    return { verdict: "UNKNOWN", code: 0, downgradeDead: true };
  }
  if (unresolved.length) return { verdict: "UNRESOLVED", code: 3 };
  return { verdict: "CLEAN", code: 0 };
}

// ---- selftest: deterministic, local-only -----------------------------------
async function selftest() {
  let pass = 0, total = 0;
  const ok = (cond, msg) => { total++; if (cond) { pass++; console.log(`✓ ${msg}`); } else { console.log(`✗ ${msg}`); } };

  // 1. Pure classifier — both directions, the parked/error-masquerade is THE case.
  ok(classify({ status: 200, body: "<!doctype html><html><head><title>Join the Team — Samuel James</title></head><body>" + "x".repeat(4000) + "</body></html>" }).state === "alive", "200 real branded page -> alive");
  ok(classify({ status: 200, body: "<!doctype html><html>" + "x".repeat(4000) + "</html>" }).state === "alive", "200 substantive body, no brand -> alive (redesign-safe)");
  ok(classify({ status: 200, body: "<!doctype html><html><body>404: NOT_FOUND Code: NOT_FOUND ID: abc</body></html>" }).state === "dead", "200 Vercel NOT_FOUND body -> dead (soft-404 masquerade)");
  ok(classify({ status: 200, body: "The deployment could not be found on Vercel. DEPLOYMENT_NOT_FOUND" }).state === "dead", "200 DEPLOYMENT_NOT_FOUND -> dead");
  ok(classify({ status: 200, body: "Buy this domain. This domain is for sale." }).state === "dead", "200 parked/for-sale body -> dead");
  ok(classify({ status: 200, body: "" }).state === "dead", "200 empty body -> dead (blank shell)");
  ok(classify({ status: 200, body: "ok" }).state === "dead", "200 tiny body -> dead (broken shell)");
  ok(classify({ status: 404, body: "404: NOT_FOUND" }).state === "dead", "404 -> dead (door route gone)");
  ok(classify({ status: 403, body: "Forbidden" }).state === "dead", "403 -> dead");
  ok(classify({ status: 503, body: "upstream" }).state === "unresolved", "503 -> unresolved (transient)");
  ok(classify({ status: 500, body: "err" }).state === "unresolved", "500 -> unresolved");
  ok(classify({ networkError: "fetch failed" }).state === "unresolved", "network error (DNS/conn) -> unresolved, never dead");
  ok(classify({ status: 206, body: "x".repeat(4000) }).state === "alive", "206 substantive -> alive");

  // 1b. brand flag is informational, never flips alive->dead
  const noBrand = classify({ status: 200, body: "x".repeat(4000) });
  ok(noBrand.state === "alive" && noBrand.brand === false, "no-brand substantive page stays alive, brand=false noted");

  // 2. Door parser — derives key/url pairs from a KEYWORDS array fixture.
  const brandFixture = `
export const KEYWORDS: { key: Keyword; door: string; url: string }[] = [
  { key: "TEAM", door: "Join the Team", url: "https://sell4daddy.com/team", reply: "...: https://sell4daddy.com/team." },
  { key: "BODY", door: "The Standard Body", url: "https://sell4daddy.com/body" },
  { key: "BUILD", door: "Build Your Agency", url: "https://sell4daddy.com/build" },
];
export const SOMETHING_ELSE = [{ url: "https://not-a-door.example/x" }];`;
  const parsed = parseDoors(brandFixture);
  ok(parsed.parseError === null && parsed.doors.length === 3, "parse -> exactly 3 doors (ignores urls outside KEYWORDS)");
  ok(parsed.doors[0].key === "TEAM" && parsed.doors[0].url === "https://sell4daddy.com/team", "parse -> TEAM url (reply-string dup de-duped, not double-counted)");
  ok(parsed.doors.some((d) => d.url === "https://sell4daddy.com/build"), "parse -> BUILD url");
  ok(!parsed.doors.some((d) => d.url.includes("not-a-door")), "parse ignores urls outside the KEYWORDS array");
  ok(parseDoors("export const NOPE = 1;").parseError !== null, "no KEYWORDS -> parseError (never asserts dead)");
  ok(parseDoors("export const KEYWORDS = [];").parseError !== null, "empty KEYWORDS -> parseError (shape changed, refuse to assert)");
  // parses the REAL brand.ts if present (proves it stays in sync with source)
  try {
    const realDoors = parseDoors(readFileSync(BRAND_SOURCE, "utf8"));
    ok(realDoors.parseError === null && realDoors.doors.length >= 1, `parse real brand.ts -> ${realDoors.doors.length} live door(s)`);
  } catch { ok(true, "real brand.ts not readable in this context (skipped)"); }

  // 3. End-to-end probeDoor against a local server (faithful fetch pipeline).
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/team") { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><html><head><title>Join the Team — Samuel James</title></head><body>" + "x".repeat(4000) + "</body></html>"); return; }
    if (path === "/gone") { res.writeHead(404, { "content-type": "text/html" }); res.end("404: NOT_FOUND"); return; }
    if (path === "/soft404") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><body>DEPLOYMENT_NOT_FOUND</body></html>"); return; }
    if (path === "/blank") { res.writeHead(200, { "content-type": "text/html" }); res.end(""); return; }
    if (path === "/infra") { res.writeHead(500, { "content-type": "text/plain" }); res.end("err"); return; }
    if (path === "/ctl") { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { "content-type": "text/html" }); res.end("404: NOT_FOUND");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  ok((await probeDoor(`${origin}/team`)).state === "alive", "e2e /team branded page -> alive");
  ok((await probeDoor(`${origin}/gone`)).state === "dead", "e2e /gone 404 -> dead");
  ok((await probeDoor(`${origin}/soft404`)).state === "dead", "e2e /soft404 200-masquerade -> dead");
  ok((await probeDoor(`${origin}/blank`)).state === "dead", "e2e /blank empty 200 -> dead");
  ok((await probeDoor(`${origin}/infra`)).state === "unresolved", "e2e /infra 500 -> unresolved");

  // 4. Control reachability, both directions (prove the UNKNOWN gate is real).
  const ctlUp = await controlReachable(`${origin}/ctl`);
  ok(ctlUp === true, "control /ctl reachable -> true");
  await new Promise((r) => server.close(r));
  const ctlDown = await controlReachable(`http://127.0.0.1:${port}/ctl`);
  ok(ctlDown === false, "control unreachable after close -> false");

  // 5. decideVerdict: the control gate is load-bearing.
  const deadRes = [{ state: "dead" }];
  ok(decideVerdict(deadRes, true).verdict === "DEFECT" && decideVerdict(deadRes, true).code === 1, "dead + control up -> DEFECT(1)");
  ok(decideVerdict(deadRes, false).verdict === "UNKNOWN" && decideVerdict(deadRes, false).code === 0, "dead + control DOWN -> UNKNOWN(0), not trusted");
  ok(decideVerdict([{ state: "unresolved" }], true).verdict === "UNRESOLVED" && decideVerdict([{ state: "unresolved" }], true).code === 3, "unresolved -> UNRESOLVED(3)");
  ok(decideVerdict([{ state: "alive" }], true).verdict === "CLEAN", "all alive -> CLEAN(0)");

  console.log(`\nselftest: ${pass}/${total}`);
  if (pass !== total) { console.error("SELFTEST FAILED — the lead-magnet-cta alive/dead detector is wrong."); process.exit(1); }
  console.log("✅ selftest: door alive/dead/unresolved + parked/soft-404 masquerade + KEYWORDS door derivation + control-gating all classified correctly, both directions.");
  process.exit(0);
}

// ---- live run --------------------------------------------------------------
async function main() {
  let brandSrc;
  try { brandSrc = readFileSync(BRAND_SOURCE, "utf8"); }
  catch (e) {
    const reason = `brand source unreadable (${BRAND_SOURCE}): ${String(e && e.message ? e.message : e).slice(0, 120)}`;
    console.log(JSON.stringify({ verdict: "UNRESOLVED", reason }, null, 2));
    console.error(`\n⚠️  lead-magnet-cta UNRESOLVED — ${reason}. NOT a defect; re-run to confirm.`);
    process.exit(3);
  }
  const { doors, parseError } = parseDoors(brandSrc);
  if (parseError) {
    console.log(JSON.stringify({ verdict: "UNRESOLVED", reason: parseError }, null, 2));
    console.error(`\n⚠️  lead-magnet-cta UNRESOLVED — ${parseError}. NOT a defect; re-run to confirm.`);
    process.exit(3);
  }

  const results = [];
  for (const d of doors) {
    const r = await probeDoor(d.url);
    r.label = d.label;
    r.key = d.key;
    results.push(r);
  }

  const anyDead = results.some((r) => r.state === "dead");
  const controlUp = anyDead ? await controlReachable(CONTROL) : true;
  const { verdict, code, downgradeDead } = decideVerdict(results, controlUp);
  if (downgradeDead) {
    for (const r of results) if (r.state === "dead") { r.state = "unresolved"; r.reason = "dead signature BUT egress control unreachable — not trusted: " + r.reason; }
  }

  const out = { verdict, source: BRAND_SOURCE, control: anyDead ? (controlUp ? "up" : "down") : "not-probed", doors: results.map((r) => ({ key: r.key, url: r.url, state: r.state, status: r.status, detail: r.detail, reason: r.reason })) };
  console.log(JSON.stringify(out, null, 2));

  if (verdict === "DEFECT") {
    console.error("\nLEAD-MAGNET-CTA DEFECT — a keyword-CTA door is DEAD on the live edge. Every 'comment TEAM/BODY/BUILD' lead the social bot routes here dead-ends on a 404/parked page while the auto-reply keeps sending the link:");
    for (const r of results.filter((r) => r.state === "dead")) console.error(`  [${r.label}] — ${r.reason}`);
    console.error("\nFix: redeploy / restore the sell4daddy.com route(s) on that Vercel project, or update the url in src/lib/brand.ts KEYWORDS to the live door. The door is the mouth of the lead-printing funnel; a dead one leaks every keyword-CTA lead silently.");
    process.exit(1);
  }
  if (verdict === "UNRESOLVED") {
    console.error("\n⚠️  lead-magnet-cta UNRESOLVED — a door was neither proved alive nor dead (transient 5xx/timeout/DNS). NOT a defect; re-run to confirm. A persistent domain lapse surfaces here as a repeating daily warning.");
    for (const r of results.filter((r) => r.state === "unresolved")) console.error(`  [${r.label}] — ${r.reason}`);
    process.exit(3);
  }
  if (verdict === "UNKNOWN") {
    console.log("\nlead-magnet-cta UNKNOWN — egress control down; door verdicts not trusted (runner/network offline, not a dead door).");
    process.exit(0);
  }
  console.log(`\n✅ lead-magnet-cta CLEAN — ${results.length} keyword-CTA door(s) serve live: ` +
    results.map((r) => `${r.key} ${r.url} (${r.status}${r.brand === false ? ", brand marker absent" : ""})`).join(", "));
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();
else main();
