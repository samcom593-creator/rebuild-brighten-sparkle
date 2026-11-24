#!/usr/bin/env node
// check-funnel-share-card-live.mjs — prove the SHARE CARD (og:image +
// twitter:image) on the sell4daddy.com funnel HUB and its 3 keyword-CTA doors is
// still ALIVE on the live edge. Owned by the Website Integrity Bot.
//
// WHY THIS EXISTS. sell4daddy.com is the HUB bio link in @sell4daddy's TikTok
// (84.4K) + Instagram profiles — the single clickable path off 100% of Sam's
// short-form audience (memory: funnel_hub_bio_link_liveness). Its 3 doors
// (/team, /body, /build) are where every "comment TEAM/BODY/BUILD" keyword-CTA
// lead lands (memory: social_bot_lead_magnet_attribution — one Short routed 9
// leads / $21,600 through a single door). Every time that bio link — or a door
// link — is PASTED into a DM, iMessage, WhatsApp, Discord, LinkedIn or X, the
// preview crawler (none run JS) reads the SERVED HTML's og:image + twitter:image
// and renders THAT image as the card. It is the first impression of the
// highest-traffic funnel entry Sam owns.
//
// THE BLIND SPOT. galaxyfinancial.org's share card has a dedicated live-edge
// guard (check-share-card-live.mjs). check-lead-magnet-cta-live.mjs proves these
// 4 sell4daddy PAGES serve a real landing body — but it never reads the
// og:image / twitter:image, so the card can go dead while the page stays alive
// and that guard stays green. sell4daddy.com is a SEPARATE Vercel project
// outside this repo's deploy pipeline; a deploy that drops/renames an OG jpg, a
// purge that evicts it, or a storage hiccup kills the share card on the #1
// funnel entry — and nothing in this repo would ever know, because the one guard
// that reads image bytes (check-share-card-live) only ever probes
// galaxyfinancial.org. This closes the SAME category of leak the apex guard
// exists to protect, on the higher-traffic origin.
//
// WHY READ THE LIVE-SERVED HTML, NOT A MANIFEST. These are separate Vercel
// projects — there is no render manifest for them in this tree. So this guard
// fetches each surface's live HTML and discovers the og:image / twitter:image it
// ACTUALLY advertises, then probes exactly that URL. That also closes a drift
// the apex guard cannot see: check-share-card-live derives its probe URL from
// scripts/data/share-card.json, so if a live deploy's og:image ever drifted from
// the manifest it would probe the manifest URL (healthy) while the live card
// pointed elsewhere (dead). Here the probed URL is always what the live page
// serves to a crawler — no source/live gap.
//
// WHY STATUS ALONE IS NOT ENOUGH (the 465-InsuraCloud masquerade, cross-domain).
// A live card image must POSITIVELY serve 200/206 AND an image/* content-type. A
// 2xx carrying text/html (a SPA/404 shell) or application/json (an error body) —
// a soft-success masquerade — reads DEAD, never alive. A page that renders 200
// but advertises NO og:image/twitter:image at all is also DEAD: the share
// previews with no image. That image-bytes + content-type discriminator is the
// whole point; a mere page-200 (what lead-magnet-cta-live already proves) says
// nothing about the card.
//
// WHY THE SURFACE SET IS DERIVED FROM SOURCE, NEVER HARDCODED. The doors are the
// KEYWORDS array in src/lib/brand.ts (the same source check-lead-magnet-cta-live
// reads); the HUB is the ORIGIN of those door URLs (so if the brand ever moves
// off sell4daddy.com, the hub follows automatically). Add a 4th keyword-door to
// that array and this guard probes its card too; rename a door and it follows.
// The guard can never go stale against a surface the funnel no longer serves,
// nor miss one it newly serves.
//
// WHY IT CAN'T CRY WOLF (exit contract shared with check-share-card-live.mjs,
// check-lead-magnet-cta-live.mjs, check-vsl-media-live.mjs so a cron wrapper /
// apex-doctor grades it alike):
//   - a card image with a positive dead signature (2xx wrong content-type, or a
//     4xx) — or a live page advertising no card image at all — WITH egress
//     proven up is a DEFECT (exit 1): the card is dead for real shares.
//   - a page or image 5xx / timeout / DNS / connection error, or the brand.ts
//     seed read failing, is transient infra -> UNRESOLVED (exit 3), never a
//     DEFECT. Re-run clears a blip; a genuine break persists as a daily warning.
//   - if the egress control (generate_204) is itself unreachable the verdict is
//     UNKNOWN (exit 0) and no "dead" is trusted — a runner/network blip must
//     never read as a dead card (MP-291).
//   0 CLEAN | 0 UNKNOWN (network) | 1 DEFECT | 3 UNRESOLVED/partial
//
// A page that is 4xx/5xx/down is deliberately NOT a DEFECT here: page liveness
// is check-lead-magnet-cta-live.mjs's and check-funnel-hub-live.py's job. This
// guard owns exactly one question — given a surface that renders, is its share
// card image real? A down page yields UNRESOLVED for its card (no trustworthy
// card signal), and the page-liveness guards redden the outage.
//
// Usage:
//   node scripts/check-funnel-share-card-live.mjs
//   node scripts/check-funnel-share-card-live.mjs --selftest   # deterministic, local-only

