#!/usr/bin/env node
// check-font-preload-live.mjs — prove the SAME-ORIGIN brand font(s) the live
// served <head> PRELOADS are still ALIVE on the live edge. Owned by the Website
// Integrity Bot.
//
// WHY THIS EXISTS (MP-WIB-FONT-PRELOAD-LIVE, 2026-11-17). The served index.html
// head carries `<link rel="preload" as="font" href="/fonts/hanken-grotesk.woff2"
// crossorigin>` — the brand typeface, fetched at render-blocking priority so the
// first paint is in the Brand-Bible-locked face, not a system fallback. The woff2
// is a fixed-name static under /fonts/ (OUTSIDE Vite's content-hashed build), so a
// deploy that drops it, a rename that ships the <link> but not the renamed file,
// or a fonts/ path repoint kills the typeface for EVERY page at once. The browser
// then silently swaps to the system sans-serif: no error, no console warning, a
// 200 shell — and the whole site renders in the wrong font. Typography is a locked
// brand element (Brand Bible Ch 6; a drift is a 🔴), and a sitewide font fallback
// is the most visible brand break there is, yet it is invisible to any check that
// only watches the HTML shell's status code.
//
// THE BLIND SPOT THIS CLOSES. The preloaded font was asserted live by NOTHING:
//   - check-brand-static-live parses the head's <link rel=icon / apple-touch-icon
//     / manifest> and probes the favicon / apple-touch / pwa-icon chain + manifest
//     icons. It does NOT parse rel=preload / as=font — the font link is a different
//     rel it never reads, so the typeface is unwatched (check-brand-static-live.mjs
//     head parser only adds `icon`/`apple-touch-icon` hrefs + the manifest).
//   - check-jsonld-asset-live probes same-origin JSON-LD media (the logo). A font
//     is not a JSON-LD asset — different surface, different head tag.
//   - check-landing-css-size / the asset-graph modulepreload guards watch the
//     hashed JS/CSS bundle; the preloaded font is neither, it is a head-declared
//     root static. No guard covered it.
// Same source/live split check-share-card-live closed for the og:image,
// check-brand-static-live for the icon chain, and check-jsonld-asset-live for the
// structured-data logo — the preloaded brand FONT is the one render-critical head
// asset with no from-head liveness guard. This is that guard.
//
// THE SILENT FAILURE IS THE 465-INSURACLOUD MASQUERADE. vercel.json's catch-all
// rewrite `/((?!api/|assets/|fonts/|img/).*) -> index.html` EXEMPTS /fonts/, so a
// missing font today returns a REAL 404 text/plain (measured on prod 2026-11-17),
// not the 200-text/html SPA shell. But the exemption is one config line: drop
// `fonts/` from that negative-lookahead and a missing font falls through to the
// shell and 200s text/html — the exact masquerade proven on this origin for root
// statics. A live font must therefore POSITIVELY serve 200/206 AND a FONT
// content-type (font/woff2, font/woff, …, or a generic binary octet-stream). A
// 2xx carrying text/html (the SPA shell) or application/json (an error body) reads
// DEAD. That content-type discriminator survives a future fonts/ un-exemption.
//
// WHY IT CAN'T WATCH NOTHING. The font set is DERIVED from the LIVE served head's
// preload links, not a local file, so a regression that drops the `rel=preload
// as=font` link entirely leaves the set empty. An empty set on a 2xx HTML response
// (egress proven up) is itself a DEFECT — "the brand font is no longer preloaded",
// a first-paint-in-fallback-font regression for a locked-typography brand — never a
// silent CLEAN. A guard that passes by finding nothing is the disease it catches.
//
// SCOPE. LIVENESS only: does the preloaded font URL serve the font. Preload
// correctness (a `crossorigin` attribute must accompany an as=font preload or the
// browser double-fetches) is a separate performance concern, deliberately out of
// scope here so this never false-DEFECTs on a benign attribute change. @font-face
// fonts referenced only from the hashed CSS bundle are out of scope too (they ride
// the bundle-integrity guards); this watches the head-declared render-critical set.
//
// WHY IT CAN'T CRY WOLF (exit contract shared with check-jsonld-asset-live.mjs /
// check-share-card-live.mjs / check-vsl-media-live.mjs so the cron wrapper /
// notify-guard-failure / apex-doctor grade it alike):
//   - a positive dead signature (2xx wrong-family, or 4xx) with egress proven up
//     is a DEFECT (exit 1): the font is dead for real browsers.
//   - a 5xx / timeout / connection error (on the index fetch OR a font probe) is
//     transient infra -> UNRESOLVED (exit 3), never a DEFECT. Re-run clears it.
//   - if the egress control (generate_204) is itself unreachable the verdict is
//     UNKNOWN (exit 0) and no "dead" is trusted — a runner/network blip must never
//     read as a dead font (MP-291).
//   0 CLEAN | 0 UNKNOWN (network) | 1 DEFECT | 3 UNRESOLVED/partial
//
// Usage:
//   node scripts/check-font-preload-live.mjs
//   node scripts/check-font-preload-live.mjs --selftest   # deterministic, local-only

