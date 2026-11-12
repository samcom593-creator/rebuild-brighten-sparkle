#!/usr/bin/env node
// check-vsl-media-live.mjs — prove the hosted VSL video + poster the recruiting
// funnel actually serves are still ALIVE at their storage origin. Owned by the
// Website Integrity Bot.
//
// WHY THIS EXISTS. The public VSL is the funnel's single most persuasive asset:
// the homepage hero plays it, /vsl is built around it, and index.html's
// VideoObject structured data (contentUrl + thumbnailUrl) hands it to Google
// video rich results and AI-search. All three read ONE pair of Supabase storage
// objects — apex-vsl.mp4 and apex-vsl-poster.jpg — pinned in src/lib/vslMedia.ts.
// Those objects live in a public storage bucket, OUTSIDE the git tree and
// OUTSIDE Vite's content-hashed build. A re-cut that bumps VSL_MEDIA_BASE but
// forgets to upload, an accidental object delete, or the bucket flipping private
// kills the player on / and /vsl AND points the VideoObject at a dead URL — and
// every visitor sees a black box reading "Your browser cannot play this video".
//
// EVERY EXISTING GUARD IS BLIND TO THIS:
//   - route-smoke proves the /vsl HTML shell 200s; the <video><source> is a
//     SEPARATE request the page-load smoke never makes.
//   - check-vsl-sync (commit gate) proves the homepage player, the preload, the
//     VideoObject, and BUMP_VERSION all reference the SAME release — a
//     source-consistency check that never makes one HTTP request. All five
//     surfaces can agree perfectly on a URL that 404s.
//   - the asset-graph guard (MP-297) resolves the JS/CSS modulepreload chunks;
//     the mp4/poster are storage objects, not build assets, so they escape it.
//   - live-render-integrity scans rendered text/tokens, not media bytes.
// So a storage object can rot on Supabase's clock, independent of any deploy,
// and the funnel keeps serving the dead <source> forever while every
// source/render/asset guard stays green.
//
// WHY A RANGED GET, NOT A FULL DOWNLOAD. The video is ~196 MB. A bytes=0-0 range
// request proves the object exists and is being served (a healthy object answers
// 206 with the media content-type) while transferring one byte.
//
// WHY STATUS ALONE IS NOT ENOUGH (the 465-InsuraCloud fake-success lesson). An
// object that is gone returns a Supabase storage error — measured 2026-11-12:
// HTTP 400 with content-type application/json, not a 2xx media response. So a
// live object must POSITIVELY serve 200/206 AND a matching media content-type
// (video/* for the mp4, image/* for the poster). A 2xx carrying an
// application/json error body — a soft-success masquerade — reads DEAD, never
// alive.
//
// WHY IT CAN'T CRY WOLF. It probes a third-party origin that can flake:
//   - A positive object-gone signal (4xx, or 2xx with the wrong content-type)
//     with egress proven up is a DEFECT (exit 1): the asset is persistently
//     dead for real visitors.
//   - A 5xx / timeout / connection error is transient infra, reported as
//     UNRESOLVED (exit 3), never a DEFECT — a Supabase hiccup is not a deleted
//     object. Re-run clears it.
//   - If the egress control (generate_204) is itself unreachable, the verdict is
//     UNKNOWN (exit 0) and no "dead" is trusted — a runner/network blip must
//     never read as a dead asset (MP-291).
//
// Verdict / exit contract shared with live-render-integrity.mjs and
// check-funnel-external-cta.mjs so a cron wrapper / apex-doctor grades it the
// same way:
//   0 CLEAN | 0 UNKNOWN (network) | 1 DEFECT | 3 UNRESOLVED/partial
//
// The probed URLs are DERIVED from src/lib/vslMedia.ts (the single source of
// truth), never hardcoded here — so a future re-cut that bumps VSL_MEDIA_BASE is
// probed at its NEW object automatically, and this guard can never go stale
// against a URL the site no longer serves. check-vsl-sync already pins
// index.html's VideoObject + preload to this same base, so probing the two
// derived objects covers the player AND the structured data.
//
// Usage:
//   node scripts/check-vsl-media-live.mjs
//   node scripts/check-vsl-media-live.mjs --selftest   # deterministic, local-only

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA = resolve(ROOT, "src/lib/vslMedia.ts");
const CONTROL = process.env.VSL_CONTROL_URL || "https://www.google.com/generate_204";
const TIMEOUT_MS = Number(process.env.VSL_TIMEOUT_MS || 25000);

