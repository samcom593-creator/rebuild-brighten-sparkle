#!/usr/bin/env node
// check-jsonld-asset-live.mjs — prove the SAME-ORIGIN media assets the live
// JSON-LD structured data references are still ALIVE on the live edge. Owned by
// the Website Integrity Bot.
//
// WHY THIS EXISTS (MP-WIB-JSONLD-ASSET-LIVE, 2026-11-17). The served index.html
// carries JSON-LD (schema.org) blocks that Google rich results, the Knowledge
// Panel, and AI-search / GEO engines (ChatGPT, Perplexity, Claude, Gemini) read
// to build the "Galaxy Financial" entity card. Those blocks reference image/media
// assets by URL — the Organization `logo` (the image a Knowledge Panel renders
// beside the brand name) chief among them. The logo is a fixed-name root static
// (galaxyfinancial.org/pwa-512x512.png) living OUTSIDE Vite's content-hashed build,
// so a deploy that drops it — or a JSON-LD edit that repoints the logo to a NEW
// dedicated file while shipping the reference but not the PNG — kills the entity
// image for every AI/search surface, silently.
//
// THE BLIND SPOT THIS CLOSES. The JSON-LD's own asset references were asserted
// live by NOTHING from the JSON-LD side:
//   - check-index-brand (commit gate) walks the SOURCE index.html JSON-LD, but it
//     DELIBERATELY SKIPS url/logo/thumbnailUrl/contentUrl/embedUrl (check-index-
//     brand.mjs:45-47 — they are path fields, not brand-name text), so it never
//     asserts the logo URL is present, let alone alive. It also reads from disk,
//     never over the wire.
//   - check-brand-static-live probes pwa-512x512.png, but it discovers it through
//     the MANIFEST icons[] chain, NOT the JSON-LD. The logo is alive today only
//     COINCIDENTALLY because it happens to equal a manifest icon; repoint the
//     JSON-LD logo to any URL not in the manifest, or drop pwa-512x512.png from
//     the manifest icons while the JSON-LD keeps naming it, and brand-static-live
//     stops watching it. Nothing probes the asset the JSON-LD actually names.
//   - check-vsl-media-live + check-vsl-sync cover the VideoObject contentUrl /
//     thumbnailUrl (supabase-hosted, cross-origin) from source; this guard scopes
//     to SAME-ORIGIN assets, so it neither double-probes those nor misses the
//     logo. The two guards partition the JSON-LD media set cleanly.
// Same source/live split check-share-card-live closed for the og:image and
// check-brand-static-live closed for the icon/manifest chain — the JSON-LD's own
// asset refs are the one structured-data surface with no from-JSON-LD liveness
// guard. This is that guard.
//
// THE SILENT FAILURE IS THE 465-INSURACLOUD MASQUERADE, PROVEN ON THIS SITE.
// vercel.json's catch-all rewrite exempts only /api,/assets,/fonts,/img. A root
// file like /pwa-512x512.png is NOT exempt, so if it is missing from a deploy the
// request falls through to the SPA shell and the edge answers 200 text/html — the
// homepage HTML, not an image (measured on this origin 2026-11-12). A status check
// alone reads that 200 as success; this guard does not: a live media asset must
// POSITIVELY serve 200/206 AND an image/* (or video/*) content-type. A 2xx
// carrying text/html (the SPA shell) or application/json (an error body) reads
// DEAD. That content-type discriminator is the whole point.
//
// WHY IT CAN'T WATCH NOTHING. The object set is DERIVED from the LIVE served
// index.html, not a local file, so a regression that strips the Organization
// logo out of the structured data entirely would leave the set empty. An empty
// set on a 2xx HTML response (egress proven up) is itself a DEFECT — "the entity
// logo Google/AI-search reads is gone" — never a silent CLEAN. A guard that
// passes by finding nothing is the disease it exists to catch.
//
// WHY IT CAN'T CRY WOLF (exit contract shared with check-share-card-live.mjs /
// check-vsl-media-live.mjs / live-render-integrity.mjs so a cron wrapper /
// apex-doctor grades it alike):
//   - a positive dead signature (2xx wrong-family, or 4xx) with egress proven up
//     is a DEFECT (exit 1): the asset is dead for real crawlers.
//   - a 5xx / timeout / connection error (on the index fetch OR an asset probe)
//     is transient infra -> UNRESOLVED (exit 3), never a DEFECT. Re-run clears it.
//   - if the egress control (generate_204) is itself unreachable the verdict is
//     UNKNOWN (exit 0) and no "dead" is trusted — a runner/network blip must
//     never read as a dead asset (MP-291).
//   0 CLEAN | 0 UNKNOWN (network) | 1 DEFECT | 3 UNRESOLVED/partial
//
// Usage:
//   node scripts/check-jsonld-asset-live.mjs
//   node scripts/check-jsonld-asset-live.mjs --selftest   # deterministic, local-only

