#!/usr/bin/env node
// check-crawl-entrypoints-live.mjs — prove the funnel's TWO search-crawl entry
// points (/robots.txt and /sitemap.xml) are still SERVED CORRECTLY on the live
// edge, not the SPA-shell masquerade. Owned by the Website Integrity Bot.
//
// WHY THIS EXISTS. apex-financial.org is the agency's recruiting funnel; its
// organic inbound ("insurance sales career", "get licensed", the /careers
// Google-for-Jobs pages) is a load-bearing lead source. Google's ENTIRE crawl
// of the site starts at two static files in public/:
//   • /robots.txt   — declares `Allow: /` + the `Sitemap:` URL
//   • /sitemap.xml  — the list of URLs we ask Google to index (/, /apply, /vsl,
//                     /get-licensed, /schedule-call, /careers/*, legal pages…)
// If either stops being served, the crawl entry point goes dark and the deep
// funnel routes silently leave Google's index weeks later.
//
// THE SILENT FAILURE IS THE 465-INSURACLOUD MASQUERADE, PROVEN ON THIS SITE.
// vercel.json's catch-all rewrite is `/((?!api/|assets/|fonts/|img/).*) ->
// /index.html`. A root-level file like /robots.txt or /sitemap.xml is served as
// a static file ONLY while it exists in the deploy; if it is dropped (deleted,
// renamed, a dist-copy failure, a build misconfig) the request falls through to
// that catch-all and the edge answers **200 text/html — the homepage shell**,
// not a 404. Measured on prod 2026-11-12:
//   GET /sitemap-DOESNOTEXIST.xml -> 200 text/html
//   GET /robots-DOESNOTEXIST.txt  -> 200 text/html
// Google then reads an HTML page where it expected robots directives / a URL
// set, can't parse it, and the funnel's crawl hints vanish — at HTTP 200 the
// whole way. A status-code probe reads that as success; this guard does not.
//
// EVERY EXISTING GUARD IS BLIND TO THIS (the source/live split, same as
// check-share-card-live vs check-share-card and check-vsl-media-live vs
// check-vsl-sync):
//   - check-robots-indexable (commit gate) is EXPLICITLY "all static, no build,
//     no network": it reads public/robots.txt + public/sitemap.xml from disk and
//     proves they agree (robots doesn't block a sitemap funnel path, no noindex).
//     The files can be perfect in the repo and absent from the live edge while
//     it stays green.
//   - check-sitemap-public-render reads the route list from the LOCAL
//     public/sitemap.xml (readFileSync) and renders each route; it never fetches
//     the live-served sitemap.xml FILE, so a masquerading/404 sitemap.xml file is
//     invisible to it.
//   - route-smoke proves the SPA shell 200s — which is EXACTLY the masquerade a
//     missing static file returns, so it can never catch this.
//   - the asset-graph guard resolves hashed JS/CSS build chunks; these are
//     fixed-name root statics, not build assets, so they escape it.
//
// WHY STATUS ALONE IS NOT ENOUGH — THE POSITIVE BODY SIGNATURE IS THE POINT. A
// live entry point must POSITIVELY carry the structure of the file it claims to
// be, and must NOT be the HTML shell:
//   • robots.txt  — body contains at least one robots directive
//                   (User-agent:/Allow:/Disallow:/Sitemap:) AND is not HTML.
//   • sitemap.xml — body contains a <urlset …> with at least one
//                   <loc>http…</loc> AND is not HTML.
// A 2xx carrying the SPA shell (<!doctype html>/<html …>) is a soft-success
// masquerade and reads DEAD, never alive. The body signature (not the
// content-type header, which the vercel.json header rules can set regardless of
// what file is actually served) is the robust discriminator.
//
// WHY WE FOLLOW THE ROBOTS -> SITEMAP CHAIN. We probe /robots.txt first and, when
// it is served healthy, we derive the sitemap URL from its OWN live `Sitemap:`
// directive (same host only) — the exact URL a crawler follows. That also
// catches a healthy robots.txt that points its Sitemap: line at a dead/renamed
// URL (check-robots-indexable can only prove the SOURCE line, not that the live
// target resolves). If robots.txt is itself dead or carries no same-host
// Sitemap: line, we fall back to the well-known {origin}/sitemap.xml so the
// sitemap is still probed and can go dead on its own.
//
// SCOPE SPLIT (deliberately narrow, like the sibling liveness guards): this
// probe owns exactly "are the two crawl entry-point FILES served (not the
// shell)". Whether robots/sitemap AGREE and don't block a funnel path is owned
// by check-robots-indexable (source); whether each sitemap ROUTE renders public
// to a crawler is owned by check-sitemap-public-render. Grading any of those
// again here would duplicate cost for no added coverage.
//
// WHY IT CAN'T CRY WOLF (exit contract shared with check-share-card-live.mjs,
// check-vsl-media-live.mjs and live-render-integrity.mjs so a cron wrapper /
// apex-doctor grades it alike):
//   - a positive dead signature (2xx shell/garbage, or 4xx) with egress proven
//     up is a DEFECT (exit 1): a crawl entry point is genuinely dead.
//   - a 5xx / timeout / connection error is transient infra -> UNRESOLVED
//     (exit 3), never a DEFECT. Re-run clears it.
//   - if the egress control (generate_204) is itself unreachable the verdict is
//     UNKNOWN (exit 0) and no "dead" is trusted — a runner/network blip must
//     never read as a dead file (MP-291).
//   0 CLEAN | 0 UNKNOWN (network) | 1 DEFECT | 3 UNRESOLVED/partial
//
// Needs no secrets: robots.txt + sitemap.xml are public static files.
//
// Usage:
//   node scripts/check-crawl-entrypoints-live.mjs
//   node scripts/check-crawl-entrypoints-live.mjs --selftest   # deterministic, local-only

