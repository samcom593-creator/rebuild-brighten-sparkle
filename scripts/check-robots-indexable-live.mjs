#!/usr/bin/env node
// check-robots-indexable-live.mjs — prove the recruiting funnel's money routes
// are NOT being told to leave Google's index on the LIVE edge. Owned by the
// Website Integrity Bot. (MP-WIB-ROBOTS-LIVE, 2026-11-16)
//
// WHY THIS EXISTS. galaxyfinancial.org's organic inbound ("insurance sales
// career", "get licensed", the /careers Google-for-Jobs pages) is a load-
// bearing recruiting lead source. A single `noindex` signal removes a page from
// Google's index entirely — strictly worse than the 2026-11-10 canonical bug,
// which only MERGED deep routes onto "/". There are two edge-level ways to emit
// one, and NEITHER is visible to any existing guard:
//
//   1. An  X-Robots-Tag: noindex  RESPONSE HEADER. check-robots-indexable (the
//      SOURCE guard) reads ONLY the committed vercel.json. A noindex header set
//      from the Vercel dashboard (Project Settings -> Headers), an edge-config
//      rule, a middleware, or a proxy in front of the origin never touches
//      vercel.json, so the source guard stays green while Google sees noindex.
//      This is the exact source/live split the bot closed for the VSL media
//      (check-vsl-media-live) and the share card (check-share-card-live): a
//      consistency guard and a liveness guard are two different jobs.
//
//   2. A  <meta name="robots" content="noindex">  injected into the SERVED
//      HTML by an edge rewrite serving a different shell than the committed
//      index.html. The source guard greps the committed index.html + src; it
//      cannot see what the edge actually returns.
//
// crawl-entrypoints-live is NOT this guard. It proves the robots.txt +
// sitemap.xml FILES serve live (not the SPA-shell masquerade). It never reads a
// money ROUTE's response headers or body for a noindex signal. Verified
// 2026-11-16: the ONLY file in the guard suite that mentions `x-robots-tag` is
// the source guard, and it reads the file on disk, not the wire.
//
// WHAT IT PROBES (the LIVE counterpart to the source guard's rules A/B/C):
//   • robots.txt is fetched live and parsed; no sitemap funnel path may be
//     Disallowed for */Googlebot/Bingbot (Google's most-specific-wins /
//     Allow-breaks-ties algorithm — the SAME isBlocked() the source guard uses,
//     imported from ./lib so they cannot drift).  [live rule A]
//   • each money route is fetched; its X-Robots-Tag response header must carry
//     no noindex/none token.                                   [live rule C]
//   • each money route's served HTML must carry no noindex robots meta (SAME
//     noindexMetas() the source guard uses).                   [live rule B]
//
// THE OPERAND IS THE LIVE SITEMAP (the authoritative list of URLs we ask Google
// to index), with a pinned core-funnel fallback so a one-off sitemap hiccup
// cannot leave this guard probing nothing. Routes are capped (no silent
// truncation — a cap is logged) so a future flood of /careers slugs can't make
// one run unbounded.
//
// WHY IT CAN'T CRY WOLF (exit contract shared with check-vsl-media-live.mjs and
// check-share-card-live.mjs so a cron wrapper / apex-doctor grades it alike):
//   • a noindex signal (header or meta) or a Disallowed funnel path, WITH egress
//     proven up, is a DEFECT (exit 1): the route is being deindexed for real.
//   • a 5xx / 4xx / timeout / network error is NOT a noindex signal — route
//     up/down is route-smoke's job, not this guard's — so it is UNRESOLVED
//     (exit 3), never a DEFECT.
//   • if the egress control (generate_204) is itself unreachable the verdict is
//     UNKNOWN (exit 0) and no "noindexed"/"blocked" is trusted — a runner /
//     network blip must never read as a deindex (MP-291).
//   0 CLEAN | 0 UNKNOWN (network) | 1 DEFECT | 3 UNRESOLVED/partial
//
// Needs no secrets: robots.txt, the sitemap, and every funnel route are public.
//
// Usage:
//   node scripts/check-robots-indexable-live.mjs
//   node scripts/check-robots-indexable-live.mjs --selftest   # deterministic, local-only

import http from "node:http";
import {
  sitemapPaths,
  parseRobots,
  isBlocked,
  noindexMetas,
} from "./lib/robots-indexable-parse.mjs";