import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFunnelDoors } from "./lib/funnel-doors-parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAND_SOURCE = process.env.FUNNEL_SHARE_CARD_BRAND_SOURCE || resolve(__dirname, "../src/lib/brand.ts");
const CONTROL = process.env.FUNNEL_SHARE_CARD_CONTROL_URL || "https://www.google.com/generate_204";
const TIMEOUT_MS = Number(process.env.FUNNEL_SHARE_CARD_TIMEOUT_MS || 25000);

// ---- derive the surface set from source (pure string parsing for --selftest) -
// The doors are KEYWORDS (TEAM/BODY/BUILD) ∪ LANDING_DOORS (GLOWUP) in
// src/lib/brand.ts, via the shared parser scripts/lib/funnel-doors-parse.mjs —
// the SAME detector check-lead-magnet-cta-live.mjs uses, so the share-card guard
// and the page-liveness guard can never watch different surfaces. The HUB is the
// origin root of those doors (follows the brand if it ever moves hosts). Returns
// { surfaces, parseError }.
function parseSurfaces(brandSrc) {
  const { doors, parseError } = parseFunnelDoors(brandSrc);
  if (parseError) return { surfaces: [], parseError };
  let hubOrigin;
  try { hubOrigin = new URL(doors[0].url).origin + "/"; }
  catch (e) { return { surfaces: [], parseError: `door url not parseable as origin: ${e.message}` }; }
  const surfaces = [{ key: "HUB", url: hubOrigin, label: `HUB bio-link root (${hubOrigin})` }, ...doors];
  return { surfaces, parseError: null };
}

// ---- parse the share-card image URLs a served HTML advertises (pure) ---------
// Pull og:image + twitter:image, resolve relative against the page's final URL,
// dedupe. Property/name order and quote style vary across generators, so match
// both <meta property=... content=...> and <meta content=... property=...>.
function parseCardImages(html, baseUrl) {
  const text = String(html || "");
  const urls = [];
  const seen = new Set();
  const metaRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(text))) {
    const tag = m[0];
    const key = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!key) continue;
    const k = key.toLowerCase();
    if (k !== "og:image" && k !== "twitter:image" && k !== "og:image:url") continue;
    const content = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (!content) continue;
    let abs;
    try { abs = new URL(content, baseUrl).href; } catch { continue; }
    if (seen.has(abs)) continue;
    seen.add(abs);
    urls.push({ key: k, url: abs });
  }
  return urls;
}

// ---- pure image classifier ---------------------------------------------------
// Decide alive / dead / unresolved from a single image probe descriptor. Pure of
// network + process state so --selftest drives it deterministically.
function classifyImage({ networkError, status, contentType }) {
  if (networkError) {
    return { state: "unresolved", reason: `network error: ${networkError}` };
  }
  const ct = String(contentType || "").toLowerCase().split(";")[0].trim();
  const served = status === 200 || status === 206;
  if (served && ct.startsWith("image/")) return { state: "alive", status, contentType: ct };
  if (served) {
    return {
      state: "dead", status, contentType: ct,
      reason: `served ${status} but content-type is "${ct || "(none)"}", not image/* — the share-card image is missing and the edge is serving an HTML/error shell in its place; every share of this surface previews a broken/blank card`,
    };
  }
  if (status >= 400 && status < 500) {
    return { state: "dead", status, contentType: ct, reason: `HTTP ${status} — the share-card image is missing, moved, or forbidden (dropped from deploy / re-rendered without shipping the new file)` };
  }
  return { state: "unresolved", status, contentType: ct, reason: `HTTP ${status || 0} — transient edge/infra response, not a positive object-gone signal` };
}

