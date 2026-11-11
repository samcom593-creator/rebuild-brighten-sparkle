#!/usr/bin/env node
/**
 * Robots / indexability guard — the recruiting funnel must stay crawlable.
 *
 * WHY THIS EXISTS (2026-11-11, Website Integrity Bot, Check #3/SEO)
 * apex-financial.org is the agency's recruiting funnel; its organic inbound
 * ("insurance sales career", "get licensed", the /careers Google-for-Jobs
 * pages) is a load-bearing lead source. One line flips the whole thing dark:
 *
 *   • public/robots.txt gains  `Disallow: /`  (or a Disallow over a funnel path)
 *   • index.html gains         `<meta name="robots" content="noindex">`
 *   • vercel.json adds a header `X-Robots-Tag: noindex` on the catch-all source
 *   • a page component injects  a robots=noindex meta into the rendered <head>
 *
 * Every one of these returns HTTP 200 and renders a perfect page — invisible to
 * a status-code probe, a body-grep, or a Lighthouse pass. The only symptom is
 * that weeks later the funnel silently leaves Google's index. This is the exact
 * class as the 2026-11-10 canonical self-sabotage (sitemap said "index these"
 * while the canonical said "/" — the two signals contradicted and Google
 * dropped the deep routes), one notch MORE severe: a canonical dedupes a page
 * onto "/", a noindex removes it entirely.
 *
 * Nothing in the 129-guard suite watched robots/noindex before this. Verified
 * live 2026-11-11: robots.txt is `Allow: /` for every agent, no X-Robots-Tag
 * header, no robots meta in the shell or in src — the funnel is fully
 * indexable. This guard locks that in so a future edit can't silently undo it.
 *
 * THE OPERAND IS THE SITEMAP. public/sitemap.xml is the list of URLs we tell
 * Google to index. The invariant is: every one of those URLs must be crawlable
 * per robots.txt AND must not be noindexed anywhere. Tying the two files
 * together is the whole point — a contradiction between "please index X" and
 * "do not index X" is what the canonical bug was, and it must turn CI red.
 *
 * FOUR RULES (all static, no build, no network; prove both directions with
 * --selftest):
 *
 *   A  robots.txt is present + parseable, carries a `Sitemap:` line on the prod
 *      host, and NO sitemap funnel path is blocked for the general crawler (`*`)
 *      or for Googlebot/Bingbot. Blocked is computed with Google's real
 *      most-specific-match-wins / Allow-breaks-ties algorithm, so an `Allow`
 *      override is honored and a literal `Disallow: /` is caught.
 *
 *   B  index.html carries NO robots/googlebot meta whose content includes
 *      `noindex` or `none`. (A crawler renders JS, but it also reads the static
 *      shell; a noindex in either place deindexes every SPA route the rewrite
 *      serves this shell for.)
 *
 *   C  vercel.json sets NO `X-Robots-Tag` header with a noindex/none value on a
 *      source that covers a funnel route (the `/(.*)` catch-all especially).
 *
 *   D  src/** injects NO `noindex` into the rendered <head> — the token
 *      `noindex` (comment-stripped) is banned from src entirely. It has exactly
 *      one purpose, and a public funnel page has no business carrying it. A
 *      genuinely-private surface that must be noindexed (none exist today; admin
 *      is auth-gated and absent from the sitemap) adds an explicit ALLOWLIST
 *      entry, making the deindex a deliberate, reviewed act instead of a silent
 *      drift. Baseline is 0 — a pure ratchet.
 *
 * FAIL-LOUD: any operand missing/unparseable, or robots.txt with no usable
 * rules, exits non-zero. A guard that cannot find its operand must never report
 * green (the 465 fake-success rows).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const ROBOTS = join(ROOT, "public/robots.txt");
const INDEX = join(ROOT, "index.html");
const VERCEL = join(ROOT, "vercel.json");
const SITEMAP = join(ROOT, "public/sitemap.xml");
const SRC = join(ROOT, "src");
const PROD_HOST = "apex-financial.org";

// A src file may legitimately carry the `noindex` token only if it CANNOT
// inject a head tag — a pure data/prose module rendered as React-escaped text,
// or a genuinely private non-sitemap surface. Adding one here forces the
// decision to be a reviewed, deliberate act. Paths are repo-relative.
//   - src/data/shipped-data.ts is the SHIPPED banner's data: its strings are
//     rendered as escaped text ({item.detail}), so a "<meta ...noindex>" in a
//     string literal displays as literal characters and never reaches the DOM
//     head. This guard's own ship-note documents the noindex attack here, so
//     the file names the token without ever being able to perform it.
const ALLOWLIST = new Set(["src/data/shipped-data.ts"]);

// ── pure extractors ─────────────────────────────────────────────────────────

/** <loc> inner-text paths (pathname only) from a sitemap, on the prod host. */
export function sitemapPaths(xml) {
  const out = [];
  for (const t of xml.match(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi) || []) {
    const raw = t.replace(/<\/?loc>/gi, "").trim();
    try {
      const u = new URL(raw);
      out.push({ path: u.pathname || "/", host: u.host });
    } catch {
      out.push({ path: null, host: null, raw });
    }
  }
  return out;
}