// ---- pure classifier ------------------------------------------------------
// Decide alive / dead / unresolved from a single object probe descriptor.
// Pure of network + process state so --selftest drives it deterministically.
//   expectFamily: "video" | "image"
function classify({ networkError, status, contentType, expectFamily }) {
  if (networkError) {
    // connection refused / DNS / timeout: transient, NOT a positive object-gone
    // signal. Never a DEFECT on its own.
    return { state: "unresolved", reason: `network error: ${networkError}` };
  }
  const ct = String(contentType || "").toLowerCase().split(";")[0].trim();
  const served = status === 200 || status === 206;
  if (served && ct.startsWith(expectFamily + "/")) {
    return { state: "alive", status, contentType: ct };
  }
  if (served) {
    // 2xx but NOT a media content-type. A Supabase error body is JSON; an HTML
    // error page is text/html. Either way the object is not being served as the
    // media it must be — a soft-success masquerade reads DEAD.
    return {
      state: "dead", status, contentType: ct,
      reason: `served ${status} but content-type is "${ct || "(none)"}", not ${expectFamily}/* — object missing or an error body masquerading as success`,
    };
  }
  if (status >= 400 && status < 500) {
    return {
      state: "dead", status, contentType: ct,
      reason: `HTTP ${status} — object is missing, moved, or access was revoked (deleted / re-cut without upload / bucket flipped private)`,
    };
  }
  // 5xx or any other non-2xx: transient storage/infra, not a deleted object.
  return {
    state: "unresolved", status, contentType: ct,
    reason: `HTTP ${status || 0} — transient storage/infra response, not a positive object-gone signal`,
  };
}

// ---- object probe (ranged GET, one retry on network hiccup) ----------------
async function probeObject(url, expectFamily) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
      // Drain the (1-byte) body so the socket is freed deterministically.
      await r.arrayBuffer().catch(() => {});
      const res = classify({ status: r.status, contentType: r.headers.get("content-type"), expectFamily });
      return { url, expectFamily, ...res };
    } catch (e) {
      last = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160);
      // a single nav hiccup is not evidence of death — retry once
    }
  }
  return { url, expectFamily, ...classify({ networkError: last || "unknown", expectFamily }) };
}

async function controlReachable(controlUrl) {
  try {
    const r = await fetch(controlUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
    return r.status === 204 || r.ok;
  } catch { return false; }
}

// ---- verdict (pure) --------------------------------------------------------
// Given the per-object results and whether egress is up, decide the run verdict.
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

// Parse the canonical media base from src/lib/vslMedia.ts — same regex as
// check-vsl-sync.mjs, so the two guards read the identical source of truth.
function canonicalObjects() {
  if (!existsSync(MEDIA)) {
    console.error(`[check-vsl-media-live] missing required file: ${MEDIA}`);
    process.exit(1);
  }
  const media = readFileSync(MEDIA, "utf8");
  const m = media.match(/const\s+VSL_MEDIA_BASE\s*=\s*["']([^"']+)["']/);
  if (!m) {
    console.error("[check-vsl-media-live] could not find VSL_MEDIA_BASE in src/lib/vslMedia.ts");
    process.exit(1);
  }
  const base = m[1].replace(/\/$/, "");
  return [
    { url: `${base}/apex-vsl.mp4`, expectFamily: "video", label: "VSL video (hero + /vsl player + VideoObject.contentUrl)" },
    { url: `${base}/apex-vsl-poster.jpg`, expectFamily: "image", label: "VSL poster (player poster + VideoObject.thumbnailUrl)" },
  ];
}

// ---- selftest: deterministic, local-only -----------------------------------
async function selftest() {
  let pass = 0, total = 0;
  const ok = (cond, msg) => { total++; if (cond) { pass++; console.log(`✓ ${msg}`); } else { console.log(`✗ ${msg}`); } };

  // 1. Pure classifier, both directions.
  ok(classify({ status: 206, contentType: "video/mp4", expectFamily: "video" }).state === "alive", "206 video/mp4 -> alive");
  ok(classify({ status: 200, contentType: "image/jpeg", expectFamily: "image" }).state === "alive", "200 image/jpeg -> alive");
  ok(classify({ status: 400, contentType: "application/json; charset=utf-8", expectFamily: "video" }).state === "dead", "400 json (object gone) -> dead");
  ok(classify({ status: 404, contentType: "application/json", expectFamily: "image" }).state === "dead", "404 json -> dead");
  ok(classify({ status: 200, contentType: "application/json", expectFamily: "video" }).state === "dead", "200 json masquerade -> dead");
  ok(classify({ status: 200, contentType: "text/html", expectFamily: "video" }).state === "dead", "200 html error page -> dead");
  ok(classify({ status: 503, contentType: "text/plain", expectFamily: "video" }).state === "unresolved", "503 -> unresolved (transient)");
  ok(classify({ networkError: "fetch failed", expectFamily: "video" }).state === "unresolved", "network error -> unresolved");
  ok(classify({ status: 206, contentType: "video/mp4", expectFamily: "image" }).state === "dead", "video bytes where image expected -> dead (wrong family)");

  // 2. End-to-end probeObject against a local server (faithful fetch pipeline).
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/live.mp4") { res.writeHead(206, { "content-type": "video/mp4", "content-range": "bytes 0-0/196415361" }); res.end("A"); return; }
    if (path === "/live.jpg") { res.writeHead(206, { "content-type": "image/jpeg" }); res.end("A"); return; }
    if (path === "/missing") { res.writeHead(400, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "not_found", message: "Object not found" })); return; }
    if (path === "/masquerade") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "nope" })); return; }
    if (path === "/infra") { res.writeHead(500, { "content-type": "text/plain" }); res.end("upstream error"); return; }
    if (path === "/ctl") { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { "content-type": "application/json" }); res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  ok((await probeObject(`${origin}/live.mp4`, "video")).state === "alive", "e2e probe live.mp4 -> alive");
  ok((await probeObject(`${origin}/live.jpg`, "image")).state === "alive", "e2e probe live.jpg -> alive");
  ok((await probeObject(`${origin}/missing`, "video")).state === "dead", "e2e probe missing -> dead");
  ok((await probeObject(`${origin}/masquerade`, "video")).state === "dead", "e2e probe 200-json masquerade -> dead");
  ok((await probeObject(`${origin}/infra`, "video")).state === "unresolved", "e2e probe 500 -> unresolved");

  // 3. Control reachability, both directions (prove the UNKNOWN gate is real).
  const ctlUp = await controlReachable(`${origin}/ctl`);
  ok(ctlUp === true, "control /ctl reachable -> true");
  await new Promise((r) => server.close(r));
  const ctlDown = await controlReachable(`http://127.0.0.1:${port}/ctl`); // server now closed
  ok(ctlDown === false, "control unreachable after close -> false");

  // 4. decideVerdict: the control gate is load-bearing.
  const deadRes = [{ state: "dead" }, { state: "alive" }];
  ok(decideVerdict(deadRes, true).verdict === "DEFECT" && decideVerdict(deadRes, true).code === 1, "dead + control up -> DEFECT(1)");
  ok(decideVerdict(deadRes, false).verdict === "UNKNOWN" && decideVerdict(deadRes, false).code === 0, "dead + control DOWN -> UNKNOWN(0), not trusted");
  ok(decideVerdict([{ state: "unresolved" }, { state: "alive" }], true).verdict === "UNRESOLVED", "unresolved + control up -> UNRESOLVED(3)");
  ok(decideVerdict([{ state: "unresolved" }], true).code === 3, "unresolved -> exit 3");
  ok(decideVerdict([{ state: "alive" }, { state: "alive" }], true).verdict === "CLEAN", "all alive -> CLEAN(0)");

  console.log(`\nselftest: ${pass}/${total}`);
  if (pass !== total) { console.error("SELFTEST FAILED — the VSL-media alive/dead detector is wrong."); process.exit(1); }
  console.log("✅ selftest: alive/dead/unresolved + control-gating all classified correctly, both directions.");
  process.exit(0);
}

