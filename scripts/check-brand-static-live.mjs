#!/usr/bin/env node
// check-brand-static-live.mjs — prove the funnel's icon + PWA-manifest chain is
// still ALIVE on the live edge. Owned by the Website Integrity Bot.
//
// WHY THIS EXISTS. Every served index.html on apex-financial.org declares a set
// of fixed-name root statics the browser loads to paint the site's identity:
//   <link rel="icon" href="/favicon.ico">           (browser tab + bookmarks)
//   <link rel="apple-touch-icon" href="/apple-touch-icon.png">  (iOS home screen)
//   <link rel="manifest" href="/manifest.webmanifest">          (PWA install)
//   ...and the manifest itself references /pwa-192x192.png + /pwa-512x512.png
//   (the installed-app icon on Android/Chrome).
// All of these are fixed, human-/crawler-shareable URLs that live OUTSIDE Vite's
// content-hashed build (public/ -> dist root, verbatim). A deploy that drops one
// — a public/ copy failure, a rename in vite.config.ts that ships the reference
// but not the file, a manifest re-render that bumps an icon filename without
// shipping the new PNG — kills that surface for every visitor, silently.
//
// THE SILENT FAILURE IS THE 465-INSURACLOUD MASQUERADE, PROVEN ON THIS SITE.
// vercel.json's catch-all rewrite /((?!api/|assets/|fonts/|img/).*) -> index.html
// exempts only /api, /assets, /fonts, /img. A root file like /manifest.webmanifest
// or /favicon.ico is NOT exempt, so if it is missing from a deploy the request
// falls through to the SPA shell and the edge answers 200 text/html — the HTML of
// the homepage, not an icon or a manifest. Measured 2026-11-12 on this exact
// origin: GET /this-does-not-exist.png -> 200 text/html. So the live URL "200s"
// while the browser tab shows a blank/generic icon, the iOS add-to-home-screen
// icon is broken, and /manifest.webmanifest returns un-parseable HTML that the
// browser rejects with a "Manifest: Line 1, column 1, Unexpected token <" error
// — breaking the PWA install name, icon and theme. A status check alone reads
// that 200 as success; this guard does not.
//
// EVERY EXISTING GUARD IS BLIND TO THIS:
//   - check-manifest-brand (commit gate) proves the manifest NAME is on-brand
//     (reads vite.config.ts + src/config/brand.ts AT SOURCE); it makes zero HTTP
//     requests, so the served file can vanish while it stays green. Same
//     source/live split that check-share-card had before check-share-card-live
//     and check-vsl-sync had before check-vsl-media-live.
//   - route-smoke proves the HTML shell 200s — which is EXACTLY the masquerade
//     response a missing root static returns, so it can never catch this.
//   - the asset-graph guard resolves hashed JS/CSS build chunks; these icons and
//     the manifest are fixed-name statics, not hashed build assets, so they
//     escape it.
//   - check-share-card-live probes the og:image only; the favicon / apple-touch
//     / manifest / pwa-icon chain is a different set of files, unwatched.
//
// WHY STATUS ALONE IS NOT ENOUGH. A live icon must POSITIVELY serve 200/206 AND
// an image/* content-type. A live manifest must serve 200 AND parse as JSON with
// a `name` and an `icons` array. A 2xx carrying text/html (the SPA shell) is a
// soft-success masquerade and reads DEAD, never alive. That positive body/type
// signature is the whole point.
//
// WHY THE CHAIN IS DERIVED LIVE, NEVER HARDCODED. The probe set is read from the
// live served index.html <head> (the rel=icon / apple-touch-icon / manifest
// hrefs) joined to the manifest's OWN icons[].src — the exact discovery chain a
// real browser walks. A rename in vite.config.ts that re-points index.html and
// the manifest is therefore probed at its NEW url automatically, and the guard
// can never go stale against a URL the site no longer serves. (Same philosophy
// as check-crawl-entrypoints-live following robots.txt's own Sitemap: directive,
// and check-share-card-live deriving from the render manifest.)
//
// WHY IT CAN'T CRY WOLF (exit contract shared with check-share-card-live.mjs,
// check-vsl-media-live.mjs and live-render-integrity.mjs so a cron wrapper /
// apex-doctor grades it alike):
//   - a positive dead signature (2xx wrong-family / un-parseable manifest, or
//     4xx) with egress proven up is a DEFECT (exit 1): the surface is dead for
//     real visitors.
//   - a 5xx / timeout / connection error — including the index.html fetch that
//     seeds the chain — is transient infra -> UNRESOLVED (exit 3), never a
//     DEFECT. Re-run clears it. A chain that never loaded can never go red.
//   - if the egress control (generate_204) is itself unreachable the verdict is
//     UNKNOWN (exit 0) and no "dead" is trusted — a runner/network blip must
//     never read as a dead asset (MP-291).
//   0 CLEAN | 0 UNKNOWN (network) | 1 DEFECT | 3 UNRESOLVED/partial
//
// Usage:
//   node scripts/check-brand-static-live.mjs
//   node scripts/check-brand-static-live.mjs --selftest   # deterministic, local-only