/**
 * Parse robots.txt into { "<user-agent-lower>": {allow:[], disallow:[]} } and a
 * list of Sitemap: directives. Consecutive `User-agent:` lines share the rules
 * that follow (the robots.txt grouping rule).
 */
export function parseRobots(txt) {
  const groups = {};
  const sitemaps = [];
  let current = []; // user-agents the next rule block applies to
  let sawRuleSinceUA = false;
  for (const lineRaw of txt.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      // A UA line after a rule block starts a NEW group set.
      if (sawRuleSinceUA) {
        current = [];
        sawRuleSinceUA = false;
      }
      const ua = value.toLowerCase();
      current.push(ua);
      if (!groups[ua]) groups[ua] = { allow: [], disallow: [] };
    } else if (field === "allow" || field === "disallow") {
      sawRuleSinceUA = true;
      for (const ua of current.length ? current : ["*"]) {
        if (!groups[ua]) groups[ua] = { allow: [], disallow: [] };
        groups[ua][field].push(value);
      }
    } else if (field === "sitemap") {
      sitemaps.push(value);
    }
  }
  return { groups, sitemaps };
}

/** Does a robots path pattern match `path`? Supports `*` glob and `$` end-anchor. */
function ruleMatches(pattern, path) {
  // Empty pattern matches nothing meaningful (an empty Disallow = "allow all").
  if (pattern === "") return false;
  let anchorEnd = false;
  let pat = pattern;
  if (pat.endsWith("$")) {
    anchorEnd = true;
    pat = pat.slice(0, -1);
  }
  const rx =
    "^" +
    pat
      .split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*") +
    (anchorEnd ? "$" : "");
  return new RegExp(rx).test(path);
}

/**
 * Is `path` blocked for a user-agent group? Google's algorithm: among all
 * Allow/Disallow rules that match, the MOST SPECIFIC (longest pattern) wins;
 * on a tie Allow wins. No matching rule → allowed.
 */
export function isBlocked(path, group) {
  if (!group) return false;
  let best = null; // { len, type }
  for (const type of ["allow", "disallow"]) {
    for (const pat of group[type]) {
      if (!ruleMatches(pat, path)) continue;
      const len = pat.replace(/\$$/, "").length;
      if (!best || len > best.len || (len === best.len && type === "allow")) {
        best = { len, type };
      }
    }
  }
  return best ? best.type === "disallow" : false;
}

