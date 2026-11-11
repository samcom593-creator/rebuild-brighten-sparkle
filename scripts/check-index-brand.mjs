#!/usr/bin/env node
/**
 * index.html head brand-consistency guard.
 *
 * WHY THIS EXISTS (2026-11-10, Website Integrity Bot)
 * The Galaxy rebrand (2026-10-08, PL-GALAXY-AFLAC) renamed the agency from APEX
 * to Galaxy across the HTML head — <title>, description, og:*, twitter:title,
 * twitter:description all became "Galaxy Financial". But index.html:116 kept
 * reading `<meta name="twitter:site" content="@APEXFinancial" />` for over a
 * month. Every X/Twitter share of a recruiting link attributed the card to the
 * retired brand, at the exact moment a recruit decides.
 *
 * It survived because the brand-literal ratchet (scripts/check-brand-literals.mjs)
 * scopes to src/**.tsx?. It is blind to index.html — the SAME structural blind
 * spot that let the Calendly event-type name (check-calendly-brand.sh) and the
 * PWA manifest name (check-manifest-brand.mjs) drift for a month each. This is
 * the third surface of that class; index.html is now covered too.
 *
 * WHAT THIS GUARD CHECKS
 * Two brand surfaces a user or a machine reads: the user-FACING head values
 * (tab title, search snippet, social share card) AND the structured-data
 * (JSON-LD) blocks that Google rich results + AI-search/GEO engines read for
 * the Organization identity. For each, two rules:
 *
 *   POSITIVE  Every brand-name text field must contain the CURRENT brand, read
 *             live from the single source of truth (src/config/brand.ts
 *             platformName) — not a hardcoded token — so a FUTURE rebrand only
 *             edits brand.ts and this guard drags index.html along with it.
 *   NEGATIVE  No user-facing field (including the twitter handle fields) and no
 *             JSON-LD human-readable text field may contain the retired brand
 *             token "apex" that a user or a search engine sees.
 *
 * THE JSON-LD HALF (added 2026-11-11, Website Integrity Bot)
 * The <meta>/<title> pass is blind to <script type="application/ld+json">. The
 * Organization name Google shows in a Knowledge Panel and the answer ChatGPT/
 * Perplexity give to "who is Galaxy Financial" come from those blocks, not from
 * og:title. A JSON-LD name that reverted to "Apex" would stay GREEN while every
 * <meta> said Galaxy — the same one-surface-covered-sibling-open class this
 * guard was born to close (Calendly, then PWA manifest, then <meta>, now this).
 *   - A brand-bearing @type (Organization/LocalBusiness/WebSite/…) .name must
 *     carry the current brand (POSITIVE). Person.name ("Samuel James") and a
 *     VideoObject title are NOT forced to name the brand — only the NEGATIVE
 *     retired-token test applies to them.
 *   - Only human-readable text keys (name/legalName/description/headline/…) are
 *     token-tested. URL/path fields (url, logo, thumbnailUrl, contentUrl,
 *     embedUrl, sameAs) are skipped, so the apex-financial.org domain and the
 *     apex-vsl.mp4 storage filename never trip it.
 *
 * WHAT THIS GUARD DELIBERATELY DOES NOT TOUCH
 *   - The domain `apex-financial.org` (og:url, canonical, asset URLs). The
 *     domain legitimately stays Apex post-rebrand (memory: "domain/legal-pages/
 *     CONTENT_ACCOUNTS stay Apex on purpose"). It is allowlisted and stripped
 *     before the negative test.
 *   - The inline <script> in the head: BUMP_VERSION ("...-final-apex-vsl") and
 *     the localStorage keys (apex_bump_version, apex:theme:v2, apex_cache_busted)
 *     are INTERNAL identifiers, not user-facing. Renaming them force-busts every
 *     user's cache and resets their theme. This guard reads <meta>/<title> and
 *     JSON-LD text values only (never inline <script> code, never JSON-LD URL/
 *     path fields), so it never sees them.
 *
 * FAIL-LOUD: index.html missing, brand.ts unparseable, or the anchor fields
 * (<title> + og:title) not found all exit non-zero. A guard that cannot find
 * its operand must never report green (the 465 fake-success rows).
 *
 * Literal/structural check, no build. Testable instantly in both directions:
 * re-add `twitter:site content="@APEXFinancial"` and this prints FAIL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BRAND = join(ROOT, "src/config/brand.ts");
const INDEX = join(ROOT, "index.html");

function die(msg) {
  console.error(`❌ check:index-brand FAIL\n   ${msg}`);
  process.exit(1);
}

function read(path, label) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    die(`cannot read ${label} (${path}). A guard that can't find its operand is not green.`);
  }
}

// --- 1. current brand, live from brand.ts (same seam as check-manifest-brand) ---
const brandSrc = read(BRAND, "brand config");
const pm = brandSrc.match(/platformName:\s*"([^"]+)"/);
if (!pm) die("could not extract platformName from src/config/brand.ts");
const platform = pm[1]; // e.g. "Galaxy"

// --- 2. extract the user-facing head values -------------------------------
const indexSrc = read(INDEX, "index.html");
const found = new Map(); // lowercased key -> content value

const titleVal = (indexSrc.match(/<title\b[^>]*>([^<]*)<\/title>/i) || [])[1];
if (titleVal) found.set("__title__", titleVal.trim());

for (const tag of indexSrc.match(/<meta\b[^>]*>/gi) || []) {
  const key = (tag.match(/\b(?:name|property)\s*=\s*"([^"]+)"/i) || [])[1];
  const val = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || [])[1];
  if (key && val != null) found.set(key.toLowerCase(), val);
}

// Anchor fields: if these are absent, extraction broke — never report green.
if (!found.has("__title__")) die("no <title> found in index.html — guard cannot find its operand");
if (!found.has("og:title")) die("no og:title <meta> found in index.html — guard cannot find its operand");

// Brand-name text fields: must NAME the brand, so must carry platformName.
const BRAND_TEXT = [
  "__title__",
  "description",
  "author",
  "application-name",
  "apple-mobile-web-app-title",
  "og:title",
  "og:description",
  "og:site_name",
  "og:image:alt",
  "twitter:title",
  "twitter:description",
];
// Handle fields: may not contain the brand name (they hold an @handle), but
// still must never carry the retired brand token.
const HANDLE_FIELDS = ["twitter:site", "twitter:creator"];

// --- Rule POSITIVE: every present brand-text field carries the current brand ---
for (const key of BRAND_TEXT) {
  if (!found.has(key)) continue;
  const val = found.get(key);
  if (!val.toLowerCase().includes(platform.toLowerCase())) {
    die(`index.html ${key} = "${val}" does not carry the current brand "${platform}" ` +
        `(from src/config/brand.ts). If the brand changed, update brand.ts AND index.html together.`);
  }
}

// --- Rule NEGATIVE: no user-facing field carries the retired brand token ---
// The domain apex-financial.org legitimately stays Apex; strip it first so the
// og:url / asset URLs never trip this.
const ALLOWED_DOMAINS = [/apex-financial\.org/gi, /apexfinancialempire\.com/gi];
const RETIRED = /apex/i;
for (const key of [...BRAND_TEXT, ...HANDLE_FIELDS]) {
  if (!found.has(key)) continue;
  const val = found.get(key);
  let stripped = val;
  for (const re of ALLOWED_DOMAINS) stripped = stripped.replace(re, "");
  if (RETIRED.test(stripped)) {
    die(`index.html ${key} = "${val}" still carries the retired brand token "APEX" that a user ` +
        `sees in the tab title / search snippet / social share card. Update it to the current ` +
        `brand "${platform}" or remove the tag. (The domain apex-financial.org is allowlisted and ` +
        `not the trigger.)`);
  }
}

// --- 3. structured-data (JSON-LD) brand identity ---------------------------
// Google rich results and AI-search (GEO) engines read the Organization name
// from <script type="application/ld+json"> blocks, NOT from <meta>. Those
// blocks are a brand surface the <meta>/<title> pass above never sees.
const LD_BLOCKS = [
  ...indexSrc.matchAll(
    /<script\b[^>]*type\s*=\s*"application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  ),
].map((m) => m[1].trim());

if (LD_BLOCKS.length === 0) {
  die(
    'no <script type="application/ld+json"> block found in index.html — the ' +
      "site-wide Organization structured data Google reads is gone; a guard that " +
      "can't find its operand is not green.",
  );
}

// Human-readable text keys only — never URL/path fields, so apex-financial.org
// and the apex-vsl.mp4 storage filename never trip the retired-token test.
const LD_TEXT_KEYS = new Set([
  "name",
  "legalName",
  "alternateName",
  "description",
  "headline",
  "slogan",
  "caption",
]);
// @types whose .name IS the agency brand and must carry the current brand.
const LD_BRAND_TYPES = new Set([
  "Organization",
  "Corporation",
  "LocalBusiness",
  "WebSite",
  "FinancialService",
]);
const RETIRED_LD = /apex/i;

let sawOrgBrand = false;
function walkLd(node) {
  if (Array.isArray(node)) {
    for (const n of node) walkLd(n);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const t = typeof node["@type"] === "string" ? node["@type"] : null;
  // POSITIVE: a brand-bearing @type's name must carry the current brand.
  if (t && LD_BRAND_TYPES.has(t) && typeof node.name === "string") {
    if (!node.name.toLowerCase().includes(platform.toLowerCase())) {
      die(
        `index.html JSON-LD ${t}.name = "${node.name}" does not carry the current ` +
          `brand "${platform}" (from src/config/brand.ts). This is the Organization ` +
          `identity Google and AI search read. Update brand.ts AND the JSON-LD together.`,
      );
    }
    sawOrgBrand = true;
  }
  // NEGATIVE: no human-readable text field carries the retired brand token.
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "string") {
      if (LD_TEXT_KEYS.has(k) && RETIRED_LD.test(v)) {
        die(
          `index.html JSON-LD ${t || "?"}.${k} = "${v}" still carries the retired ` +
            `brand token "APEX" in structured data Google / AI search read. Update ` +
            `it to the current brand "${platform}".`,
        );
      }
    } else if (v && typeof v === "object") {
      walkLd(v);
    }
  }
}

for (const raw of LD_BLOCKS) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    die(
      `a <script type="application/ld+json"> block in index.html is not valid JSON ` +
        `(${e.message}). Malformed structured data is rejected by Google and the guard ` +
        `cannot verify its brand. Fix the JSON.`,
    );
  }
  walkLd(parsed);
}

if (!sawOrgBrand) {
  die(
    "no Organization/LocalBusiness/WebSite JSON-LD with a brand name found in " +
      "index.html — the site-wide brand identity Google reads is missing; guard " +
      "cannot confirm the brand.",
  );
}

console.log(
  `✅ check:index-brand OK — index.html head + JSON-LD carry brand "${platform}"; ` +
    `no retired "APEX" brand token in any user-facing <title>/<meta> value or ` +
    `structured-data text field.`,
);