import http from "node:http";

const SITE = (process.env.FONT_PRELOAD_SITE || "https://apex-financial.org/").replace(/\/*$/, "/");
const CONTROL = process.env.FONT_PRELOAD_CONTROL_URL || "https://www.google.com/generate_204";
const TIMEOUT_MS = Number(process.env.FONT_PRELOAD_TIMEOUT_MS || 25000);

// ---- font content-type recogniser -----------------------------------------
// A live font serves one of these families. octet-stream / binary octet-stream
// are accepted because some edges type fonts generically — that is NOT the
// masquerade we defend against (the masquerade is text/html, the SPA shell, or
// application/json, an error body). Strict against the known failure, lenient on
// benign MIME variance so a correctly-served font never pages Sam.
const FONT_CTS = new Set([
  "font/woff2", "font/woff", "font/ttf", "font/otf", "font/sfnt", "font/collection",
  "application/font-woff", "application/font-woff2",
  "application/x-font-woff", "application/x-font-ttf", "application/x-font-otf",
  "application/x-font-opentype", "application/x-font-truetype",
  "application/vnd.ms-fontobject",
  "application/octet-stream", "binary/octet-stream",
]);
function isFontCt(ct) {
  const c = String(ct || "").toLowerCase().split(";")[0].trim();
  return c.startsWith("font/") || FONT_CTS.has(c);
}

// ---- pure classifier ------------------------------------------------------
// Decide alive / dead / unresolved from a single probe descriptor. Pure of
// network + process state so --selftest drives it deterministically.
function classify({ networkError, status, contentType }) {
  if (networkError) {
    // connection refused / DNS / timeout: transient, NOT a positive font-gone
    // signal. Never a DEFECT on its own.
    return { state: "unresolved", reason: `network error: ${networkError}` };
  }
  const ct = String(contentType || "").toLowerCase().split(";")[0].trim();
  const served = status === 200 || status === 206;
  if (served && isFontCt(ct)) {
    return { state: "alive", status, contentType: ct };
  }
  if (served) {
    // 2xx but NOT a font. If /fonts/ is ever dropped from vercel.json's catch-all
    // exemption a missing font falls through to the SPA shell (200 text/html); an
    // edge/proxy error body is application/json. Either way the URL is not serving
    // the typeface the browser preloads — a soft-success masquerade reads DEAD.
    return {
      state: "dead", status, contentType: ct,
      reason: `served ${status} but content-type is "${ct || "(none)"}", not a font/* family — the preloaded font is missing from the deploy and the SPA catch-all is serving the HTML shell (or an error body) in its place; every page renders in the system fallback font`,
    };
  }
  if (status >= 400 && status < 500) {
    return {
      state: "dead", status, contentType: ct,
      reason: `HTTP ${status} — the preloaded brand font is missing, moved, or forbidden (dropped from deploy / renamed without shipping the new file); every page first-paints in the system fallback font`,
    };
  }
  // 5xx or any other non-2xx: transient edge/infra, not a deleted object.
  return {
    state: "unresolved", status, contentType: ct,
    reason: `HTTP ${status || 0} — transient edge/infra response, not a positive font-gone signal`,
  };
}

// ---- object probe (ranged GET, one retry on network hiccup) ----------------
async function probeFont(url) {
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
// { html } on a 2xx text/html response, { networkError } on a transport failure,
// or { badStatus, status, contentType } on a non-HTML 2xx / non-2xx response
// (treated as transient/unresolved by the caller, never a positive "font gone").
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

// ---- parse head + collect same-origin preloaded-font URLs (pure) -----------
// Walk every <link> in the <head> and collect href where rel includes `preload`
// AND the tag declares `as="font"`, resolved to a SAME-ORIGIN absolute URL.
// Dedupes. Scopes to the head (where render-critical preloads live) so a
// stray in-body preload does not widen the set.
function extractPreloadFonts(html, site) {
  let siteOrigin;
  try { siteOrigin = new URL(site).origin; } catch { siteOrigin = null; }
  const head = (String(html).split(/<\/head>/i)[0] || String(html));
  const found = new Set();
  const linkRe = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkRe.exec(head)) !== null) {
    const tag = m[0];
    const rel = (tag.match(/\brel\s*=\s*"([^"]*)"/i) || tag.match(/\brel\s*=\s*'([^']*)'/i) || [])[1] || "";
    const asAttr = (tag.match(/\bas\s*=\s*"([^"]*)"/i) || tag.match(/\bas\s*=\s*'([^']*)'/i) || [])[1] || "";
    const href = (tag.match(/\bhref\s*=\s*"([^"]*)"/i) || tag.match(/\bhref\s*=\s*'([^']*)'/i) || [])[1] || "";
    if (!/\bpreload\b/i.test(rel)) continue;
    if (asAttr.toLowerCase() !== "font") continue;
    if (!href) continue;
    let abs = null;
    try { abs = new URL(href, site).href; } catch { continue; }
    let origin = null;
    try { origin = new URL(abs).origin; } catch { continue; }
    if (siteOrigin && origin === siteOrigin) found.add(abs);
  }
  return { fonts: [...found] };
}

function labelFor(url) {
  const file = url.replace(/^https?:\/\//, "").split("/").pop();
  return `preloaded brand font (${file}) — the render-blocking typeface every page first-paints in; a 404 silently falls the whole site back to the system font`;
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
  ok(classify({ status: 200, contentType: "font/woff2" }).state === "alive", "200 font/woff2 -> alive");
  ok(classify({ status: 206, contentType: "font/woff" }).state === "alive", "206 font/woff -> alive");
  ok(classify({ status: 200, contentType: "application/font-woff2" }).state === "alive", "200 application/font-woff2 -> alive");
  ok(classify({ status: 200, contentType: "application/octet-stream" }).state === "alive", "200 octet-stream (generic binary font) -> alive");
  ok(classify({ status: 200, contentType: "font/woff2; charset=utf-8" }).state === "alive", "200 font/woff2 w/ params -> alive");
  ok(classify({ status: 200, contentType: "text/html; charset=utf-8" }).state === "dead", "200 text/html (SPA shell masquerade) -> dead");
  ok(classify({ status: 200, contentType: "application/json" }).state === "dead", "200 json error body -> dead");
  ok(classify({ status: 200, contentType: "text/plain" }).state === "dead", "200 text/plain (not a font) -> dead");
  ok(classify({ status: 200, contentType: "image/png" }).state === "dead", "200 image/png (wrong family) -> dead");
  ok(classify({ status: 404, contentType: "text/plain" }).state === "dead", "404 text/plain (real missing-font 404) -> dead");
  ok(classify({ status: 403, contentType: "text/plain" }).state === "dead", "403 forbidden -> dead");
  ok(classify({ status: 503, contentType: "text/plain" }).state === "unresolved", "503 -> unresolved (transient)");
  ok(classify({ networkError: "fetch failed" }).state === "unresolved", "network error -> unresolved");
  ok(classify({ status: 200, contentType: "" }).state === "dead", "200 with no content-type -> dead (not a font)");

  // 2. Head preload-font extraction (pure) — same-origin + as=font scoping.
  const siteT = "https://apex-financial.org/";
  const htmlOK = `<html><head>
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="preload" as="font" type="font/woff2" href="/fonts/hanken-grotesk.woff2" crossorigin />
    <link rel="preload" as="image" href="/galaxy-recruit-og.jpg" />
    <link rel="stylesheet" href="/assets/app-abc123.css" />
    <link rel="modulepreload" crossorigin href="/assets/vendor-react-xyz.js" />
  </head><body>
    <link rel="preload" as="font" href="/fonts/in-body-should-be-ignored.woff2" crossorigin />
  </body></html>`;
  const ex = extractPreloadFonts(htmlOK, siteT);
  ok(ex.fonts.length === 1 && ex.fonts[0] === "https://apex-financial.org/fonts/hanken-grotesk.woff2", "extract: the one head as=font preload collected (absolute, same-origin)");
  ok(!ex.fonts.some((u) => u.includes("in-body")), "extract: in-BODY preload ignored (head-scoped)");
  ok(!ex.fonts.some((u) => u.endsWith(".jpg")), "extract: as=image preload EXCLUDED (not a font)");
  ok(!ex.fonts.some((u) => u.endsWith(".css") || u.endsWith(".js")), "extract: stylesheet + modulepreload EXCLUDED");
  ok(extractPreloadFonts("<html><head>no preload here</head></html>", siteT).fonts.length === 0, "extract: no preload-font -> empty set");
  // cross-origin preloaded font (e.g. a CDN) is excluded — same-origin only
  const xo = extractPreloadFonts(`<head><link rel="preload" as="font" href="https://fonts.gstatic.com/x.woff2" crossorigin></head>`, siteT);
  ok(xo.fonts.length === 0, "extract: cross-origin preloaded font EXCLUDED (same-origin scope)");
  // rel token order / extra tokens still match
  const relOrder = extractPreloadFonts(`<head><link href="/fonts/a.woff2" as="font" rel="preload" crossorigin></head>`, siteT);
  ok(relOrder.fonts.length === 1 && relOrder.fonts[0].endsWith("/fonts/a.woff2"), "extract: attribute order independent (href/as/rel reordered)");

  // 3. End-to-end probeFont against a local server (faithful fetch pipeline).
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/live.woff2") { res.writeHead(206, { "content-type": "font/woff2" }); res.end("A"); return; }
    if (path === "/shell") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<!doctype html><html>…SPA shell…</html>"); return; }
    if (path === "/missing") { res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found"); return; }
    if (path === "/infra") { res.writeHead(500, { "content-type": "text/plain" }); res.end("upstream error"); return; }
    if (path === "/ctl") { res.writeHead(204); res.end(); return; }
    if (path === "/index-ok") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<html><head><link rel="preload" as="font" href="http://127.0.0.1:${port}/live.woff2" crossorigin></head></html>`);
      return;
    }
    if (path === "/index-nofont") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<html><head><link rel="icon" href="/favicon.ico"></head></html>`);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" }); res.end("nf");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  ok((await probeFont(`${origin}/live.woff2`)).state === "alive", "e2e probe live.woff2 -> alive");
  ok((await probeFont(`${origin}/shell`)).state === "dead", "e2e probe 200-text/html SPA shell -> dead");
  ok((await probeFont(`${origin}/missing`)).state === "dead", "e2e probe 404 -> dead");
  ok((await probeFont(`${origin}/infra`)).state === "unresolved", "e2e probe 500 -> unresolved");

  // 3b. fetchIndexHtml both directions + end-to-end discovery from a live server.
  const idx = await fetchIndexHtml(`${origin}/index-ok`);
  ok(idx.html != null, "fetchIndexHtml: 200 text/html -> html body returned");
  const liveFonts = idx.html ? extractPreloadFonts(idx.html, `${origin}/`) : { fonts: [] };
  ok(liveFonts.fonts.length === 1 && liveFonts.fonts[0] === `${origin}/live.woff2`, "e2e: discover preloaded font from served index.html");
  const idxNoFont = await fetchIndexHtml(`${origin}/index-nofont`);
  const noFontSet = idxNoFont.html ? extractPreloadFonts(idxNoFont.html, `${origin}/`) : { fonts: [] };
  ok(noFontSet.fonts.length === 0, "e2e: served head WITHOUT a font preload -> empty set (would DEFECT, not silent-pass)");
  const idxShell = await fetchIndexHtml(`${origin}/missing`);
  ok(idxShell.html == null && idxShell.badStatus === true, "fetchIndexHtml: non-HTML/404 -> badStatus (no html, not trusted)");

  // 4. Control reachability, both directions (prove the UNKNOWN gate is real).
  const ctlUp = await controlReachable(`${origin}/ctl`);
  ok(ctlUp === true, "control /ctl reachable -> true");
  await new Promise((r) => server.close(r));
  const ctlDown = await controlReachable(`http://127.0.0.1:${port}/ctl`); // server now closed
  ok(ctlDown === false, "control unreachable after close -> false");
  const idxNet = await fetchIndexHtml(`http://127.0.0.1:${port}/index-ok`); // server now closed
  ok(idxNet.networkError != null, "fetchIndexHtml: transport failure -> networkError (transient, never 'font gone')");

  // 5. decideVerdict: the control gate is load-bearing.
  const deadRes = [{ state: "dead" }];
  ok(decideVerdict(deadRes, true).verdict === "DEFECT" && decideVerdict(deadRes, true).code === 1, "dead + control up -> DEFECT(1)");
  ok(decideVerdict(deadRes, false).verdict === "UNKNOWN" && decideVerdict(deadRes, false).code === 0, "dead + control DOWN -> UNKNOWN(0), not trusted");
  ok(decideVerdict([{ state: "unresolved" }], true).verdict === "UNRESOLVED", "unresolved + control up -> UNRESOLVED(3)");
  ok(decideVerdict([{ state: "unresolved" }], true).code === 3, "unresolved -> exit 3");
  ok(decideVerdict([{ state: "alive" }], true).verdict === "CLEAN", "alive -> CLEAN(0)");

  console.log(`\nselftest: ${pass}/${total}`);
  if (pass !== total) { console.error("SELFTEST FAILED — the font alive/dead classifier or the head preload-font extractor is wrong."); process.exit(1); }
  console.log("✅ selftest: classifier + same-origin head preload-font extraction + fetch/discovery + control-gating all correct, both directions.");
  process.exit(0);
}

// ---- live run --------------------------------------------------------------
async function main() {
  const idxUrl = SITE; // the served index.html is the site root
  const idx = await fetchIndexHtml(idxUrl);

  // Could-not-look is never a pass: a transport failure or a non-HTML/non-2xx
  // response on the index itself is transient infra, NOT a positive "font gone"
  // signal. UNRESOLVED, re-run clears it.
  if (idx.networkError) {
    console.error(`\n⚠️  font-preload UNRESOLVED — could not fetch ${idxUrl} (network error: ${idx.networkError}). NOT a defect; re-run to confirm.`);
    process.exit(3);
  }
  if (idx.badStatus) {
    console.error(`\n⚠️  font-preload UNRESOLVED — ${idxUrl} returned ${idx.status} ${idx.contentType || "(no type)"}, not 2xx text/html. Transient edge/infra; NOT a defect; re-run to confirm.`);
    process.exit(3);
  }

  const { fonts } = extractPreloadFonts(idx.html, SITE);

  // The font set is derived from the LIVE served head. An empty set is a DEFECT,
  // not a silent CLEAN: the brand typeface is no longer preloaded, so every page
  // first-paints in the system fallback font — a locked-typography regression. The
  // guard exists so that can never pass by "watching nothing". Gated on the egress
  // control exactly like a dead font, so a parse blip on a truncated response is
  // never trusted as a regression.
  if (fonts.length === 0) {
    const controlUp = await controlReachable(CONTROL);
    if (!controlUp) {
      console.log(`\nfont-preload UNKNOWN — served index.html head carries no same-origin preloaded font BUT egress control is down; not trusted (runner/network offline, not a real regression).`);
      process.exit(0);
    }
    console.error(`\nFONT PRELOAD DEFECT — the served index.html head preloads NO same-origin brand font. The render-blocking typeface the whole site first-paints in has been dropped from the critical path; every page now falls back to the system font until (if ever) a stylesheet @font-face loads.`);
    console.error(`Fix: restore the \`<link rel="preload" as="font" href="/fonts/…​.woff2" crossorigin>\` in index.html's <head> pointing at the live brand woff2 and redeploy.`);
    process.exit(1);
  }

  const results = [];
  for (const url of fonts) {
    const r = await probeFont(url);
    r.label = labelFor(url);
    results.push(r);
  }

  const anyDead = results.some((r) => r.state === "dead");
  const controlUp = anyDead ? await controlReachable(CONTROL) : true;
  const { verdict, code, downgradeDead } = decideVerdict(results, controlUp);
  if (downgradeDead) {
    for (const r of results) if (r.state === "dead") { r.state = "unresolved"; r.reason = "dead signature BUT egress control unreachable — not trusted: " + r.reason; }
  }

  const out = { verdict, site: SITE, control: anyDead ? (controlUp ? "up" : "down") : "not-probed", fonts: results };
  console.log(JSON.stringify(out, null, 2));

  if (verdict === "DEFECT") {
    console.error("\nFONT PRELOAD DEFECT — a brand font the live <head> preloads is DEAD on the edge:");
    for (const r of results.filter((r) => r.state === "dead")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    console.error("\nFix: restore the referenced woff2 to the live deploy (a root static under public/fonts/), or repoint the preload <link> to the live font file, and redeploy.");
    process.exit(1);
  }
  if (verdict === "UNRESOLVED") {
    console.error("\n⚠️  font-preload UNRESOLVED — neither proved alive nor dead (transient 5xx/timeout). NOT a defect; re-run to confirm.");
    for (const r of results.filter((r) => r.state === "unresolved")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    process.exit(3);
  }
  if (verdict === "UNKNOWN") {
    console.log("\nfont-preload UNKNOWN — egress control down; font verdicts not trusted (runner/network offline, not a dead font).");
    process.exit(0);
  }
  console.log(`\n✅ font-preload CLEAN — every same-origin font the live <head> preloads serves live: ` +
    results.map((r) => `${r.url.replace(/^https?:\/\//, "").split("/").pop()} (${r.status} ${r.contentType})`).join(", "));
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();
else main();