/** robots/googlebot <meta> tags whose content carries a noindex/none token. */
export function noindexMetas(html) {
  const out = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = (tag.match(/\bname\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (!name || !/^(robots|googlebot)$/i.test(name.trim())) continue;
    const content = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (/\b(noindex|none)\b/i.test(content)) out.push(tag);
  }
  return out;
}

/**
 * vercel.json header entries that set X-Robots-Tag to noindex/none on a source
 * covering funnel routes. Returns the offending [source, value] pairs.
 */
export function vercelNoindexHeaders(vercelJson) {
  let cfg;
  try {
    cfg = JSON.parse(vercelJson);
  } catch {
    return { parseError: true, hits: [] };
  }
  const hits = [];
  for (const block of cfg.headers || []) {
    const source = block.source || "";
    // Does this source cover a funnel route? The catch-all and root do; so does
    // any source that isn't scoped to a specific non-page asset.
    const coversFunnel =
      /^\/\(\.\*\)/.test(source) ||
      source === "/" ||
      /^\/(apply|vsl|get-licensed|careers)/.test(source) ||
      source === "/(.*)";
    for (const h of block.headers || []) {
      if (!/^x-robots-tag$/i.test((h.key || "").trim())) continue;
      if (/\b(noindex|none)\b/i.test(h.value || "") && coversFunnel) {
        hits.push([source, h.value]);
      }
    }
  }
  return { parseError: false, hits };
}

// ── the audit (pure: strings in, failures out) ──────────────────────────────

export function audit({ robotsTxt, indexHtml, vercelJson, sitemapXml, srcFiles }) {
  const fail = [];

  // Operand: the sitemap is the authoritative set of URLs we ask Google to index.
  const locs = sitemapPaths(sitemapXml);
  const funnelPaths = [];
  if (locs.length === 0) {
    fail.push("sitemap.xml: no <loc> entries — cannot determine which URLs must stay indexable (empty/unparseable).");
  }
  for (const l of locs) {
    if (l.path == null) {
      fail.push(`sitemap.xml: <loc>${l.raw}</loc> is not a valid URL.`);
    } else {
      funnelPaths.push(l.path);
    }
  }

  // ── Rule A: robots.txt doesn't block any funnel path ──
  if (!robotsTxt || !robotsTxt.trim()) {
    fail.push("robots.txt: missing or empty — a served-but-empty robots.txt is one keystroke from `Disallow: /`; ship an explicit Allow.");
  } else {
    const { groups, sitemaps } = parseRobots(robotsTxt);
    const star = groups["*"];
    if (!star && Object.keys(groups).length === 0) {
      fail.push("robots.txt: no User-agent groups parsed — unparseable, cannot verify crawlability.");
    }
    if (sitemaps.length === 0) {
      fail.push("robots.txt: no `Sitemap:` directive — the sitemap and robots.txt must stay tied (the canonical bug was two SEO signals disagreeing).");
    } else if (!sitemaps.some((s) => s.includes(PROD_HOST))) {
      fail.push(`robots.txt: no Sitemap: line points at ${PROD_HOST} (found ${JSON.stringify(sitemaps)}).`);
    }
    // The crawlers that matter for a recruiting funnel. Each falls back to `*`.
    for (const ua of ["*", "googlebot", "bingbot"]) {
      const group = groups[ua] || star;
      for (const p of funnelPaths) {
        if (isBlocked(p, group)) {
          fail.push(`robots.txt: funnel path "${p}" is Disallowed for user-agent "${ua}" — it is in sitemap.xml (we ask Google to index it) yet blocked from crawling. Contradictory signals deindex it.`);
        }
      }
    }
  }

  // ── Rule B: no noindex robots meta in the static shell ──
  for (const tag of noindexMetas(indexHtml)) {
    fail.push(`index.html: robots meta carries noindex/none — deindexes every SPA route served this shell: ${tag}`);
  }

  // ── Rule C: no noindex X-Robots-Tag header on the funnel ──
  const vh = vercelNoindexHeaders(vercelJson);
  if (vh.parseError) {
    fail.push("vercel.json: unparseable JSON — cannot verify X-Robots-Tag headers.");
  }
  for (const [source, value] of vh.hits) {
    fail.push(`vercel.json: header source "${source}" sets X-Robots-Tag: "${value}" over funnel routes — deindexes them at the edge, before render.`);
  }

  // ── Rule D: src injects no noindex into the rendered head ──
  for (const { path, raw } of srcFiles || []) {
    if (ALLOWLIST.has(path)) continue;
    const code = stripComments(raw);
    if (/\bnoindex\b/i.test(code)) {
      fail.push(`${path}: contains a \`noindex\` token in code — a page that injects a robots=noindex meta deindexes a public route. If this surface is genuinely private, add it to the ALLOWLIST in this guard (none exist today).`);
    }
  }

  return fail;
}

// ── selftest: prove the detector fires on each tampering ─────────────────────

function selftest() {
  const GOOD = {
    robotsTxt:
      "User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nAllow: /\n\n" +
      "Sitemap: https://apex-financial.org/sitemap.xml\n",
    indexHtml: '<head><meta charset="utf-8" /><link rel="canonical" href="https://apex-financial.org" /></head>',
    vercelJson: JSON.stringify({
      headers: [
        { source: "/(.*)", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] },
      ],
    }),
    sitemapXml:
      "<loc>https://apex-financial.org/</loc><loc>https://apex-financial.org/apply</loc>" +
      "<loc>https://apex-financial.org/vsl</loc>",
    srcFiles: [{ path: "src/pages/Apply.tsx", raw: "export const Apply = () => <div>apply</div>;" }],
  };

  const cases = [
    ["GOOD passes", GOOD, 0],
    // Rule A
    ["robots Disallow: / blocks everything", {
      ...GOOD,
      robotsTxt: "User-agent: *\nDisallow: /\nSitemap: https://apex-financial.org/sitemap.xml",
    }, 1],
    ["robots Disallow /apply blocks a funnel path", {
      ...GOOD,
      robotsTxt: "User-agent: *\nDisallow: /apply\nSitemap: https://apex-financial.org/sitemap.xml",
    }, 1],
    ["robots Disallow Googlebot only still caught", {
      ...GOOD,
      robotsTxt: "User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /\nSitemap: https://apex-financial.org/sitemap.xml",
    }, 1],
    // Allow-override: a broad `Disallow: /` with an explicit Allow per funnel
    // path (incl. `/$` for root) is NOT a block — most-specific-wins, Allow
    // breaks ties. Proves the algorithm honors overrides instead of flagging
    // any Disallow. (The unguarded broad `Disallow: /` is the case above.)
    ["robots Allow override of every funnel path is crawlable", {
      ...GOOD,
      robotsTxt: "User-agent: *\nDisallow: /\nAllow: /apply\nAllow: /vsl\nAllow: /$\nSitemap: https://apex-financial.org/sitemap.xml",
    }, 0],
    ["robots missing Sitemap line", {
      ...GOOD,
      robotsTxt: "User-agent: *\nAllow: /",
    }, 1],
    ["robots empty", { ...GOOD, robotsTxt: "" }, 1],
    // Rule B
    ["index.html robots noindex meta", {
      ...GOOD,
      indexHtml: GOOD.indexHtml.replace("</head>", '<meta name="robots" content="noindex, nofollow" /></head>'),
    }, 1],
    ["index.html googlebot none meta", {
      ...GOOD,
      indexHtml: GOOD.indexHtml.replace("</head>", '<meta name="googlebot" content="none" /></head>'),
    }, 1],
    ["index.html benign robots index,follow is fine", {
      ...GOOD,
      indexHtml: GOOD.indexHtml.replace("</head>", '<meta name="robots" content="index, follow" /></head>'),
    }, 0],
    // Rule C
    ["vercel X-Robots-Tag noindex on catch-all", {
      ...GOOD,
      vercelJson: JSON.stringify({
        headers: [{ source: "/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex" }] }],
      }),
    }, 1],
    ["vercel X-Robots-Tag noindex on scoped asset is NOT a funnel block", {
      ...GOOD,
      vercelJson: JSON.stringify({
        headers: [{ source: "/private-asset.json", headers: [{ key: "X-Robots-Tag", value: "noindex" }] }],
      }),
    }, 0],
    ["vercel unparseable", { ...GOOD, vercelJson: "{ not json" }, 1],
    // Rule D
    ["src injects noindex", {
      ...GOOD,
      srcFiles: [{ path: "src/pages/Apply.tsx", raw: 'setMeta("robots", "noindex");' }],
    }, 1],
    ["src noindex only in a comment is ignored", {
      ...GOOD,
      srcFiles: [{ path: "src/pages/Apply.tsx", raw: "// never add noindex here\nexport const Apply = () => null;" }],
    }, 0],
    ["allowlisted prose data file carrying noindex is NOT flagged", {
      ...GOOD,
      srcFiles: [{ path: "src/data/shipped-data.ts", raw: 'const d = "describes a noindex meta attack";' }],
    }, 0],
    ["a NON-allowlisted file with the same noindex prose IS flagged", {
      ...GOOD,
      srcFiles: [{ path: "src/pages/Other.tsx", raw: 'const d = "describes a noindex meta attack";' }],
    }, 1],
    // fail-loud
    ["sitemap empty", { ...GOOD, sitemapXml: "<urlset></urlset>" }, 1],
  ];

  let ok = true;
  for (const [name, input, wantAtLeast] of cases) {
    const got = audit(input);
    const pass = wantAtLeast === 0 ? got.length === 0 : got.length >= wantAtLeast;
    if (!pass) {
      ok = false;
      console.error(`  ✗ selftest "${name}": expected ${wantAtLeast === 0 ? "no" : ">=1"} failures, got ${got.length}: ${JSON.stringify(got)}`);
    } else {
      console.log(`  ✓ selftest "${name}" (${got.length} failures)`);
    }
  }
  if (!ok) {
    console.error("❌ check:robots-indexable --selftest FAILED");
    process.exit(1);
  }
  console.log("✅ check:robots-indexable --selftest OK (detector fires in both directions)");
}