const SITE = (process.env.ROBOTS_LIVE_SITE || "https://galaxyfinancial.org/").replace(/\/*$/, "/");
const CONTROL = process.env.ROBOTS_LIVE_CONTROL_URL || "https://www.google.com/generate_204";
const TIMEOUT_MS = Number(process.env.ROBOTS_LIVE_TIMEOUT_MS || 25000);
const MAX_ROUTES = Number(process.env.ROBOTS_LIVE_MAX_ROUTES || 40);

// The money routes that must ALWAYS be probed even if the live sitemap is
// momentarily unreachable — the funnel's load-bearing conversion + SEO surfaces.
const CORE_FUNNEL = ["/", "/apply", "/vsl", "/get-licensed", "/schedule-call", "/leads", "/contact", "/careers"];

// ── pure classifier: one route probe -> indexable / noindexed / unresolved ───
// Pure of network + process so --selftest drives it deterministically. A
// noindex is only ever emitted by a 2xx response (a 4xx/5xx carries no index
// directive); route up/down belongs to route-smoke, so every non-2xx here is
// unresolved, never a noindex defect.
export function classifyRoute({ networkError, status, xRobotsTag, html }) {
  if (networkError) {
    return { state: "unresolved", reason: `network error: ${networkError}` };
  }
  const served = status >= 200 && status < 300;
  if (served) {
    const tag = String(xRobotsTag || "");
    if (/\b(noindex|none)\b/i.test(tag)) {
      return {
        state: "noindexed", status, via: "X-Robots-Tag header",
        reason: `served ${status} with X-Robots-Tag: "${tag}" — the edge is telling every crawler to drop this route from the index. This header is NOT in the committed vercel.json (the source guard is green); it was set from the Vercel dashboard / an edge rule / a proxy.`,
      };
    }
    const metas = noindexMetas(String(html || ""));
    if (metas.length) {
      return {
        state: "noindexed", status, via: "robots meta",
        reason: `served ${status} carrying a noindex robots meta in the delivered HTML: ${metas[0]} — the edge is serving a shell that deindexes this route.`,
      };
    }
    return { state: "indexable", status };
  }
  // Any non-2xx: not a noindex signal. Route down/forbidden is route-smoke's job.
  return {
    state: "unresolved", status,
    reason: `HTTP ${status || 0} — not a noindex signal (route up/down is route-smoke's concern, not this guard's)`,
  };
}

// ── robots.txt leg: does the LIVE robots block any funnel path? (live rule A) ─
// Returns { ok, blocks:[{path,ua}], unresolved:bool, note }. A robots.txt that
// is unreachable or returns the SPA-shell masquerade (no parseable groups) is
// UNRESOLVED here — crawl-entrypoints-live owns robots liveness; this leg only
// adjudicates BLOCKING when robots was genuinely read.
export function classifyRobots({ networkError, status, body }, funnelPaths) {
  if (networkError) return { unresolved: true, blocks: [], note: `robots.txt network error: ${networkError}` };
  if (!(status >= 200 && status < 300)) return { unresolved: true, blocks: [], note: `robots.txt HTTP ${status || 0}` };
  const { groups } = parseRobots(String(body || ""));
  if (Object.keys(groups).length === 0) {
    // No parseable directives (empty, or the HTML shell served in its place).
    // Not a blocking signal here; crawl-entrypoints-live catches the masquerade.
    return { unresolved: true, blocks: [], note: "robots.txt carried no parseable User-agent groups (empty or shell masquerade — crawl-entrypoints-live owns that)" };
  }
  const star = groups["*"];
  const blocks = [];
  for (const ua of ["*", "googlebot", "bingbot"]) {
    const group = groups[ua] || star;
    for (const p of funnelPaths) {
      if (isBlocked(p, group)) blocks.push({ path: p, ua });
    }
  }
  return { unresolved: false, blocks, note: "" };
}

// ── probes (real network) ────────────────────────────────────────────────────
async function fetchText(url, { range = false } = {}) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        method: "GET",
        headers: range ? { Range: "bytes=0-0" } : { "User-Agent": "Mozilla/5.0 (compatible; ApexWebsiteIntegrityBot/1.0)" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
      const body = await r.text().catch(() => "");
      return { status: r.status, xRobotsTag: r.headers.get("x-robots-tag"), body };
    } catch (e) {
      last = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160);
    }
  }
  return { networkError: last || "unknown" };
}

async function probeRoute(url) {
  const r = await fetchText(url);
  const res = classifyRoute({ networkError: r.networkError, status: r.status, xRobotsTag: r.xRobotsTag, html: r.body });
  return { url, ...res };
}

async function controlReachable(controlUrl) {
  try {
    const r = await fetch(controlUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
    return r.status === 204 || r.ok;
  } catch { return false; }
}

// ── verdict (pure) ────────────────────────────────────────────────────────────
// A "noindexed"/"blocked" is only trustworthy when the control proves egress.
export function decideVerdict(routeResults, robotsLeg, controlUp) {
  const noindexed = routeResults.filter((r) => r.state === "noindexed");
  const blocked = robotsLeg.blocks || [];
  const unresolved = routeResults.filter((r) => r.state === "unresolved");
  const anyDefect = noindexed.length > 0 || blocked.length > 0;
  if (anyDefect) {
    if (controlUp) return { verdict: "DEFECT", code: 1 };
    return { verdict: "UNKNOWN", code: 0, downgrade: true };
  }
  if (unresolved.length > 0 || robotsLeg.unresolved) return { verdict: "UNRESOLVED", code: 3 };
  return { verdict: "CLEAN", code: 0 };
}

// ── derive the route set from the LIVE sitemap, core-funnel fallback ─────────
function resolveRoutes(sitemapXml) {
  const notes = [];
  let paths = [];
  if (sitemapXml) {
    const locs = sitemapPaths(sitemapXml);
    paths = locs.filter((l) => l.path).map((l) => l.path);
  }
  if (paths.length === 0) {
    notes.push("live sitemap unreachable/empty — falling back to the pinned core funnel set");
    paths = [...CORE_FUNNEL];
  } else {
    // Always include the core funnel even if a sitemap edit drops one.
    for (const p of CORE_FUNNEL) if (!paths.includes(p)) paths.push(p);
  }
  const uniq = [...new Set(paths)];
  if (uniq.length > MAX_ROUTES) {
    // No silent cap: keep the core funnel + fill to the cap, and SAY what dropped.
    const core = uniq.filter((p) => CORE_FUNNEL.includes(p));
    const rest = uniq.filter((p) => !CORE_FUNNEL.includes(p)).slice(0, Math.max(0, MAX_ROUTES - core.length));
    notes.push(`route set capped at ${MAX_ROUTES} (sitemap had ${uniq.length}); dropped ${uniq.length - (core.length + rest.length)} non-core route(s) from this run`);
    return { paths: [...core, ...rest], notes };
  }
  return { paths: uniq, notes };
}

// ── selftest: deterministic, local-only ──────────────────────────────────────
async function selftest() {
  let pass = 0, total = 0;
  const ok = (cond, msg) => { total++; if (cond) { pass++; console.log(`✓ ${msg}`); } else { console.log(`✗ ${msg}`); } };

  // 1. classifyRoute both directions — the X-Robots-Tag header is THE case.
  ok(classifyRoute({ status: 200, html: "<html></html>" }).state === "indexable", "200 clean -> indexable");
  ok(classifyRoute({ status: 200, xRobotsTag: "noindex" }).state === "noindexed", "200 + X-Robots-Tag: noindex -> noindexed");
  ok(classifyRoute({ status: 200, xRobotsTag: "all, noindex" }).state === "noindexed", "200 + X-Robots-Tag: all, noindex -> noindexed");
  ok(classifyRoute({ status: 200, xRobotsTag: "none" }).state === "noindexed", "200 + X-Robots-Tag: none -> noindexed");
  ok(classifyRoute({ status: 200, xRobotsTag: "index, follow" }).state === "indexable", "200 + X-Robots-Tag: index,follow -> indexable (benign)");
  ok(classifyRoute({ status: 200, html: '<meta name="robots" content="noindex">' }).state === "noindexed", "200 + noindex robots meta in body -> noindexed");
  ok(classifyRoute({ status: 200, html: '<meta name="robots" content="index,follow">' }).state === "indexable", "200 + benign robots meta -> indexable");
  ok(classifyRoute({ status: 404 }).state === "unresolved", "404 -> unresolved (route-smoke's job, not a noindex)");
  ok(classifyRoute({ status: 503 }).state === "unresolved", "503 -> unresolved (transient)");
  ok(classifyRoute({ networkError: "fetch failed" }).state === "unresolved", "network error -> unresolved");
  ok(classifyRoute({ status: 200, xRobotsTag: "noindex" }).via === "X-Robots-Tag header", "noindex via header is attributed to the header");
  ok(classifyRoute({ status: 200, html: '<meta name="robots" content="none">' }).via === "robots meta", "noindex via meta is attributed to the meta");

  // 2. classifyRobots: the imported isBlocked must drive the live robots leg.
  const blockFunnel = classifyRobots({ status: 200, body: "User-agent: *\nDisallow: /apply" }, ["/apply", "/vsl"]);
  ok(blockFunnel.blocks.some((b) => b.path === "/apply"), "live robots Disallow: /apply -> /apply blocked");
  ok(!blockFunnel.blocks.some((b) => b.path === "/vsl"), "live robots Disallow: /apply leaves /vsl crawlable");
  const allowAll = classifyRobots({ status: 200, body: "User-agent: *\nAllow: /\nSitemap: https://galaxyfinancial.org/sitemap.xml" }, ["/apply", "/vsl"]);
  ok(allowAll.blocks.length === 0 && !allowAll.unresolved, "live robots Allow: / -> nothing blocked, resolved");
  ok(classifyRobots({ status: 200, body: "<!doctype html><html>shell</html>" }, ["/apply"]).unresolved === true, "robots shell masquerade -> unresolved (crawl-entrypoints owns liveness)");
  ok(classifyRobots({ networkError: "x" }, ["/apply"]).unresolved === true, "robots network error -> unresolved");
  ok(classifyRobots({ status: 503 }, ["/apply"]).unresolved === true, "robots 503 -> unresolved");

  // 3. resolveRoutes: sitemap operand + core-funnel fallback + no silent cap.
  const r1 = resolveRoutes("<urlset><url><loc>https://galaxyfinancial.org/careers/texas</loc></url></urlset>");
  ok(r1.paths.includes("/careers/texas") && r1.paths.includes("/apply"), "sitemap paths + core funnel merged");
  const r2 = resolveRoutes("");
  ok(r2.paths.includes("/apply") && r2.notes.some((n) => /core funnel/i.test(n)), "empty sitemap -> core funnel fallback, noted");

  // 4. e2e probeRoute against a local server (faithful fetch pipeline).
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/ok") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><head></head><body>ok</body></html>"); return; }
    if (path === "/hdr-noindex") { res.writeHead(200, { "content-type": "text/html", "x-robots-tag": "noindex" }); res.end("<html></html>"); return; }
    if (path === "/meta-noindex") { res.writeHead(200, { "content-type": "text/html" }); res.end('<html><head><meta name="robots" content="noindex"></head></html>'); return; }
    if (path === "/infra") { res.writeHead(500, { "content-type": "text/plain" }); res.end("upstream error"); return; }
    if (path === "/ctl") { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { "content-type": "text/html" }); res.end("<html>nope</html>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  ok((await probeRoute(`${origin}/ok`)).state === "indexable", "e2e /ok -> indexable");
  ok((await probeRoute(`${origin}/hdr-noindex`)).state === "noindexed", "e2e /hdr-noindex (X-Robots-Tag) -> noindexed");
  ok((await probeRoute(`${origin}/meta-noindex`)).state === "noindexed", "e2e /meta-noindex -> noindexed");
  ok((await probeRoute(`${origin}/infra`)).state === "unresolved", "e2e 500 -> unresolved");
  ok((await probeRoute(`${origin}/missing`)).state === "unresolved", "e2e 404 -> unresolved");

  // 5. control reachability both directions (prove the UNKNOWN gate is real).
  ok((await controlReachable(`${origin}/ctl`)) === true, "control /ctl reachable -> true");
  await new Promise((r) => server.close(r));
  ok((await controlReachable(`${origin}/ctl`)) === false, "control unreachable after close -> false");

  // 6. decideVerdict: the control gate is load-bearing in BOTH defect legs.
  const clean = { unresolved: false, blocks: [] };
  ok(decideVerdict([{ state: "noindexed" }], clean, true).verdict === "DEFECT", "noindexed route + control up -> DEFECT(1)");
  ok(decideVerdict([{ state: "noindexed" }], clean, false).verdict === "UNKNOWN", "noindexed route + control DOWN -> UNKNOWN(0), not trusted");
  ok(decideVerdict([{ state: "indexable" }], { unresolved: false, blocks: [{ path: "/apply", ua: "*" }] }, true).verdict === "DEFECT", "robots blocks a funnel path + control up -> DEFECT(1)");
  ok(decideVerdict([{ state: "indexable" }], { unresolved: false, blocks: [{ path: "/apply", ua: "*" }] }, false).verdict === "UNKNOWN", "robots block + control DOWN -> UNKNOWN(0)");
  ok(decideVerdict([{ state: "unresolved" }], clean, true).code === 3, "an unresolved route + no defect -> UNRESOLVED(3)");
  ok(decideVerdict([{ state: "indexable" }], { unresolved: true, blocks: [] }, true).code === 3, "robots leg unresolved + no defect -> UNRESOLVED(3)");
  ok(decideVerdict([{ state: "indexable" }], clean, true).verdict === "CLEAN", "all indexable + robots clean -> CLEAN(0)");

  console.log(`\nselftest: ${pass}/${total}`);
  if (pass !== total) { console.error("SELFTEST FAILED — the live-indexability detector is wrong."); process.exit(1); }
  console.log("✅ selftest: X-Robots-Tag + robots-meta + live-robots-block detection, control-gating, and the sitemap/core-funnel operand all classify correctly, both directions.");
  process.exit(0);
}

// ── live run ──────────────────────────────────────────────────────────────────
async function main() {
  const origin = SITE.replace(/\/$/, "");
  // Operand: the live sitemap's URL list (authoritative), core-funnel fallback.
  const sm = await fetchText(SITE + "sitemap.xml");
  const { paths, notes } = resolveRoutes(sm.networkError ? "" : sm.body);
  for (const n of notes) console.error(`[robots-indexable-live] note: ${n}`);

  // Route leg.
  const routeResults = [];
  for (const p of paths) {
    const r = await probeRoute(origin + p);
    r.path = p;
    routeResults.push(r);
  }

  // Live robots.txt blocking leg (live rule A).
  const robotsResp = await fetchText(SITE + "robots.txt");
  const robotsLeg = classifyRobots(robotsResp, paths);

  const anyDefect = routeResults.some((r) => r.state === "noindexed") || (robotsLeg.blocks || []).length > 0;
  const controlUp = anyDefect ? await controlReachable(CONTROL) : true;
  const { verdict, code, downgrade } = decideVerdict(routeResults, robotsLeg, controlUp);
  if (downgrade) {
    for (const r of routeResults) if (r.state === "noindexed") { r.state = "unresolved"; r.reason = "noindex signature BUT egress control unreachable — not trusted: " + r.reason; }
  }

  const out = {
    verdict,
    control: anyDefect ? (controlUp ? "up" : "down") : "not-probed",
    routesProbed: routeResults.length,
    robots: { unresolved: robotsLeg.unresolved, blocked: robotsLeg.blocks, note: robotsLeg.note },
    noindexed: routeResults.filter((r) => r.state === "noindexed").map((r) => ({ path: r.path, via: r.via, reason: r.reason })),
    unresolved: routeResults.filter((r) => r.state === "unresolved").map((r) => ({ path: r.path, reason: r.reason })),
  };
  console.log(JSON.stringify(out, null, 2));

  if (verdict === "DEFECT") {
    console.error("\nROBOTS-INDEXABLE-LIVE DEFECT — a recruiting-funnel money route is being told to leave Google's index ON THE LIVE EDGE while the source guard is green:");
    for (const r of routeResults.filter((r) => r.state === "noindexed")) console.error(`  [noindex] ${r.url} — ${r.reason}`);
    for (const b of robotsLeg.blocks || []) console.error(`  [robots blocks] ${b.path} Disallowed for user-agent "${b.ua}" on the LIVE robots.txt — it is in the sitemap (we ask Google to index it) yet the served robots.txt blocks it.`);
    console.error("\nFix: a noindex header is NOT in the repo — look at Vercel Project Settings -> Headers, any edge-config / middleware, and any proxy in front of the origin; a live robots block means the SERVED robots.txt differs from public/robots.txt. The source guard (check:robots-indexable) can't see any of these; this guard is the only one that does.");
    process.exit(1);
  }
  if (verdict === "UNRESOLVED") {
    console.error("\n⚠️  robots-indexable-live UNRESOLVED — no noindex proven, but a route/robots probe was transient (5xx/4xx/timeout). NOT a defect; re-run to confirm.");
    process.exit(3);
  }
  if (verdict === "UNKNOWN") {
    console.log("\nrobots-indexable-live UNKNOWN — egress control down; noindex verdicts not trusted (runner/network offline, not a live deindex).");
    process.exit(0);
  }
  console.log(`\n✅ robots-indexable-live CLEAN — ${routeResults.length} funnel route(s) serve with no X-Robots-Tag noindex header and no noindex robots meta, and the live robots.txt blocks none of them.`);
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();
else main();