import http from "node:http";

const SITE = (process.env.JSONLD_ASSET_SITE || "https://galaxyfinancial.org/").replace(/\/*$/, "/");
const CONTROL = process.env.JSONLD_ASSET_CONTROL_URL || "https://www.google.com/generate_204";
const TIMEOUT_MS = Number(process.env.JSONLD_ASSET_TIMEOUT_MS || 25000);

// schema.org keys whose VALUE names a media/image ASSET file (not a page URL like
// `url`/`embedUrl`, which would 200 text/html and are pages, not assets).
const ASSET_KEYS = new Set(["logo", "image", "thumbnailurl", "contenturl", "photo"]);

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
  if (served && (ct.startsWith("image/") || ct.startsWith("video/"))) {
    return { state: "alive", status, contentType: ct };
  }
  if (served) {
    // 2xx but NOT a media asset. On this SPA a missing root file falls through to
    // the catch-all and returns 200 text/html (the homepage shell); a storage /
    // proxy error body is application/json. Either way the URL is not serving the
    // asset a crawler will render — a soft-success masquerade reads DEAD.
    return {
      state: "dead", status, contentType: ct,
      reason: `served ${status} but content-type is "${ct || "(none)"}", not image/* or video/* — the JSON-LD asset is missing from the deploy and the SPA catch-all is serving the HTML shell (or an error body) in its place; Google/AI-search render the entity card with a broken/absent image`,
    };
  }
  if (status >= 400 && status < 500) {
    return {
      state: "dead", status, contentType: ct,
      reason: `HTTP ${status} — the JSON-LD asset is missing, moved, or forbidden (dropped from deploy / repointed without shipping the new file)`,
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

// ---- fetch the served index.html (full GET, one retry) ---------------------
// Returns { html } on a 2xx text/html response, { networkError } on a transport
// failure or timeout, or { badStatus, status, contentType } on a non-HTML 2xx /
// non-2xx response (treated as transient/unresolved by the caller, never a
// positive "logo gone" signal).
async function fetchIndexHtml(url) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
      const ct = String(r.headers.get("content-type") || "").toLowerCase();
      const body = await r.text().catch(() => "");
      if ((r.status === 200 || r.status === 206) && ct.includes("text/html")) {
        return { html: body };
      }
      return { badStatus: true, status: r.status, contentType: ct };
    } catch (e) {
      last = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160);
    }
  }
  return { networkError: last || "unknown" };
}

// ---- parse JSON-LD + collect same-origin asset URLs (pure) ------------------
// Walk every <script type="application/ld+json"> block, recurse through its
// parsed value, and collect every asset-key string value that resolves to a
// SAME-ORIGIN absolute URL. Dedupes; records the schema.org key for labelling.
function extractJsonLdAssets(html, site) {
  let siteOrigin;
  try { siteOrigin = new URL(site).origin; } catch { siteOrigin = null; }
  const found = new Map(); // url -> key (first key that named it)
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let blocks = 0, parsed = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    blocks++;
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    parsed++;
    const walk = (node) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        if (ASSET_KEYS.has(k.toLowerCase())) {
          const vals = Array.isArray(v) ? v : [v];
          for (const raw of vals) {
            // schema.org allows an asset as a bare URL string OR an ImageObject
            // {url/contentUrl}. A nested object is handled by the recursion below;
            // here we only take string values.
            if (typeof raw !== "string") continue;
            let abs = null;
            try { abs = new URL(raw, site).href; } catch { continue; }
            let origin = null;
            try { origin = new URL(abs).origin; } catch { continue; }
            if (siteOrigin && origin === siteOrigin && !found.has(abs)) {
              found.set(abs, k.toLowerCase());
            }
          }
        }
        if (v && typeof v === "object") walk(v);
      }
    };
    walk(data);
  }
  return { blocks, parsed, assets: [...found].map(([url, key]) => ({ url, key })) };
}

function labelFor(key, url) {
  const file = url.replace(/^https?:\/\//, "").split("/").pop();
  if (key === "logo") return `Organization logo (${file}) — the image Google Knowledge Panel + AI-search entity cards render beside the brand`;
  if (key === "image") return `JSON-LD image (${file}) — a structured-data entity image crawlers render`;
  if (key === "thumbnailurl") return `JSON-LD thumbnailUrl (${file}) — a structured-data media thumbnail`;
  if (key === "contenturl") return `JSON-LD contentUrl (${file}) — a structured-data media object`;
  return `JSON-LD ${key} (${file}) — a structured-data asset`;
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

  // 1. Pure classifier, both directions. The SPA-shell masquerade is THE case.
  ok(classify({ status: 200, contentType: "image/png" }).state === "alive", "200 image/png -> alive");
  ok(classify({ status: 206, contentType: "image/jpeg" }).state === "alive", "206 image/jpeg -> alive");
  ok(classify({ status: 200, contentType: "video/mp4" }).state === "alive", "200 video/mp4 -> alive");
  ok(classify({ status: 200, contentType: "text/html; charset=utf-8" }).state === "dead", "200 text/html (SPA shell masquerade) -> dead");
  ok(classify({ status: 200, contentType: "application/json" }).state === "dead", "200 json error body -> dead");
  ok(classify({ status: 404, contentType: "application/json" }).state === "dead", "404 -> dead");
  ok(classify({ status: 403, contentType: "text/plain" }).state === "dead", "403 forbidden -> dead");
  ok(classify({ status: 503, contentType: "text/plain" }).state === "unresolved", "503 -> unresolved (transient)");
  ok(classify({ networkError: "fetch failed" }).state === "unresolved", "network error -> unresolved");
  ok(classify({ status: 200, contentType: "" }).state === "dead", "200 with no content-type -> dead (not a media asset)");

  // 2. JSON-LD asset extraction (pure) — same-origin filter + asset-key scoping.
  const siteT = "https://galaxyfinancial.org/";
  const htmlOK = `
    <script type="application/ld+json">${JSON.stringify({
      "@type": "Organization", name: "Galaxy Financial",
      url: "https://galaxyfinancial.org", logo: "https://galaxyfinancial.org/pwa-512x512.png",
      sameAs: ["https://instagram.com/sell4daddy"],
    })}</script>
    <script type="application/ld+json">${JSON.stringify({
      "@type": "VideoObject", name: "Why Producers Build With Galaxy",
      embedUrl: "https://galaxyfinancial.org/vsl",
      contentUrl: "https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/x.mp4",
      thumbnailUrl: "https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/x.jpg",
    })}</script>`;
  const ex = extractJsonLdAssets(htmlOK, siteT);
  const urls = ex.assets.map((a) => a.url);
  ok(urls.includes("https://galaxyfinancial.org/pwa-512x512.png"), "extract: same-origin Organization logo collected");
  ok(ex.assets.find((a) => a.key === "logo") != null, "extract: logo key recorded");
  ok(!urls.some((u) => u.includes("supabase.co")), "extract: cross-origin supabase VideoObject media EXCLUDED (owned by vsl-media-live)");
  ok(!urls.some((u) => u.endsWith("/vsl")), "extract: embedUrl page (not an asset key) EXCLUDED");
  ok(!urls.some((u) => u === "https://galaxyfinancial.org" || u === "https://galaxyfinancial.org/"), "extract: Organization url (page) EXCLUDED");
  ok(extractJsonLdAssets("<html>no json-ld here</html>", siteT).assets.length === 0, "extract: no JSON-LD -> empty asset set");
  // relative asset URL resolves against the site origin and counts same-origin
  const rel = extractJsonLdAssets(`<script type="application/ld+json">${JSON.stringify({ "@type": "Organization", logo: "/pwa-512x512.png" })}</script>`, siteT);
  ok(rel.assets.length === 1 && rel.assets[0].url === "https://galaxyfinancial.org/pwa-512x512.png", "extract: relative logo resolves to same-origin absolute URL");

  // 3. End-to-end probeObject against a local server (faithful fetch pipeline).
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/live.png") { res.writeHead(206, { "content-type": "image/png" }); res.end("A"); return; }
    if (path === "/shell") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<!doctype html><html>…SPA shell…</html>"); return; }
    if (path === "/missing") { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "not_found" })); return; }
    if (path === "/infra") { res.writeHead(500, { "content-type": "text/plain" }); res.end("upstream error"); return; }
    if (path === "/ctl") { res.writeHead(204); res.end(); return; }
    if (path === "/index-ok") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "Organization", logo: `http://127.0.0.1:${port}/live.png` })}</script></head></html>`);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" }); res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  ok((await probeObject(`${origin}/live.png`)).state === "alive", "e2e probe live.png -> alive");
  ok((await probeObject(`${origin}/shell`)).state === "dead", "e2e probe 200-text/html SPA shell -> dead");
  ok((await probeObject(`${origin}/missing`)).state === "dead", "e2e probe 404 -> dead");
  ok((await probeObject(`${origin}/infra`)).state === "unresolved", "e2e probe 500 -> unresolved");

  // 3b. fetchIndexHtml both directions + end-to-end discovery from a live server.
  const idx = await fetchIndexHtml(`${origin}/index-ok`);
  ok(idx.html != null, "fetchIndexHtml: 200 text/html -> html body returned");
  const liveAssets = idx.html ? extractJsonLdAssets(idx.html, `${origin}/`) : { assets: [] };
  ok(liveAssets.assets.length === 1 && liveAssets.assets[0].url === `${origin}/live.png`, "e2e: discover logo asset from served index.html");
  const idxShell = await fetchIndexHtml(`${origin}/missing`);
  ok(idxShell.html == null && idxShell.badStatus === true, "fetchIndexHtml: non-HTML/404 -> badStatus (no html, not trusted)");

  // 4. Control reachability, both directions (prove the UNKNOWN gate is real).
  const ctlUp = await controlReachable(`${origin}/ctl`);
  ok(ctlUp === true, "control /ctl reachable -> true");
  await new Promise((r) => server.close(r));
  const ctlDown = await controlReachable(`http://127.0.0.1:${port}/ctl`); // server now closed
  ok(ctlDown === false, "control unreachable after close -> false");
  const idxNet = await fetchIndexHtml(`http://127.0.0.1:${port}/index-ok`); // server now closed
  ok(idxNet.networkError != null, "fetchIndexHtml: transport failure -> networkError (transient, never 'logo gone')");

  // 5. decideVerdict: the control gate is load-bearing.
  const deadRes = [{ state: "dead" }];
  ok(decideVerdict(deadRes, true).verdict === "DEFECT" && decideVerdict(deadRes, true).code === 1, "dead + control up -> DEFECT(1)");
  ok(decideVerdict(deadRes, false).verdict === "UNKNOWN" && decideVerdict(deadRes, false).code === 0, "dead + control DOWN -> UNKNOWN(0), not trusted");
  ok(decideVerdict([{ state: "unresolved" }], true).verdict === "UNRESOLVED", "unresolved + control up -> UNRESOLVED(3)");
  ok(decideVerdict([{ state: "unresolved" }], true).code === 3, "unresolved -> exit 3");
  ok(decideVerdict([{ state: "alive" }], true).verdict === "CLEAN", "alive -> CLEAN(0)");

  console.log(`\nselftest: ${pass}/${total}`);
  if (pass !== total) { console.error("SELFTEST FAILED — the JSON-LD asset alive/dead detector or the extractor is wrong."); process.exit(1); }
  console.log("✅ selftest: classifier + same-origin JSON-LD asset extraction + fetch/discovery + control-gating all correct, both directions.");
  process.exit(0);
}

// ---- live run --------------------------------------------------------------
async function main() {
  const idxUrl = SITE; // the served index.html is the site root
  const idx = await fetchIndexHtml(idxUrl);

  // Could-not-look is never a pass: a transport failure or a non-HTML/non-2xx
  // response on the index itself is transient infra, NOT a positive "logo gone"
  // signal. UNRESOLVED, re-run clears it.
  if (idx.networkError) {
    console.error(`\n⚠️  jsonld-asset UNRESOLVED — could not fetch ${idxUrl} (network error: ${idx.networkError}). NOT a defect; re-run to confirm.`);
    process.exit(3);
  }
  if (idx.badStatus) {
    console.error(`\n⚠️  jsonld-asset UNRESOLVED — ${idxUrl} returned ${idx.status} ${idx.contentType || "(no type)"}, not 2xx text/html. Transient edge/infra; NOT a defect; re-run to confirm.`);
    process.exit(3);
  }

  const { blocks, parsed, assets } = extractJsonLdAssets(idx.html, SITE);

  // The object set is derived from the LIVE structured data. An empty set is a
  // DEFECT, not a silent CLEAN: the Organization logo (and every same-origin
  // JSON-LD asset) vanished from the structured data Google/AI-search read — the
  // guard exists so that can never pass by "watching nothing". Gated on the
  // egress control exactly like a dead asset, so a parse blip on a truncated
  // response is never trusted as a regression.
  if (assets.length === 0) {
    const controlUp = await controlReachable(CONTROL);
    if (!controlUp) {
      console.log(`\njsonld-asset UNKNOWN — served index.html carries no same-origin JSON-LD asset refs BUT egress control is down; not trusted (runner/network offline, not a real regression). blocks=${blocks} parsed=${parsed}`);
      process.exit(0);
    }
    console.error(`\nJSON-LD ASSET DEFECT — the served index.html structured data references NO same-origin media asset (blocks=${blocks} parsed=${parsed}). The Organization \`logo\` that Google Knowledge Panel + AI-search entity cards render for the brand is gone from the structured data. Every entity card now renders with no brand image.`);
    console.error(`Fix: restore the Organization \`logo\` (schema.org) in index.html's JSON-LD pointing at a live same-origin image (e.g. /pwa-512x512.png) and redeploy.`);
    process.exit(1);
  }

  const results = [];
  for (const a of assets) {
    const r = await probeObject(a.url);
    r.label = labelFor(a.key, a.url);
    results.push(r);
  }

  const anyDead = results.some((r) => r.state === "dead");
  const controlUp = anyDead ? await controlReachable(CONTROL) : true;
  const { verdict, code, downgradeDead } = decideVerdict(results, controlUp);
  if (downgradeDead) {
    for (const r of results) if (r.state === "dead") { r.state = "unresolved"; r.reason = "dead signature BUT egress control unreachable — not trusted: " + r.reason; }
  }

  const out = { verdict, site: SITE, jsonld_blocks: blocks, control: anyDead ? (controlUp ? "up" : "down") : "not-probed", objects: results };
  console.log(JSON.stringify(out, null, 2));

  if (verdict === "DEFECT") {
    console.error("\nJSON-LD ASSET DEFECT — a media asset the live structured data (Google rich results / Knowledge Panel / AI-search) references is DEAD:");
    for (const r of results.filter((r) => r.state === "dead")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    console.error("\nFix: restore the referenced file to the live deploy (a root static like public/pwa-512x512.png), or repoint the JSON-LD to a live same-origin asset, and redeploy.");
    process.exit(1);
  }
  if (verdict === "UNRESOLVED") {
    console.error("\n⚠️  jsonld-asset UNRESOLVED — neither proved alive nor dead (transient 5xx/timeout). NOT a defect; re-run to confirm.");
    for (const r of results.filter((r) => r.state === "unresolved")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    process.exit(3);
  }
  if (verdict === "UNKNOWN") {
    console.log("\njsonld-asset UNKNOWN — egress control down; object verdicts not trusted (runner/network offline, not a dead asset).");
    process.exit(0);
  }
  console.log(`\n✅ jsonld-asset CLEAN — every same-origin asset the live structured data references serves live: ` +
    results.map((r) => `${r.url.replace(/^https?:\/\//, "").split("/").pop()} (${r.status} ${r.contentType})`).join(", "));
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();
else main();