// ── main ─────────────────────────────────────────────────────────────────────

function read(path, label) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.error(`❌ check:robots-indexable FAIL\n   cannot read ${label} (${path}). A guard that can't find its operand is not green.`);
    process.exit(1);
  }
}

/** Recursively collect src files that could carry a noindex (cheap pre-filter). */
function collectSrc(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...collectSrc(full));
    } else if (/\.(tsx?|jsx?|html)$/.test(name)) {
      let raw;
      try {
        raw = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      // Only files that mention robots/noindex can possibly fail Rule D.
      if (/noindex/i.test(raw) || /\brobots\b/i.test(raw)) {
        out.push({ path: full.slice(ROOT.length), raw });
      }
    }
  }
  return out;
}

if (process.argv.includes("--selftest")) {
  selftest();
} else {
  const failures = audit({
    robotsTxt: read(ROBOTS, "public/robots.txt"),
    indexHtml: read(INDEX, "index.html"),
    vercelJson: read(VERCEL, "vercel.json"),
    sitemapXml: read(SITEMAP, "public/sitemap.xml"),
    srcFiles: collectSrc(SRC),
  });
  if (failures.length) {
    console.error(`❌ check:robots-indexable FAIL (${failures.length})`);
    for (const f of failures) console.error(`   • ${f}`);
    process.exit(1);
  }
  console.log("✅ check:robots-indexable OK — robots.txt allows every sitemap funnel path for */Googlebot/Bingbot and ties to the prod sitemap; no noindex robots meta in index.html; no noindex X-Robots-Tag header over funnel routes in vercel.json; no noindex injected from src.");
}