// ---- live run --------------------------------------------------------------
async function main() {
  const objects = canonicalObjects();
  const results = [];
  for (const o of objects) {
    const r = await probeObject(o.url, o.expectFamily);
    r.label = o.label;
    results.push(r);
  }

  const anyDead = results.some((r) => r.state === "dead");
  // Only pay for a control probe when a verdict actually depends on egress.
  const controlUp = anyDead ? await controlReachable(CONTROL) : true;
  const { verdict, code, downgradeDead } = decideVerdict(results, controlUp);
  if (downgradeDead) {
    for (const r of results) if (r.state === "dead") { r.state = "unresolved"; r.reason = "dead signature BUT egress control unreachable — not trusted: " + r.reason; }
  }

  const out = { verdict, control: anyDead ? (controlUp ? "up" : "down") : "not-probed", objects: results };
  console.log(JSON.stringify(out, null, 2));

  if (verdict === "DEFECT") {
    console.error("\nVSL MEDIA DEFECT — the recruiting funnel's video asset is DEAD (hero player, /vsl, and the Google VideoObject all point at it):");
    for (const r of results.filter((r) => r.state === "dead")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    process.exit(1);
  }
  if (verdict === "UNRESOLVED") {
    console.error("\n⚠️  VSL media UNRESOLVED — an object neither proved alive nor dead (transient 5xx/timeout). NOT a defect; re-run to confirm.");
    for (const r of results.filter((r) => r.state === "unresolved")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    process.exit(3);
  }
  if (verdict === "UNKNOWN") {
    console.log("\nVSL media UNKNOWN — egress control down; object verdicts not trusted (runner/network offline, not a dead asset).");
    process.exit(0);
  }
  console.log(`\n✅ VSL media CLEAN — both canonical objects serve live: ` +
    results.map((r) => `${r.url.replace(/^https?:\/\//, "").split("/").pop()} (${r.status} ${r.contentType})`).join(", "));
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();
else main();
