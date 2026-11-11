#!/usr/bin/env node
/**
 * Edge-function SVG brand guard — retired brand burned onto shared images.
 *
 * WHY THIS EXISTS (2026-11-10, Website Integrity Bot)
 * The Galaxy rebrand (2026-10-08, PL-GALAXY-AFLAC) renamed the agency from APEX
 * to Galaxy. Two edge functions that render recognition graphics kept burning
 * the retired brand's social handle onto the image footer:
 *
 *   supabase/functions/render-all-plaques/index.ts   — "@APEX.FINANCIAL"
 *   supabase/functions/generate-monthly-awards/index.ts — "@APEX.FINANCIAL"
 *
 * Both rebranded the big HEADER/title to "Galaxy" and MISSED the small footer
 * handle sitting right beside a correct "GALAXY FINANCIAL" mark. A plaque is a
 * magazine-quality graphic an agent EARNS and posts to social — so the dead
 * brand's @handle went out on every award an agent shared publicly, long after
 * the agency was renamed. render-all-plaques is live (AwardsGallery.tsx +
 * overseer-bot auto-fix); generate-monthly-awards renders the monthly bundle.
 *
 * It survived because every brand ratchet is blind here. check-brand-literals
 * scopes to src/**.tsx?; check-index-brand to index.html; check-manifest-brand
 * to vite.config.ts/public; check-calendly-brand lives outside the repo. The
 * SAME structural blind spot (a surface the src/-only ratchet can't see) let
 * the Calendly event name, the PWA manifest, and index.html's twitter:site
 * each drift for a month. supabase/functions/ is the next surface in that class
 * — and uniquely dangerous because its output is an IMAGE a recruit screenshots
 * and reposts, not a string a reader skims.
 *
 * WHAT THIS GUARD CHECKS
 * NEGATIVE only: no retired brand token "apex" may appear inside the VISIBLE
 * content of a rendered SVG text node — <text>...</text> or <tspan>...</tspan>
 * — in any edge-function .ts file. That content is exactly what gets drawn
 * onto the pixels a user sees. Agent names, dollar amounts and dates also live
 * in <text>, so this is scoped to the retired BRAND token, not all copy.
 *
 * WHAT THIS GUARD DELIBERATELY DOES NOT TOUCH
 *   - Code identifiers (apexBranding(), raiseApexAlert), comments ("Per the
 *     APEX Operating Contract"), the domain apex-financial.org / Calendly org
 *     apexfinancialempire.com, DB identifiers (apex_*), and email/test
 *     fixtures (@APEX.COM in a .test.ts). None of those render onto an image;
 *     the <text>/<tspan> scope excludes them and *.test.ts is skipped.
 *   - The live domain inside a text node (e.g. a card rendering the website
 *     URL) stays Apex by design (memory: "domain/legal-pages stay Apex on
 *     purpose") — allowlisted and stripped before the negative test.
 *
 * FAIL-LOUD: if brand.ts is unparseable or the functions tree yields zero .ts
 * files, the scan seam is broken and this exits non-zero. A guard that cannot
 * find its operand must never report green (the 465 fake-success rows).
 *
 * Literal/structural check, no build. Testable instantly in both directions:
 * re-add `<text ...>@APEX.FINANCIAL</text>` to any function and this prints FAIL.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BRAND = join(ROOT, "src/config/brand.ts");
const FUNCS = join(ROOT, "supabase/functions");

function die(msg) {
  console.error(`❌ check:edge-svg-brand FAIL\n   ${msg}`);
  process.exit(1);
}

// --- current brand, live from brand.ts (same seam as check-index-brand) ---
let platform = "the current brand";
try {
  const pm = readFileSync(BRAND, "utf8").match(/platformName:\s*"([^"]+)"/);
  if (!pm) die("could not extract platformName from src/config/brand.ts");
  platform = pm[1]; // e.g. "Galaxy"
} catch (e) {
  if (e && e.code === "EACCES") throw e;
  die(`cannot read brand config (${BRAND}). A guard that can't find its operand is not green.`);
}

// --- collect every edge-function .ts (skip tests + generated) -------------
function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    die(`cannot read ${dir} — the edge-function tree is the operand; scan seam broken.`);
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__pycache__") continue;
      out = out.concat(walk(p));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(FUNCS);
if (files.length === 0) die("found 0 edge-function .ts files — scan seam broken, refusing to report green.");

// --- NEGATIVE rule: no retired brand token inside rendered text nodes -----
// [^<]* stops at the next tag boundary, so interpolations like ${esc(label)}
// (no '<') are captured and harmlessly carry no literal "apex".
const TEXT_NODE = /<(text|tspan)\b[^>]*>([^<]*)<\/\1>/gi;
const ALLOWED_DOMAINS = [/apex-financial\.org/gi, /apexfinancialempire\.com/gi];
const RETIRED = /apex/i;

const leaks = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  // precompute line starts for line numbers
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  for (const m of src.matchAll(TEXT_NODE)) {
    let content = m[2];
    for (const re of ALLOWED_DOMAINS) content = content.replace(re, "");
    if (RETIRED.test(content)) {
      leaks.push({
        file: file.slice(ROOT.length),
        line: lineOf(m.index),
        text: m[2].trim().slice(0, 80),
      });
    }
  }
}

if (leaks.length > 0) {
  const detail = leaks
    .map((l) => `   ${l.file}:${l.line}  <${"text"}> "${l.text}"`)
    .join("\n");
  die(
    `retired brand token "APEX" is rendered inside an SVG text node — it gets ` +
      `drawn onto the recognition graphic a recruit/agent screenshots and reposts ` +
      `publicly. Change it to the current brand "${platform}" (match the clean ` +
      `siblings generate-award-graphics / send-plaque-recognition, which render ` +
      `the brand NAME, not an unverified @handle):\n${detail}`
  );
}

console.log(
  `✅ check:edge-svg-brand OK — ${files.length} edge-function files scanned; ` +
    `no retired "APEX" brand token in any rendered <text>/<tspan> (brand "${platform}").`
);