import http from "node:http";

const SITE = (process.env.CRAWL_ENTRY_SITE || "https://apex-financial.org/").replace(/\/*$/, "/");
const CONTROL = process.env.CRAWL_ENTRY_CONTROL_URL || "https://www.google.com/generate_204";
const TIMEOUT_MS = Number(process.env.CRAWL_ENTRY_TIMEOUT_MS || 25000);

// ---- pure predicates -------------------------------------------------------
// The HTML shell is the masquerade response a dropped static file returns.
function isHtmlShell(body) {
  return /<!doctype\s+html|<html[\s>]/i.test(String(body || ""));
}
// robots.txt must carry at least one real directive line.
function looksLikeRobots(body) {
  return /(^|\r?\n)\s*(user-agent|allow|disallow|sitemap|crawl-delay)\s*:/i.test(String(body || ""));
}
// sitemap.xml must be a urlset carrying at least one absolute <loc>.
function looksLikeSitemap(body) {
  const s = String(body || "");
  return /<urlset[\s>]/i.test(s) && /<loc>\s*https?:\/\//i.test(s);
}

// Derive the sitemap URL from a LIVE, healthy robots.txt body — the exact URL a
// crawler follows. Only trust a same-host Sitemap: directive; otherwise fall
// back to the well-known path so the sitemap is still probed. Pure + selftested.
function sitemapUrlFromRobots(robotsBody, origin) {
  const fallback = origin + "sitemap.xml";
  const m = String(robotsBody || "").match(/(^|\r?\n)\s*sitemap\s*:\s*(\S+)/i);
  if (!m) return fallback;
  let declared;
  try { declared = new URL(m[2].trim()); } catch { return fallback; }
  let host;
  try { host = new URL(origin).host; } catch { return fallback; }
  // Cross-host sitemaps require separate verification in Search Console and are
  // not something this funnel uses; only follow a same-host declaration.
  if (declared.host.toLowerCase() !== host.toLowerCase()) return fallback;
  return declared.toString();
}

// ---- pure classifier ------------------------------------------------------
// Decide alive / dead / unresolved from a single probe descriptor + the kind of
// file expected. Pure of network + process state so --selftest drives it.
function classify({ networkError, status, contentType, body, kind }) {
  const label = kind === "robots" ? "robots.txt" : "sitemap.xml";
  if (networkError) {
    return { state: "unresolved", reason: `network error: ${networkError}` };
  }
  const ct = String(contentType || "").toLowerCase().split(";")[0].trim();
  const served = status === 200 || status === 206;
  if (served) {
    const shell = isHtmlShell(body);
    const structured = kind === "robots" ? looksLikeRobots(body) : looksLikeSitemap(body);
    if (structured && !shell) {
      return { state: "alive", status, contentType: ct };
    }
    // Served 2xx but the body is NOT the file it claims to be. On this SPA a
    // missing root static falls through to the catch-all and returns 200
    // text/html (the homepage shell); that (or any non-structured body) means a
    // crawler cannot parse this entry point — a soft-success masquerade = DEAD.
    const why = shell
      ? `served ${status} but the body is the SPA HTML shell (<!doctype html>), not ${label} — the file is missing from the deploy and vercel.json's catch-all is serving index.html in its place`
      : `served ${status} but the body carries no ${kind === "robots" ? "robots directive (User-agent:/Allow:/Disallow:/Sitemap:)" : "<urlset> with an absolute <loc>"} — ${label} is empty, truncated, or not the file it claims to be`;
    return { state: "dead", status, contentType: ct, reason: why };
  }
  if (status >= 400 && status < 500) {
    return {
      state: "dead", status, contentType: ct,
      reason: `HTTP ${status} — ${label} is missing, moved, or forbidden (dropped from the deploy / renamed without updating the reference)`,
    };
  }
  // 5xx or any other non-2xx: transient edge/infra, not a deleted file.
  return {
    state: "unresolved", status, contentType: ct,
    reason: `HTTP ${status || 0} — transient edge/infra response, not a positive file-gone signal`,
  };
}

// ---- object probe (full GET — the body signature is the whole point) -------
async function probeObject(url, kind) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
      // Read the body but cap it — the real files are tiny (< 10KB); the shell is
      // small too. We only need the leading signature, never a huge payload.
      const text = (await r.text().catch(() => "")).slice(0, 65536);
      const res = classify({ status: r.status, contentType: r.headers.get("content-type"), body: text, kind });
      return { url, kind, body: text, ...res };
    } catch (e) {
      last = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160);
      // a single nav hiccup is not evidence of death — retry once
    }
  }
  return { url, kind, ...classify({ networkError: last || "unknown", kind }) };
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

// Resolve the two entry-point URLs: robots.txt at the well-known path, and the
// sitemap at the URL robots.txt itself declares (the crawler's real chain),
// falling back to the well-known sitemap path when robots is dead / headless.
async function resolveObjects() {
  const robotsUrl = SITE + "robots.txt";
  const robots = await probeObject(robotsUrl, "robots");
  robots.label = "robots.txt (the crawl entry point — declares Allow:/ + the Sitemap: URL Google follows)";
  const sitemapUrl =
    robots.state === "alive" ? sitemapUrlFromRobots(robots.body, SITE) : SITE + "sitemap.xml";
  const sitemap = await probeObject(sitemapUrl, "sitemap");
  sitemap.label = "sitemap.xml (the URL list Google crawls — /apply, /vsl, /careers/*, …)";
  return [robots, sitemap];
}

// ---- selftest: deterministic, local-only -----------------------------------
async function selftest() {
  let pass = 0, total = 0;
  const ok = (cond, msg) => { total++; if (cond) { pass++; console.log(`✓ ${msg}`); } else { console.log(`✗ ${msg}`); } };

  const ROBOTS_OK = "User-agent: *\nAllow: /\n\nSitemap: https://apex-financial.org/sitemap.xml\n";
  const SITEMAP_OK =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    "  <url><loc>https://apex-financial.org/</loc></url>\n  <url><loc>https://apex-financial.org/apply</loc></url>\n</urlset>";
  const SHELL = "<!doctype html><html lang=\"en\"><head><title>Galaxy Financial</title></head><body></body></html>";

  // 1. Pure predicates.
  ok(isHtmlShell(SHELL) === true, "isHtmlShell(SPA shell) -> true");
  ok(isHtmlShell(ROBOTS_OK) === false, "isHtmlShell(robots.txt) -> false");
  ok(isHtmlShell(SITEMAP_OK) === false, "isHtmlShell(sitemap.xml) -> false");
  ok(looksLikeRobots(ROBOTS_OK) === true, "looksLikeRobots(real robots) -> true");
  ok(looksLikeRobots(SHELL) === false, "looksLikeRobots(HTML shell) -> false");
  ok(looksLikeRobots("just some text\nno directives") === false, "looksLikeRobots(no directive) -> false");
  ok(looksLikeSitemap(SITEMAP_OK) === true, "looksLikeSitemap(real sitemap) -> true");
  ok(looksLikeSitemap(SHELL) === false, "looksLikeSitemap(HTML shell) -> false");
  ok(looksLikeSitemap('<urlset></urlset>') === false, "looksLikeSitemap(urlset w/ no <loc>) -> false");

  // 2. sitemapUrlFromRobots — the chain derivation, both ways.
  ok(sitemapUrlFromRobots(ROBOTS_OK, "https://apex-financial.org/") === "https://apex-financial.org/sitemap.xml",
    "sitemapUrlFromRobots(same-host Sitemap:) -> declared URL");
  ok(sitemapUrlFromRobots("User-agent: *\nAllow: /\n", "https://apex-financial.org/") === "https://apex-financial.org/sitemap.xml",
    "sitemapUrlFromRobots(no Sitemap: line) -> well-known fallback");
  ok(sitemapUrlFromRobots("Sitemap: https://evil.example.com/sitemap.xml", "https://apex-financial.org/") === "https://apex-financial.org/sitemap.xml",
    "sitemapUrlFromRobots(cross-host) -> same-host fallback (not followed)");
  ok(sitemapUrlFromRobots("Sitemap: https://apex-financial.org/seo/sitemap-index.xml", "https://apex-financial.org/") === "https://apex-financial.org/seo/sitemap-index.xml",
    "sitemapUrlFromRobots(same-host moved path) -> that moved URL (catches a renamed sitemap)");

  // 3. Pure classifier, both directions, per kind — the masquerade is THE case.
  ok(classify({ status: 200, body: ROBOTS_OK, kind: "robots" }).state === "alive", "robots 200 real -> alive");
  ok(classify({ status: 200, body: SHELL, kind: "robots" }).state === "dead", "robots 200 SPA shell masquerade -> dead");
  ok(classify({ status: 200, body: "", kind: "robots" }).state === "dead", "robots 200 empty -> dead");
  ok(classify({ status: 404, body: SHELL, kind: "robots" }).state === "dead", "robots 404 -> dead");
  ok(classify({ status: 503, body: "", kind: "robots" }).state === "unresolved", "robots 503 -> unresolved (transient)");
  ok(classify({ networkError: "fetch failed", kind: "robots" }).state === "unresolved", "robots network error -> unresolved");
  ok(classify({ status: 200, body: SITEMAP_OK, kind: "sitemap" }).state === "alive", "sitemap 200 real -> alive");
  ok(classify({ status: 200, body: SHELL, kind: "sitemap" }).state === "dead", "sitemap 200 SPA shell masquerade -> dead");
  ok(classify({ status: 200, body: "<urlset></urlset>", kind: "sitemap" }).state === "dead", "sitemap 200 urlset w/ no <loc> -> dead");
  ok(classify({ status: 404, body: SHELL, kind: "sitemap" }).state === "dead", "sitemap 404 -> dead");
  ok(classify({ status: 500, body: "", kind: "sitemap" }).state === "unresolved", "sitemap 500 -> unresolved (transient)");
  // A real robots served (wrongly) as text/html but with directives is still
  // usable by Google — do not false-positive on content-type alone.
  ok(classify({ status: 200, contentType: "text/html", body: ROBOTS_OK, kind: "robots" }).state === "alive",
    "robots 200 real-directives even w/ text/html content-type -> alive (no content-type false positive)");

  // 4. End-to-end probeObject against a local server (faithful fetch pipeline).
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); res.end(ROBOTS_OK); return; }
    if (path === "/sitemap.xml") { res.writeHead(200, { "content-type": "application/xml" }); res.end(SITEMAP_OK); return; }
    if (path === "/shell-robots") { res.writeHead(200, { "content-type": "text/html" }); res.end(SHELL); return; }
    if (path === "/shell-sitemap") { res.writeHead(200, { "content-type": "text/html" }); res.end(SHELL); return; }
    if (path === "/gone") { res.writeHead(404, { "content-type": "text/html" }); res.end(SHELL); return; }
    if (path === "/infra") { res.writeHead(500, { "content-type": "text/plain" }); res.end("upstream error"); return; }
    if (path === "/ctl") { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { "content-type": "text/html" }); res.end(SHELL);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  ok((await probeObject(`${origin}/robots.txt`, "robots")).state === "alive", "e2e robots.txt -> alive");
  ok((await probeObject(`${origin}/sitemap.xml`, "sitemap")).state === "alive", "e2e sitemap.xml -> alive");
  ok((await probeObject(`${origin}/shell-robots`, "robots")).state === "dead", "e2e 200-text/html robots masquerade -> dead");
  ok((await probeObject(`${origin}/shell-sitemap`, "sitemap")).state === "dead", "e2e 200-text/html sitemap masquerade -> dead");
  ok((await probeObject(`${origin}/gone`, "sitemap")).state === "dead", "e2e 404 -> dead");
  ok((await probeObject(`${origin}/infra`, "robots")).state === "unresolved", "e2e 500 -> unresolved");

  // 5. Control reachability, both directions (prove the UNKNOWN gate is real).
  const ctlUp = await controlReachable(`${origin}/ctl`);
  ok(ctlUp === true, "control /ctl reachable -> true");
  await new Promise((r) => server.close(r));
  const ctlDown = await controlReachable(`http://127.0.0.1:${port}/ctl`); // server now closed
  ok(ctlDown === false, "control unreachable after close -> false");

  // 6. decideVerdict: the control gate is load-bearing.
  const deadRes = [{ state: "dead" }];
  ok(decideVerdict(deadRes, true).verdict === "DEFECT" && decideVerdict(deadRes, true).code === 1, "dead + control up -> DEFECT(1)");
  ok(decideVerdict(deadRes, false).verdict === "UNKNOWN" && decideVerdict(deadRes, false).code === 0, "dead + control DOWN -> UNKNOWN(0), not trusted");
  ok(decideVerdict([{ state: "unresolved" }], true).verdict === "UNRESOLVED", "unresolved + control up -> UNRESOLVED(3)");
  ok(decideVerdict([{ state: "unresolved" }], true).code === 3, "unresolved -> exit 3");
  ok(decideVerdict([{ state: "alive" }], true).verdict === "CLEAN", "alive -> CLEAN(0)");
  ok(decideVerdict([{ state: "alive" }, { state: "alive" }], true).verdict === "CLEAN", "both alive -> CLEAN(0)");

  console.log(`\nselftest: ${pass}/${total}`);
  if (pass !== total) { console.error("SELFTEST FAILED — the crawl-entrypoint alive/dead detector is wrong."); process.exit(1); }
  console.log("✅ selftest: robots+sitemap alive/dead/unresolved + SPA-shell masquerade + robots->sitemap chain + control-gating all classified correctly, both directions.");
  process.exit(0);
}

// ---- live run --------------------------------------------------------------
async function main() {
  const results = await resolveObjects();

  const anyDead = results.some((r) => r.state === "dead");
  const controlUp = anyDead ? await controlReachable(CONTROL) : true;
  const { verdict, code, downgradeDead } = decideVerdict(results, controlUp);
  if (downgradeDead) {
    for (const r of results) if (r.state === "dead") { r.state = "unresolved"; r.reason = "dead signature BUT egress control unreachable — not trusted: " + r.reason; }
  }

  const out = {
    verdict,
    control: anyDead ? (controlUp ? "up" : "down") : "not-probed",
    objects: results.map((r) => ({ label: r.label, url: r.url, state: r.state, status: r.status, contentType: r.contentType, reason: r.reason })),
  };
  console.log(JSON.stringify(out, null, 2));

  if (verdict === "DEFECT") {
    console.error("\nCRAWL ENTRY-POINT DEFECT — a search-crawl entry point for the recruiting funnel is DEAD. Google cannot read it, and the funnel's deep routes will silently leave the index:");
    for (const r of results.filter((r) => r.state === "dead")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    console.error("\nFix: restore public/robots.txt and/or public/sitemap.xml so the deploy serves them (a dropped root static falls through to the SPA shell at 200 — it does not 404). Re-verify with `node scripts/check-robots-indexable.mjs` for source agreement, then redeploy.");
    process.exit(1);
  }
  if (verdict === "UNRESOLVED") {
    console.error("\n⚠️  crawl entry points UNRESOLVED — neither proved alive nor dead (transient 5xx/timeout). NOT a defect; re-run to confirm.");
    for (const r of results.filter((r) => r.state === "unresolved")) console.error(`  [${r.label}] ${r.url} — ${r.reason}`);
    process.exit(3);
  }
  if (verdict === "UNKNOWN") {
    console.log("\ncrawl entry points UNKNOWN — egress control down; file verdicts not trusted (runner/network offline, not a dead file).");
    process.exit(0);
  }
  console.log(`\n✅ crawl entry points CLEAN — both served live: ` +
    results.map((r) => `${r.kind} (${r.status} ${r.contentType})`).join(", "));
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();
else main();
