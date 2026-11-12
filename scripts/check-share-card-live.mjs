#!/usr/bin/env node
// check-share-card-live.mjs — prove the funnel's social-share preview image
// (og:image / twitter:image) is still ALIVE on the live edge. Owned by the
// Website Integrity Bot.
//
// WHY THIS EXISTS. The share card is the funnel's single most-SHARED conversion
// asset. Every time a recruiting link to apex-financial.org is posted on
// LinkedIn, X, Facebook, Discord, iMessage, WhatsApp, or Slack, the preview
// crawler (none of which run JS) reads the SERVED index.html's og:image +
// twitter:image and renders that image as the card. That image is a single
// static file in public/ (galaxy-recruit-og.jpg) named in
// scripts/data/share-card.json. It lives OUTSIDE Vite's content-hashed build
// (it is referenced by a fixed, human-shareable URL), so a deploy that drops
// the public/ asset — or a manifest re-render that bumps the filename without
// shipping the new file — kills the card for every share, everywhere.
//
// THE SILENT FAILURE IS THE 465-INSURACLOUD MASQUERADE, PROVEN ON THIS SITE.
// vercel.json's catch-all rewrite exempts only /api, /assets, /fonts, /img.
// A root-level file like /galaxy-recruit-og.jpg is NOT exempt, so if that file
// is missing from a deploy the request falls through to the SPA shell and the
// edge answers 200 text/html — the HTML of the homepage, not an image. Measured
// 2026-11-12: GET /this-file-does-not-exist.jpg -> 200 text/html. So the live
// URL "200s" while every share card renders blank/broken. A status check alone
// reads that as success; this guard does not.
//
// EVERY EXISTING GUARD IS BLIND TO THIS:
//   - check-share-card (commit gate) proves the SVG -> image -> og:image chain
//     is consistent AT SOURCE and that the wordmark is on-brand; it never makes
//     one HTTP request, so the file can vanish from the live edge while it stays
//     green. (Same source/live split that check-vsl-sync had before
//     check-vsl-media-live: the consistency guard and the liveness guard are
//     two different jobs.)
//   - route-smoke proves the HTML shell 200s — which is EXACTLY the masquerade
//     response a missing image returns, so it can never catch this.
//   - the asset-graph guard resolves JS/CSS build chunks; the share card is a
//     fixed-name static file, not a hashed build asset, so it escapes it.
//   - check-index-brand / check-edge-*-brand read source text, never image bytes
//     over the wire.
//
// WHY STATUS ALONE IS NOT ENOUGH. A live object must POSITIVELY serve 200/206
// AND an image/* content-type. A 2xx carrying text/html (the SPA shell) or an
// application/json error body — a soft-success masquerade — reads DEAD, never
// alive. That content-type discriminator is the whole point.
//
// WHY A RANGED GET. bytes=0-0 proves the object is served without pulling the
// full image; a healthy static file answers 200 (range ignored) or 206.
//
// WHY IT CAN'T CRY WOLF (exit contract shared with check-vsl-media-live.mjs and
// live-render-integrity.mjs so a cron wrapper / apex-doctor grades it alike):
//   - a positive dead signature (2xx wrong-family, or 4xx) with egress proven up
//     is a DEFECT (exit 1): the card is dead for real shares.
//   - a 5xx / timeout / connection error is transient infra -> UNRESOLVED
//     (exit 3), never a DEFECT. Re-run clears it.
//   - if the egress control (generate_204) is itself unreachable the verdict is
//     UNKNOWN (exit 0) and no "dead" is trusted — a runner/network blip must
//     never read as a dead asset (MP-291).
//   0 CLEAN | 0 UNKNOWN (network) | 1 DEFECT | 3 UNRESOLVED/partial
//
// The probed URL is DERIVED from scripts/data/share-card.json (the render
// manifest — the single source of truth) joined to the production origin, never
// hardcoded. check-share-card already GATES that index.html's og:image and
// twitter:image equal that exact URL at every commit, so probing the
// manifest-derived URL covers what the live site advertises; a re-render that
// bumps the filename is probed at its NEW url automatically and this guard can
// never go stale against a URL the site no longer serves.
//
// Usage:
//   node scripts/check-share-card-live.mjs
//   node scripts/check-share-card-live.mjs --selftest   # deterministic, local-only

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = resolve(ROOT, "scripts/data/share-card.json");
const SITE = (process.env.SHARE_CARD_SITE || "https://apex-financial.org/").replace(/\/*$/, "/");
const CONTROL = process.env.SHARE_CARD_CONTROL_URL || "https://www.google.com/generate_204";
const TIMEOUT_MS = Number(process.env.SHARE_CARD_TIMEOUT_MS || 25000);

// ---- pure classifier ------------------------------------------------------
// Decide alive / dead / unresolved from a single object probe descriptor.
// Pure of network + process state so --selftest drives it deterministically.
function classify({ networkError, status, contentType }) {
  if (networkError) {
    // connection refused / DNS / timeout: transient, NOT a positive object-gone
    // signal. Never a DEFECT on its own.
    return { state: "unresolved", reason: `network error: ${networkError}` };
  }
  const ct = String(contentType || "").toLowerCase().split(";")[0].trim();
  const served = status === 200 || status === 206;
  if (served && ct.startsWith("image/")) {
    return { state: "alive", status, contentType: ct };
  }
  if (served) {
    // 2xx but NOT an image. On this SPA a missing root file falls through to the
    // catch-all and returns 200 text/html (the homepage shell); a storage/proxy
    // error body is application/json. Either way the URL is not serving the
    // image a share crawler will render — a soft-success masquerade reads DEAD.
    return {
      state: "dead", status, contentType: ct,
      reason: `served ${status} but content-type is "${ct || "(none)"}", not image/* — the share-card file is missing from the deploy and the SPA catch-all is serving the HTML shell (or an error body) in its place; every social share previews a broken/blank card`,
    };
  }
  if (status >= 400 && status < 500) {
    return {
      state: "dead", status, contentType: ct,
      reason: `HTTP ${status} — the share-card image is missing, moved, or forbidden (dropped from deploy / re-rendered without shipping the new file)`,
    };
  }
  // 5xx or any other non-2xx: transient edge/infra, not a deleted object.
  return {
    state: "unresolved", status, contentType: ct,
    reason: `HTTP ${status || 0} — transient edge/infra response, not a positive object-gone signal`,
  };
}

// ---- object probe (ranged GET, one retry on network hiccup) ----------------
async function probeObject(url) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
      await r.arrayBuffer().catch(() => {});
      const res = classify({ status: r.status, contentType: r.headers.get("content-type") });
      return { url, ...res };
    } catch (e) {
      last = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160);
      // a single nav hiccup is not evidence of death — retry once
    }
  }
  return { url, ...classify({ networkError: last || "unknown" }) };
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

// Derive the live share-card URL from the render manifest, the same source of
// truth check-share-card reads, joined to the production origin exactly as
// check-share-card builds the expected og:image.
function canonicalObjects() {
  if (!existsSync(MANIFEST)) {
    console.error(`[check-share-card-live] missing required file: ${MANIFEST}`);
    process.exit(1);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    if (!manifest.image) throw new Error("manifest has no `image`");
  } catch (e) {
    console.error(`[check-share-card-live] scripts/data/share-card.json unreadable (${e.message})`);
    process.exit(1);
  }
  const url = SITE + String(manifest.image).replace(/^public\//, "");
  return [
    { url, label: "share card (og:image + twitter:image on every served route — the social preview of every funnel link)" },
  ];
}

// ---- selftest: deterministic, local-only -----------------------------------
async function selftest() {
  let pass = 0, total = 0;
  const ok = (cond, msg) => { total++; if (cond) { pass++; console.log(`✓ ${msg}`); } else { console.log(`✗ ${msg}`); } };

  // 1. Pure classifier, both directions. The SPA-shell masquerade is THE case.
  ok(classify({ status: 200, contentType: "image/jpeg" }).state === "alive", "200 image/jpeg -> alive");
  ok(classify({ status: 206, contentType: "image/png" }).state === "alive", "206 image/png -> alive");
  ok(classify({ status: 200, contentType: "text/html; charset=utf-8" }).state === "dead", "200 text/html (SPA shell masquerade) -> dead");
  ok(classify({ status: 200, contentType: "application/json" }).state === "dead", "200 json error body -> dead");
  ok(classify({ status: 404, contentType: "application/json" }).state === "dead", "404 -> dead");
  ok(classify({ status: 403, contentType: "text/plain" }).state === "dead", "403 forbidden -> dead");
  ok(classify({ status: 503, contentType: "text/plain" }).state === "unresolved", "503 -> unresolved (transient)");
  ok(classify({ networkError: "fetch failed" }).state === "unresolved", "network error -> unresolved");
  ok(classify({ status: 200, contentType: "" }).state === "dead", "200 with no content-type -> dead (not an image)");

  // 2. End-to-end probeObject against a local server (faithful fetch pipeline).
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/live.jpg") { res.writeHead(206, { "content-type": "image/jpeg" }); res.end("A"); return; }
    if (path === "/shell") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<!doctype html><html>…SPA shell…</html>"); return; }
    if (path === "/missing") { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "not_found" })); return; }
    if (path === "/infra") { res.writeHead(500, { "content-type": "text/plain" }); res.end("upstream error"); return; }
    if (path === "/ctl") { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { "content-type": "application/json" }); res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  ok((await probeObject(`${origin}/live.jpg`)).state === "alive", "e2e probe live.jpg -> alive");
  ok((await probeObject(`${origin}/shell`)).state === "dead", "e2e probe 200-text/html SPA shell -> dead");
  ok((await probeObject(`${origin}/missing`)).state === "dead", "e2e probe 404 -> dead");
  ok((await probeObject(`${origin}/infra`)).state === "unresolved", "e2e probe 500 -> unresolved");

  // 3. Control reachability, both directions (prove the UNKNOWN gate is real).
  const ctlUp = await controlReachable(`${origin}/ctl`);
  ok(ctlUp === true, "control /ctl reachable -> true");
  await new Promise((r) => server.close(r));
  const ctlDown = await controlReachable(`http://127.0.0.1:${port}/ctl`); // server now closed
  ok(ctlDown === false, "control unreachable after close -> false");

  // 4. decideVerdict: the control gate is load-bearing.
  const deadRes = [{ state: "dead" }];
  ok(decideVerdict(deadRes, true).verdict === "DEFECT" && decideVerdict(deadRes, true).code === 1, "dead + control up -> DEFECT(1)");
  ok(decideVerdict(deadRes, false).verdict === "UNKNOWN" && decideVerdict(deadRes, false).code === 0, "dead + control DOWN -> UNKNOWN(0), not trusted");
  ok(decideVerdict([{ state: "unresolved" }], true).verdict === "UNRESOLVED", "unresolved + control up -> UNRESOLVED(3)");
  ok(decideVerdict([{ state: "unresolved" }], true).code === 3, "unresolved -> exit 3");
  ok(decideVerdict([{ state: "alive" }], true).verdict === "CLEAN", "alive -> CLEAN(0)");

  console.log(`\nselftest: ${pass}/${total}`);
  if (pass !== total) { console.error("SELFTEST FAILED — the share-card alive/dead detector is wrong."); process.exit(1); }
  console.log("✅ selftest: alive/dead/unresolved + SPA-shell masquerade + control-gating all classified correctly, both directions.");
  process.exit(0);
}

// ---- live run --------------------------------------------------------------
async function main() {
  const objects = canonicalObjects();
  const results = [];
  for (const o of objects) {
    const r = await probeObject(o.url);
    r.label = o.label;
    results.push(r);
  }

  const anyDead = results.some((r) => r.state === "dead");
  const controlUp = anyDead ? await controlReachable(CONTROL) : true;
  const { verdict, code, downgradeDead } = decideVerdict(results, controlUp);
  if (downgradeDead) {
    for (const r of results) if (r.state === "dead") { r.state = "unresolved"; r.reason = "dead signature BUT egress control unreachable — not trusted: " + r.reason; }
  }

  const out = { verdict, control: anyDead ? (controlUp ? "up" : "down") : "not-probed", objects: results };
  console.log(JSON.stringify(out, null, 2));

  if (verdict === "DEFECT") {
    console.error("\nSHARE CARD DEFECT — the funnel's social-share preview image is DEAD. Every LinkedIn/X/Facebook/Discord/iMessage share of an apex-financial.org recruiting link now previews a broken/blank card:");
    for (const r of results.filter((r) => r.state === "dead")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    console.error("\nFix: restore public/galaxy-recruit-og.jpg (or whatever scripts/data/share-card.json names) and redeploy; re-render with `node scripts/render-share-card.mjs` if the SVG changed.");
    process.exit(1);
  }
  if (verdict === "UNRESOLVED") {
    console.error("\n⚠️  share card UNRESOLVED — neither proved alive nor dead (transient 5xx/timeout). NOT a defect; re-run to confirm.");
    for (const r of results.filter((r) => r.state === "unresolved")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    process.exit(3);
  }
  if (verdict === "UNKNOWN") {
    console.log("\nshare card UNKNOWN — egress control down; object verdicts not trusted (runner/network offline, not a dead asset).");
    process.exit(0);
  }
  console.log(`\n✅ share card CLEAN — the social preview serves live: ` +
    results.map((r) => `${r.url.replace(/^https?:\/\//, "").split("/").pop()} (${r.status} ${r.contentType})`).join(", "));
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();
else main();
