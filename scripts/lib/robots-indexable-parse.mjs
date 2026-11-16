/**
 * Pure robots/indexability parsers — the single detector for the repo's two
 * indexability guards.
 *
 * WHY THIS LIB EXISTS (MP-WIB-ROBOTS-LIVE, 2026-11-16). These four functions
 * were born inside check-robots-indexable.mjs (the SOURCE guard: reads
 * public/robots.txt + index.html + vercel.json + sitemap.xml from disk). The
 * LIVE-edge guard check-robots-indexable-live.mjs asks the SAME questions over
 * the wire — does the served robots.txt block a funnel path? does a served
 * route carry a noindex robots meta? — so it needs the SAME parsers. Importing
 * them from the source guard is impossible: that guard runs its audit at module
 * top level, so an import would execute it (and can process.exit). Copy-pasting
 * them is the 21-copies-of-strip-comments disease (see ./strip-comments.mjs):
 * one copy drifts, the two guards silently disagree about what "blocked" or
 * "noindex" means, and the newer live guard acquits a deindex the source guard
 * would have caught. One lib, both import, they cannot drift.
 *
 * All pure: strings in, structured facts out. No fs, no network, no process.
 */

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
