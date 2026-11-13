#!/usr/bin/env node
// check-vsl-media-live.mjs — prove every hosted conversion-funnel video + poster
// the site serves is still ALIVE at its storage origin. Owned by the Website
// Integrity Bot. (Script/CI/cron name kept for its established wiring; scope is
// now all three conversion-media libs, not the VSL alone — MP-WIB-MEDIA-SWEEP.)
//
// WHY THIS EXISTS. The funnel serves three public videos, each a persuasive or
// load-bearing conversion asset, each pinned to ONE Supabase storage pair
// (mp4 + jpg poster) in its own source-of-truth lib:
//   - src/lib/vslMedia.ts        apex-vsl.mp4         — homepage hero + /vsl player + index.html VideoObject (Google video rich results + AI-search)
//   - src/lib/licensingMedia.ts  how-to-get-...mp4    — /get-licensed licensing player (the unlicensed-prospect conversion path)
//   - src/lib/onboardingMedia.ts apex-new-agent-...mp4 — /get-licensed + post-submit onboarding player
// Every object lives in a PUBLIC storage bucket, OUTSIDE the git tree and OUTSIDE
// Vite's content-hashed build. A re-cut that bumps a *_MEDIA_BASE but forgets to
// upload, an accidental object delete, or the bucket flipping private kills the
// player on its surface AND (for the VSL) points the Google VideoObject at a dead
// URL — every visitor sees a black box reading "this video cannot be played".
// Live-render-integrity confirmed 2026-11-13 that /get-licensed fires requests to
// the licensing + onboarding objects (they serve 206 today); only the VSL pair
// was guarded until this sweep, so either of the other two could silently rot.
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
// The probed URLs are DERIVED from each lib's *_MEDIA_BASE const + the src/poster
// filenames in its template literals (the single source of truth), never
// hardcoded here — so a future re-cut that bumps any base or renames an object is
// probed at its NEW url automatically, and this guard can never go stale against
// a URL the site no longer serves. check-vsl-sync already pins index.html's
// VideoObject + preload to the VSL base, so probing the derived VSL objects
// covers that player AND the structured data.
//
// Usage:
//   node scripts/check-vsl-media-live.mjs
//   node scripts/check-vsl-media-live.mjs --selftest   # deterministic, local-only

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Each conversion-media lib pins ONE public storage pair (video mp4 + jpg poster)
// the funnel serves. Probed URLs are derived from each lib below — add a lib here
// and its pair is swept automatically.
const MEDIA_LIBS = [
  { path: resolve(ROOT, "src/lib/vslMedia.ts"),        name: "VSL",        surface: "homepage hero + /vsl player + Google VideoObject" },
  { path: resolve(ROOT, "src/lib/licensingMedia.ts"),  name: "Licensing",  surface: "/get-licensed licensing player" },
  { path: resolve(ROOT, "src/lib/onboardingMedia.ts"), name: "Onboarding", surface: "/get-licensed + post-submit onboarding player" },
];
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

// Derive a lib's (video, poster) object pair from its *_MEDIA_BASE const + the
// src/poster filenames in its template literals — the same single-source-of-truth
// discipline as check-vsl-sync.mjs. Nothing is hardcoded, so a re-cut that bumps
// the base OR renames the object is probed at its new url automatically. A lib
// that cannot be read or parsed exits(1) LOUDLY rather than silently probing
// fewer objects (the fake-success failure mode this repo keeps paying for).
function objectsFromLib({ path, name, surface }) {
  if (!existsSync(path)) {
    console.error(`[check-vsl-media-live] missing required media lib: ${path}`);
    process.exit(1);
  }
  const src = readFileSync(path, "utf8");
  const baseM = src.match(/const\s+([A-Z0-9_]*MEDIA_BASE)\s*=\s*["']([^"']+)["']/);
  if (!baseM) {
    console.error(`[check-vsl-media-live] could not find a *_MEDIA_BASE const in ${path}`);
    process.exit(1);
  }
  const baseConst = baseM[1];
  const base = baseM[2].replace(/\/$/, "");
  const grab = (field) => {
    const m = src.match(new RegExp(field + "\\s*:\\s*`\\$\\{" + baseConst + "\\}\\/([^`]+)`"));
    return m ? m[1] : null;
  };
  const videoFile = grab("src");
  const posterFile = grab("poster");
  if (!videoFile || !posterFile) {
    console.error(`[check-vsl-media-live] ${path}: could not derive ${videoFile ? "" : "src(video) "}${posterFile ? "" : "poster "}filename from a \`\${${baseConst}}/...\` template literal`);
    process.exit(1);
  }
  return [
    { url: `${base}/${videoFile}`, expectFamily: "video", label: `${name} video (${surface})` },
    { url: `${base}/${posterFile}`, expectFamily: "image", label: `${name} poster (${surface})` },
  ];
}

// Every conversion-media object across all libs. One flake-proof probe set.
function canonicalObjects() {
  return MEDIA_LIBS.flatMap(objectsFromLib);
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

  // 5. canonicalObjects parses ALL conversion-media libs from real source — the
  // load-bearing anti-fake-success assertion. A parser that silently matched
  // nothing would probe fewer objects and still read CLEAN; pin the count, the
  // family split, the url shape, and that each lib's distinct storage prefix is
  // actually present (so dropping a lib from the sweep fails loudly here).
  const objs = canonicalObjects();
  ok(objs.length === MEDIA_LIBS.length * 2, `canonicalObjects -> ${MEDIA_LIBS.length * 2} objects (video+poster per lib); got ${objs.length}`);
  ok(objs.filter((o) => o.expectFamily === "video").length === MEDIA_LIBS.length, `${MEDIA_LIBS.length} video objects (one per lib)`);
  ok(objs.filter((o) => o.expectFamily === "image").length === MEDIA_LIBS.length, `${MEDIA_LIBS.length} poster objects (one per lib)`);
  ok(objs.every((o) => /^https:\/\/.+\.(mp4|jpg|jpeg|png|webp)$/.test(o.url)), "every derived url is an absolute https media url");
  ok(["/vsl/", "/licensing/", "/onboarding/"].every((seg) => objs.some((o) => o.url.includes(seg))), "all three storage prefixes (vsl, licensing, onboarding) present");

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
    console.error("\nCONVERSION-MEDIA DEFECT — a hosted funnel video/poster is DEAD; the surface that embeds it serves a broken player (and for the VSL, the Google VideoObject points at a dead URL):");
    for (const r of results.filter((r) => r.state === "dead")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    process.exit(1);
  }
  if (verdict === "UNRESOLVED") {
    console.error("\n⚠️  conversion media UNRESOLVED — an object neither proved alive nor dead (transient 5xx/timeout). NOT a defect; re-run to confirm.");
    for (const r of results.filter((r) => r.state === "unresolved")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    process.exit(3);
  }
  if (verdict === "UNKNOWN") {
    console.log("\nconversion media UNKNOWN — egress control down; object verdicts not trusted (runner/network offline, not a dead asset).");
    process.exit(0);
  }
  console.log(`\n✅ conversion media CLEAN — all ${results.length} canonical objects serve live: ` +
    results.map((r) => `${r.url.replace(/^https?:\/\//, "").split("/").pop()} (${r.status} ${r.contentType})`).join(", "));
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();
else main();