import http from "node:http";

const SITE = (process.env.BRAND_STATIC_SITE || "https://apex-financial.org/").replace(/\/*$/, "/");
const CONTROL = process.env.BRAND_STATIC_CONTROL_URL || "https://www.google.com/generate_204";
const TIMEOUT_MS = Number(process.env.BRAND_STATIC_TIMEOUT_MS || 25000);

// ---- pure classifier ------------------------------------------------------
// Decide alive / dead / unresolved from a single object probe descriptor.
// `expect` is "image" (icons) or "manifest" (the webmanifest). Pure of network +
// process state so --selftest drives it deterministically.
function classify({ networkError, status, contentType, body, expect }) {
  if (networkError) {
    // connection refused / DNS / timeout: transient, NOT a positive object-gone
    // signal. Never a DEFECT on its own.
    return { state: "unresolved", reason: `network error: ${networkError}` };
  }
  const ct = String(contentType || "").toLowerCase().split(";")[0].trim();
  const served = status === 200 || status === 206;

  if (expect === "manifest") {
    const looksHtml = ct === "text/html" || /^\s*<(?:!doctype|html)/i.test(String(body || ""));
    if (served && !looksHtml) {
      // Must positively parse as a manifest: JSON with a name + icons[]. A 2xx
      // that doesn't parse (truncated / error body) is NOT a live manifest.
      try {
        const m = JSON.parse(String(body || ""));
        if (m && typeof m.name === "string" && m.name && Array.isArray(m.icons) && m.icons.length) {
          return { state: "alive", status, contentType: ct, detail: `name="${m.name}", ${m.icons.length} icon(s)` };
        }
        return {
          state: "dead", status, contentType: ct,
          reason: `served ${status} but the body parses to JSON without a usable name/icons[] — the manifest is malformed; the browser cannot install the PWA`,
        };
      } catch {
        return {
          state: "dead", status, contentType: ct,
          reason: `served ${status} ${ct || "(no type)"} but the body is not valid JSON — the manifest is corrupt and the browser rejects it`,
        };
      }
    }
    if (served && looksHtml) {
      return {
        state: "dead", status, contentType: ct,
        reason: `served ${status} text/html (the SPA shell) in place of the manifest — /manifest.webmanifest is missing from the deploy and the catch-all is serving the homepage HTML; the browser rejects it with "Manifest: Unexpected token <" and the PWA install name/icon/theme break`,
      };
    }
    if (status >= 400 && status < 500) {
      return { state: "dead", status, contentType: ct, reason: `HTTP ${status} — the manifest is missing, moved, or forbidden` };
    }
    return { state: "unresolved", status, contentType: ct, reason: `HTTP ${status || 0} — transient edge/infra response, not a positive object-gone signal` };
  }

  // expect === "image" (favicon / apple-touch / pwa icons)
  if (served && ct.startsWith("image/")) {
    return { state: "alive", status, contentType: ct };
  }
  if (served) {
    // 2xx but NOT an image. A missing root icon falls through to the catch-all
    // and returns 200 text/html (the homepage shell), or an error body — a
    // soft-success masquerade reads DEAD.
    return {
      state: "dead", status, contentType: ct,
      reason: `served ${status} but content-type is "${ct || "(none)"}", not image/* — the icon file is missing from the deploy and the SPA catch-all is serving the HTML shell in its place; the browser tab / home-screen icon is blank or generic`,
    };
  }
  if (status >= 400 && status < 500) {
    return { state: "dead", status, contentType: ct, reason: `HTTP ${status} — the icon is missing, moved, or forbidden (dropped from deploy / renamed without shipping the new file)` };
  }
  return { state: "unresolved", status, contentType: ct, reason: `HTTP ${status || 0} — transient edge/infra response, not a positive object-gone signal` };
}

// ---- parse the live <head> for the icon + manifest chain --------------------
// Pure string parsing so --selftest exercises it against a fixture.
function parseHeadChain(html, site) {
  const head = (String(html).split(/<\/head>/i)[0] || String(html));
  const abs = (href) => {
    if (/^https?:\/\//i.test(href)) return href;
    return site.replace(/\/+$/, "") + "/" + String(href).replace(/^\/+/, "");
  };
  const icons = new Set();
  let manifest = null;
  const linkRe = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkRe.exec(head))) {
    const tag = m[0];
    const rel = (tag.match(/\brel\s*=\s*"([^"]*)"/i) || tag.match(/\brel\s*=\s*'([^']*)'/i) || [])[1] || "";
    const href = (tag.match(/\bhref\s*=\s*"([^"]*)"/i) || tag.match(/\bhref\s*=\s*'([^']*)'/i) || [])[1] || "";
    if (!href) continue;
    const r = rel.toLowerCase();
    if (/\bmanifest\b/.test(r)) manifest = abs(href);
    else if (/\bicon\b/.test(r) || /\bapple-touch-icon\b/.test(r)) icons.add(abs(href));
  }
  return { icons: [...icons], manifest };
}

// Pull the manifest's own icon srcs (absolute) from its parsed JSON.
function manifestIconUrls(manifestJson, manifestUrl, site) {
  const out = new Set();
  let m;
  try { m = JSON.parse(String(manifestJson)); } catch { return []; }
  if (!m || !Array.isArray(m.icons)) return [];
  for (const ic of m.icons) {
    const src = ic && ic.src;
    if (!src) continue;
    if (/^https?:\/\//i.test(src)) out.add(src);
    else out.add(site.replace(/\/+$/, "") + "/" + String(src).replace(/^\/+/, ""));
  }
  return [...out];
}

// ---- probes ---------------------------------------------------------------
// Text GET (full body) — for index.html seed + the manifest body.
async function fetchText(url) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
      const body = await r.text().catch(() => "");
      return { url, status: r.status, contentType: r.headers.get("content-type"), body };
    } catch (e) {
      last = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160);
    }
  }
  return { url, networkError: last || "unknown" };
}

// Object probe. Images: ranged GET (bytes=0-0) — prove served without pulling
// the full PNG. Manifest: full GET so the body can be parsed.
async function probeObject(url, expect) {
  if (expect === "manifest") {
    const r = await fetchText(url);
    if (r.networkError) return { url, expect, ...classify({ networkError: r.networkError, expect }) };
    return { url, expect, ...classify({ status: r.status, contentType: r.contentType, body: r.body, expect }) };
  }
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
      await r.arrayBuffer().catch(() => {});
      return { url, expect, ...classify({ status: r.status, contentType: r.headers.get("content-type"), expect }) };
    } catch (e) {
      last = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160);
    }
  }
  return { url, expect, ...classify({ networkError: last || "unknown", expect }) };
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

// ---- derive the live chain -------------------------------------------------
// Returns { objects:[{url,expect,label}], seedError } — seedError set when the
// index.html seed could not be loaded (-> UNRESOLVED, never a dead-icon claim).
async function deriveChain() {
  const idx = await fetchText(SITE);
  if (idx.networkError) return { objects: [], seedError: `index.html seed unreachable: ${idx.networkError}` };
  if (!(idx.status === 200 || idx.status === 206)) return { objects: [], seedError: `index.html seed returned HTTP ${idx.status} — cannot derive the icon/manifest chain` };
  const { icons, manifest } = parseHeadChain(idx.body, SITE);
  // A real served head always carries at least a favicon + a manifest link. If
  // we found neither, the shell shape changed under us — do NOT assert dead.
  if (!icons.length && !manifest) return { objects: [], seedError: `index.html served 200 but exposed no <link rel=icon|manifest> — head shape unexpected; refusing to assert any static dead` };

  const objects = [];
  for (const u of icons) objects.push({ url: u, expect: "image", label: `head icon (${u.split("/").pop()})` });
  if (manifest) {
    objects.push({ url: manifest, expect: "manifest", label: `PWA manifest (${manifest.split("/").pop()})` });
    // follow the manifest's own icon list (the installed-app icons)
    const mres = await fetchText(manifest);
    if (!mres.networkError && (mres.status === 200 || mres.status === 206)) {
      for (const mu of manifestIconUrls(mres.body, manifest, SITE)) {
        if (!objects.some((o) => o.url === mu)) objects.push({ url: mu, expect: "image", label: `manifest icon (${mu.split("/").pop()})` });
      }
    }
  }
  return { objects, seedError: null };
}

// ---- selftest: deterministic, local-only -----------------------------------
async function selftest() {
  let pass = 0, total = 0;
  const ok = (cond, msg) => { total++; if (cond) { pass++; console.log(`✓ ${msg}`); } else { console.log(`✗ ${msg}`); } };

  // 1. Pure classifier — images, both directions, SPA-shell masquerade is THE case.
  ok(classify({ status: 200, contentType: "image/png", expect: "image" }).state === "alive", "img 200 image/png -> alive");
  ok(classify({ status: 206, contentType: "image/vnd.microsoft.icon", expect: "image" }).state === "alive", "img 206 favicon type -> alive");
  ok(classify({ status: 200, contentType: "text/html; charset=utf-8", expect: "image" }).state === "dead", "img 200 text/html (SPA shell) -> dead");
  ok(classify({ status: 200, contentType: "", expect: "image" }).state === "dead", "img 200 no content-type -> dead");
  ok(classify({ status: 404, contentType: "application/json", expect: "image" }).state === "dead", "img 404 -> dead");
  ok(classify({ status: 503, contentType: "text/plain", expect: "image" }).state === "unresolved", "img 503 -> unresolved");
  ok(classify({ networkError: "fetch failed", expect: "image" }).state === "unresolved", "img network error -> unresolved");

  // 1b. Pure classifier — manifest, positive JSON signature required.
  const goodM = JSON.stringify({ name: "Galaxy Financial OS", icons: [{ src: "/pwa-192x192.png" }] });
  ok(classify({ status: 200, contentType: "application/manifest+json", body: goodM, expect: "manifest" }).state === "alive", "manifest 200 parseable name+icons -> alive");
  ok(classify({ status: 200, contentType: "application/json", body: goodM, expect: "manifest" }).state === "alive", "manifest 200 application/json parseable -> alive");
  ok(classify({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><html></html>", expect: "manifest" }).state === "dead", "manifest 200 text/html shell -> dead");
  ok(classify({ status: 200, contentType: "application/manifest+json", body: "<!doctype html>", expect: "manifest" }).state === "dead", "manifest 200 but html-ish body -> dead (sniffed)");
  ok(classify({ status: 200, contentType: "application/manifest+json", body: "{not json", expect: "manifest" }).state === "dead", "manifest 200 un-parseable -> dead");
  ok(classify({ status: 200, contentType: "application/manifest+json", body: JSON.stringify({ icons: [] }), expect: "manifest" }).state === "dead", "manifest 200 no name/empty icons -> dead");
  ok(classify({ status: 404, contentType: "text/html", expect: "manifest" }).state === "dead", "manifest 404 -> dead");
  ok(classify({ status: 500, contentType: "text/plain", expect: "manifest" }).state === "unresolved", "manifest 500 -> unresolved");

  // 2. Head-chain parser — derives icons + manifest from a served <head>.
  const headHtml = `<!doctype html><html><head>
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/pwa-192x192.png" />
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="stylesheet" href="/assets/app.css">
  </head><body></body></html>`;
  const chain = parseHeadChain(headHtml, "https://x.test/");
  ok(chain.manifest === "https://x.test/manifest.webmanifest", "head parse -> manifest url");
  ok(chain.icons.includes("https://x.test/favicon.ico") && chain.icons.includes("https://x.test/apple-touch-icon.png") && chain.icons.includes("https://x.test/pwa-192x192.png"), "head parse -> 3 icon urls");
  ok(!chain.icons.some((u) => u.endsWith("app.css")), "head parse ignores non-icon links");
  const micons = manifestIconUrls(goodM, "https://x.test/manifest.webmanifest", "https://x.test/");
  ok(micons.includes("https://x.test/pwa-192x192.png"), "manifest icon parse -> absolute url");

  // 3. End-to-end probeObject against a local server (faithful fetch pipeline).
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/favicon.ico") { res.writeHead(206, { "content-type": "image/x-icon" }); res.end("A"); return; }
    if (path === "/manifest.webmanifest") { res.writeHead(200, { "content-type": "application/manifest+json" }); res.end(goodM); return; }
    if (path === "/manifest-shell") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<!doctype html><html>shell</html>"); return; }
    if (path === "/icon-shell.png") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<!doctype html><html>shell</html>"); return; }
    if (path === "/missing.png") { res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":"nf"}'); return; }
    if (path === "/infra.png") { res.writeHead(500, { "content-type": "text/plain" }); res.end("err"); return; }
    if (path === "/ctl") { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { "content-type": "application/json" }); res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  ok((await probeObject(`${origin}/favicon.ico`, "image")).state === "alive", "e2e icon favicon -> alive");
  ok((await probeObject(`${origin}/manifest.webmanifest`, "manifest")).state === "alive", "e2e manifest parseable -> alive");
  ok((await probeObject(`${origin}/manifest-shell`, "manifest")).state === "dead", "e2e manifest SPA-shell -> dead");
  ok((await probeObject(`${origin}/icon-shell.png`, "image")).state === "dead", "e2e icon SPA-shell -> dead");
  ok((await probeObject(`${origin}/missing.png`, "image")).state === "dead", "e2e icon 404 -> dead");
  ok((await probeObject(`${origin}/infra.png`, "image")).state === "unresolved", "e2e icon 500 -> unresolved");

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
  if (pass !== total) { console.error("SELFTEST FAILED — the brand-static alive/dead detector is wrong."); process.exit(1); }
  console.log("✅ selftest: image + manifest alive/dead/unresolved + SPA-shell masquerade + head-chain derivation + control-gating all classified correctly, both directions.");
  process.exit(0);
}

// ---- live run --------------------------------------------------------------
async function main() {
  const { objects, seedError } = await deriveChain();
  if (seedError) {
    console.log(JSON.stringify({ verdict: "UNRESOLVED", reason: seedError }, null, 2));
    console.error(`\n⚠️  brand-static UNRESOLVED — ${seedError}. NOT a defect; re-run to confirm.`);
    process.exit(3);
  }

  const results = [];
  for (const o of objects) {
    const r = await probeObject(o.url, o.expect);
    r.label = o.label;
    results.push(r);
  }

  const anyDead = results.some((r) => r.state === "dead");
  const controlUp = anyDead ? await controlReachable(CONTROL) : true;
  const { verdict, code, downgradeDead } = decideVerdict(results, controlUp);
  if (downgradeDead) {
    for (const r of results) if (r.state === "dead") { r.state = "unresolved"; r.reason = "dead signature BUT egress control unreachable — not trusted: " + r.reason; }
  }

  const out = { verdict, control: anyDead ? (controlUp ? "up" : "down") : "not-probed", objects: results.map((r) => ({ url: r.url, expect: r.expect, state: r.state, status: r.status, contentType: r.contentType, detail: r.detail, reason: r.reason })) };
  console.log(JSON.stringify(out, null, 2));

  if (verdict === "DEFECT") {
    console.error("\nBRAND-STATIC DEFECT — a funnel icon or the PWA manifest is DEAD on the live edge. The browser tab icon, iOS home-screen icon, or Android/Chrome install is broken for every visitor:");
    for (const r of results.filter((r) => r.state === "dead")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    console.error("\nFix: restore the missing public/ static(s) (favicon.ico / apple-touch-icon.png / manifest.webmanifest / pwa-*.png) and redeploy. If the manifest is generated, verify the vite-plugin-pwa `manifest` block in vite.config.ts ships the referenced icon files.");
    process.exit(1);
  }
  if (verdict === "UNRESOLVED") {
    console.error("\n⚠️  brand-static UNRESOLVED — a surface was neither proved alive nor dead (transient 5xx/timeout). NOT a defect; re-run to confirm.");
    for (const r of results.filter((r) => r.state === "unresolved")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    process.exit(3);
  }
  if (verdict === "UNKNOWN") {
    console.log("\nbrand-static UNKNOWN — egress control down; object verdicts not trusted (runner/network offline, not a dead asset).");
    process.exit(0);
  }
  console.log(`\n✅ brand-static CLEAN — ${results.length} surface(s) serve live: ` +
    results.map((r) => `${r.url.split("/").pop()} (${r.status} ${r.contentType})`).join(", "));
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();
else main();