// ---- page fetch + image probe -------------------------------------------------
async function fetchPage(url) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 (website-integrity-bot funnel-share-card-live)" },
      });
      const body = await r.text().catch(() => "");
      return { status: r.status, body, finalUrl: r.url || url };
    } catch (e) {
      last = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160);
    }
  }
  return { networkError: last || "unknown" };
}

async function probeImage(url) {
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
      return { url, ...classifyImage({ status: r.status, contentType: r.headers.get("content-type") }) };
    } catch (e) {
      last = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 160);
    }
  }
  return { url, ...classifyImage({ networkError: last || "unknown" }) };
}

async function controlReachable(controlUrl) {
  try {
    const r = await fetch(controlUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
    return r.status === 204 || r.ok;
  } catch { return false; }
}

// ---- surface evaluation (one fetch + N image probes) --------------------------
// A rendering page that advertises no card image is DEAD (blank share). A page
// that is down/5xx/network is UNRESOLVED for its card — page liveness is another
// guard's job. Any dead image makes the surface dead; else any unresolved makes
// it unresolved; else alive.
async function evalSurface(surface) {
  const page = await fetchPage(surface.url);
  if (page.networkError) {
    return { ...surface, state: "unresolved", reason: `page fetch network error: ${page.networkError} — card not determinable (page-liveness guards own the outage)`, images: [] };
  }
  const served = page.status === 200 || page.status === 206;
  if (!served) {
    return { ...surface, state: "unresolved", reason: `page HTTP ${page.status} — card not determinable (page-liveness guards own a 4xx/5xx surface)`, images: [] };
  }
  const images = parseCardImages(page.body, page.finalUrl || surface.url);
  if (!images.length) {
    return { ...surface, state: "dead", reason: `page renders 200 but advertises NO og:image/twitter:image — every share of this surface previews with no image`, images: [] };
  }
  const probed = [];
  for (const img of images) probed.push({ ...img, ...(await probeImage(img.url)) });
  const dead = probed.filter((p) => p.state === "dead");
  const unresolved = probed.filter((p) => p.state === "unresolved");
  let state = "alive";
  if (dead.length) state = "dead";
  else if (unresolved.length) state = "unresolved";
  const reason = dead.length ? dead.map((d) => `${d.key} -> ${d.reason}`).join("; ")
    : unresolved.length ? unresolved.map((u) => `${u.key} -> ${u.reason}`).join("; ")
    : `${probed.length} card image(s) alive`;
  return { ...surface, state, reason, images: probed };
}

// ---- verdict (pure) -----------------------------------------------------------
// A "dead" is only trustworthy when the control proves our egress works (MP-291).
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

// ---- live run -----------------------------------------------------------------
async function run() {
  let brandSrc;
  try {
    brandSrc = readFileSync(BRAND_SOURCE, "utf8");
  } catch (e) {
    // The seed read is transient-ish (a missing file in a bad checkout); refuse
    // to assert any card dead. UNRESOLVED, never DEFECT.
    console.error(`[funnel-share-card-live] UNRESOLVED — cannot read brand source ${BRAND_SOURCE} (${e.message})`);
    process.exit(3);
  }
  const { surfaces, parseError } = parseSurfaces(brandSrc);
  if (parseError) {
    console.error(`[funnel-share-card-live] UNRESOLVED — ${parseError}`);
    process.exit(3);
  }

  const results = [];
  for (const s of surfaces) results.push(await evalSurface(s));
  const controlUp = await controlReachable(CONTROL);
  const { verdict, code, downgradeDead } = decideVerdict(results, controlUp);

  console.log(`[funnel-share-card-live] ${verdict} — ${surfaces.length} surface(s), control ${controlUp ? "UP" : "DOWN"}`);
  for (const r of results) {
    const mark = r.state === "alive" ? "🟢" : r.state === "dead" ? "🔴" : "🟡";
    console.log(`  ${mark} ${r.label}: ${r.state}${r.reason ? ` — ${r.reason}` : ""}`);
    for (const img of r.images || []) {
      if (img.url) console.log(`       ${img.key}: ${img.url} [${img.state}${img.contentType ? " " + img.contentType : ""}]`);
    }
  }
  if (downgradeDead) {
    console.log(`[funnel-share-card-live] a dead card was seen but the egress control (${CONTROL}) is unreachable, so this run's "dead" is NOT trusted (could be our network). Verdict downgraded to UNKNOWN; re-run when egress is up.`);
  }
  if (verdict === "DEFECT") {
    console.error(`[funnel-share-card-live] DEFECT — a sell4daddy funnel surface's social-share card (og:image/twitter:image) is DEAD on the live edge. Every share/DM/paste of that bio-link or door URL previews a broken/blank card on the #1-traffic funnel entry (84.4K TikTok + IG @sell4daddy). Fix: restore/redeploy the OG image on the sell4daddy Vercel project (it lives outside this repo). See per-surface lines above for the exact dead URL + status.`);
  }
  process.exit(code);
}

// ---- selftest: deterministic, local-only --------------------------------------
async function selftest() {
  let pass = 0, total = 0;
  const ok = (cond, msg) => { total++; if (cond) { pass++; console.log(`✓ ${msg}`); } else { console.log(`✗ ${msg}`); } };

  // 1. Pure image classifier, both directions. The shell masquerade is THE case.
  ok(classifyImage({ status: 200, contentType: "image/jpeg" }).state === "alive", "img 200 image/jpeg -> alive");
  ok(classifyImage({ status: 206, contentType: "image/png" }).state === "alive", "img 206 image/png -> alive");
  ok(classifyImage({ status: 200, contentType: "text/html; charset=utf-8" }).state === "dead", "img 200 text/html (shell masquerade) -> dead");
  ok(classifyImage({ status: 200, contentType: "application/json" }).state === "dead", "img 200 json error body -> dead");
  ok(classifyImage({ status: 404, contentType: "text/plain" }).state === "dead", "img 404 -> dead");
  ok(classifyImage({ status: 403, contentType: "text/plain" }).state === "dead", "img 403 -> dead");
  ok(classifyImage({ status: 503, contentType: "text/plain" }).state === "unresolved", "img 503 -> unresolved (transient)");
  ok(classifyImage({ networkError: "fetch failed" }).state === "unresolved", "img network error -> unresolved");
  ok(classifyImage({ status: 200, contentType: "" }).state === "dead", "img 200 no content-type -> dead (not an image)");

  // 2. Surface derivation from a brand.ts fixture (hub = door origin + 3 doors).
  const brandFixture = `
export const KEYWORDS: {}[] = [
  { key: "TEAM", door: "Join the Team", url: "https://sell4daddy.com/team", tone: "gold", reply: "x" },
  { key: "BODY", door: "The Standard Body", url: "https://sell4daddy.com/body", tone: "good", reply: "y" },
  { key: "BUILD", door: "Build Your Agency", url: "https://sell4daddy.com/build", tone: "royal", reply: "z" },
];`;
  const { surfaces, parseError } = parseSurfaces(brandFixture);
  ok(!parseError && surfaces.length === 4, `parse (KEYWORDS only) -> 4 surfaces (hub + 3 doors), got ${surfaces.length}${parseError ? " err:" + parseError : ""}`);
  ok(surfaces[0].key === "HUB" && surfaces[0].url === "https://sell4daddy.com/", "first surface is HUB at door origin root");
  ok(surfaces.some((s) => s.key === "TEAM" && s.url === "https://sell4daddy.com/team"), "TEAM door derived");
  ok(parseSurfaces("no keywords here").parseError !== null, "missing KEYWORDS -> parseError (refuse to assert)");
  ok(parseSurfaces("const KEYWORDS = [];").parseError !== null, "empty KEYWORDS -> parseError (refuse to assert)");
  // LANDING_DOORS (GLOWUP) joins the watched surface set: hub + 3 keyword doors + glowup.
  const withLanding = brandFixture + `
export const LANDING_DOORS: { key: string; door: string; url: string }[] = [
  { key: "GLOWUP", door: "The 30-Day Glow-Up", url: "https://sell4daddy.com/glowup" },
];`;
  const landed = parseSurfaces(withLanding);
  ok(!landed.parseError && landed.surfaces.length === 5, `parse (KEYWORDS + LANDING_DOORS) -> 5 surfaces (hub + 3 + glowup), got ${landed.surfaces.length}`);
  ok(landed.surfaces.some((s) => s.key === "GLOWUP" && s.url === "https://sell4daddy.com/glowup"), "GLOWUP landing door's card is watched");

  // 3. parseCardImages: og:image + twitter:image, dedupe, relative resolution.
  const html1 = `<meta property="og:image" content="https://sell4daddy.com/assets/og/home.jpg"><meta name="twitter:image" content="https://sell4daddy.com/assets/og/home.jpg">`;
  ok(parseCardImages(html1, "https://sell4daddy.com/").length === 1, "og+twitter same url -> deduped to 1");
  const html2 = `<meta property="og:image" content="/assets/og/team.jpg"><meta name="twitter:image" content="https://cdn.example/x.jpg">`;
  const imgs2 = parseCardImages(html2, "https://sell4daddy.com/team");
  ok(imgs2.length === 2 && imgs2[0].url === "https://sell4daddy.com/assets/og/team.jpg", "relative og:image resolved against page URL");
  ok(parseCardImages("<meta name=viewport content=x>", "https://x/").length === 0, "no og/twitter meta -> 0 images");
  const html3 = `<meta content="https://x/y.jpg" property="og:image">`;
  ok(parseCardImages(html3, "https://x/").length === 1, "reversed attr order (content before property) parsed");

  // 4. End-to-end evalSurface + verdict against a local server (faithful pipeline).
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    // a healthy surface: page 200 html advertising a live image
    if (path === "/good") { res.writeHead(200, { "content-type": "text/html" }); res.end(`<meta property="og:image" content="/img/live.jpg">`); return; }
    if (path === "/img/live.jpg") { res.writeHead(206, { "content-type": "image/jpeg" }); res.end("A"); return; }
    // a surface whose card points at a shell (200 text/html) -> dead
    if (path === "/shellcard") { res.writeHead(200, { "content-type": "text/html" }); res.end(`<meta property="og:image" content="/img/shell">`); return; }
    if (path === "/img/shell") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end("<!doctype html><html>…shell…</html>"); return; }
    // a surface whose card 404s -> dead
    if (path === "/card404") { res.writeHead(200, { "content-type": "text/html" }); res.end(`<meta property="og:image" content="/img/missing.jpg">`); return; }
    if (path === "/img/missing.jpg") { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
    // a surface that renders but advertises NO card image -> dead (blank share)
    if (path === "/nocard") { res.writeHead(200, { "content-type": "text/html" }); res.end(`<title>page</title>`); return; }
    // a surface whose page itself is down -> unresolved (not this guard's defect)
    if (path === "/pagedown") { res.writeHead(500, { "content-type": "text/plain" }); res.end("err"); return; }
    if (path === "/ctl") { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { "content-type": "application/json" }); res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const good = await evalSurface({ key: "G", url: `${origin}/good`, label: "good" });
  ok(good.state === "alive", "e2e surface /good (page + live image) -> alive");
  const shell = await evalSurface({ key: "S", url: `${origin}/shellcard`, label: "shellcard" });
  ok(shell.state === "dead", "e2e surface /shellcard (og:image -> 200 text/html shell) -> dead");
  const c404 = await evalSurface({ key: "C", url: `${origin}/card404`, label: "card404" });
  ok(c404.state === "dead", "e2e surface /card404 (og:image -> 404) -> dead");
  const nocard = await evalSurface({ key: "N", url: `${origin}/nocard`, label: "nocard" });
  ok(nocard.state === "dead", "e2e surface /nocard (page 200, no og:image) -> dead (blank share)");
  const down = await evalSurface({ key: "D", url: `${origin}/pagedown`, label: "pagedown" });
  ok(down.state === "unresolved", "e2e surface /pagedown (page 500) -> unresolved (page-liveness is another guard's job)");

  // 5. Control reachability, both directions (prove the UNKNOWN gate is real).
  const ctlUp = await controlReachable(`${origin}/ctl`);
  ok(ctlUp === true, "control /ctl reachable -> true");
  const ctlDown = await controlReachable(`${origin}/does-not-exist-zzz`);
  ok(ctlDown === false, "control missing -> false");

  // 6. Verdict wiring: dead+controlUp -> DEFECT; dead+controlDown -> UNKNOWN; all alive -> CLEAN; unresolved -> UNRESOLVED.
  ok(decideVerdict([good, shell], true).verdict === "DEFECT" && decideVerdict([good, shell], true).code === 1, "verdict dead + control up -> DEFECT(1)");
  const dc = decideVerdict([good, shell], false);
  ok(dc.verdict === "UNKNOWN" && dc.code === 0 && dc.downgradeDead === true, "verdict dead + control DOWN -> UNKNOWN(0), not trusted");
  ok(decideVerdict([good, good], true).verdict === "CLEAN" && decideVerdict([good, good], true).code === 0, "verdict all alive -> CLEAN(0)");
  ok(decideVerdict([good, down], true).verdict === "UNRESOLVED" && decideVerdict([good, down], true).code === 3, "verdict unresolved (no dead) -> UNRESOLVED(3)");
  // dead outranks unresolved
  ok(decideVerdict([down, shell], true).verdict === "DEFECT", "verdict dead outranks unresolved -> DEFECT");

  await new Promise((r) => server.close(r));
  console.log(`\n${pass}/${total} selftest checks passed`);
  process.exit(pass === total ? 0 : 1);
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  run();
}
