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
 * Only the user-FACING head values (the ones a user reads in a tab title, a
 * search snippet or a social share card) are checked. Two rules:
 *
 *   POSITIVE  Every brand-name text field must contain the CURRENT brand, read
 *             live from the single source of truth (src/config/brand.ts
 *             platformName) — not a hardcoded token — so a FUTURE rebrand only
 *             edits brand.ts and this guard drags index.html along with it.
 *   NEGATIVE  No user-facing field (including the twitter handle fields) may
 *             contain the retired brand token "apex" that a user can see.
 *
 * WHAT THIS GUARD DELIBERATELY DOES NOT TOUCH
 *   - The domain `apex-financial.org` (og:url, canonical, asset URLs). The
 *     domain legitimately stays Apex post-rebrand (memory: "domain/legal-pages/
 *     CONTENT_ACCOUNTS stay Apex on purpose"). It is allowlisted and stripped
 *     before the negative test.
 *   - The inline <script> in the head: BUMP_VERSION ("...-final-apex-vsl") and
 *     the localStorage keys (apex_bump_version, apex:theme:v2, apex_cache_busted)
 *     are INTERNAL identifiers, not user-facing. Renaming them force-busts every
 *     user's cache and resets their theme. This guard reads <meta>/<title>
 *     VALUES only, so it never sees them.
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

console.log(`✅ check:index-brand OK — index.html head carries brand "${platform}"; ` +
            `no retired "APEX" brand token in any user-facing <title>/<meta> value.`);
