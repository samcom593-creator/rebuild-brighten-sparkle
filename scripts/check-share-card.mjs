#!/usr/bin/env node
// check-share-card.mjs: the link-share image must say the brand's current name.
//
// WHY (2026-10-08): 996492ce renamed the agency to Galaxy and swept ~1,000 strings with a
// lexer. The og:image was a PNG with "APEX FINANCIAL" baked into the pixels, so no text
// tool could see it, and every shared apex-financial.org link previewed the old name under
// a "Galaxy Financial" title. check:brand-literals cannot see this either: it reads source
// text, never images.
//
// The image is raster, so this guard grades it through its source:
//  1. og:image and twitter:image in index.html both point at the rendered image named in
//     scripts/data/share-card.json, and that file exists at a size chat apps will preview.
//  2. The SVG's sha256 matches the one recorded at render time. An SVG edited without
//     re-rendering means the image people see is not the SVG anyone reads.
//  3. The SVG's #wordmark equals platformName in src/config/brand.ts, uppercased. The next
//     rename changes brand.ts, and this goes red until the card is re-rendered.
//
// Fix for any failure: edit public/galaxy-recruit-og.svg if needed, then
//   node scripts/render-share-card.mjs
// and commit the SVG, the image and scripts/data/share-card.json together.
import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SITE = "https://apex-financial.org/";
const MAX_BYTES = 300 * 1024;
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");
const problems = [];

let manifest;
try {
  manifest = JSON.parse(read("scripts/data/share-card.json"));
  if (!manifest.svg || !manifest.image || !/^[0-9a-f]{64}$/.test(manifest.svg_sha256 ?? "")) throw new Error("missing svg/image/svg_sha256");
} catch (e) {
  console.error(`check:share-card: scripts/data/share-card.json unreadable (${e.message})`);
  process.exit(1);
}

const html = read("index.html");
const meta = (attr, key) => {
  const m = html.match(new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`));
  return m ? m[1] : null;
};
const expected = SITE + manifest.image.replace(/^public\//, "");
for (const [attr, key] of [["property", "og:image"], ["name", "twitter:image"]]) {
  const got = meta(attr, key);
  if (got !== expected) problems.push(`index.html ${key} is ${JSON.stringify(got)}, expected ${expected}`);
}

if (!existsSync(resolve(ROOT, manifest.image))) problems.push(`${manifest.image} does not exist`);
else {
  const size = statSync(resolve(ROOT, manifest.image)).size;
  if (size < 1024 || size > MAX_BYTES) problems.push(`${manifest.image} is ${size} bytes; must be 1 KB..${MAX_BYTES / 1024} KB to preview in chat apps`);
}

let svg = "";
if (!existsSync(resolve(ROOT, manifest.svg))) problems.push(`${manifest.svg} does not exist`);
else {
  svg = read(manifest.svg);
  const sha = createHash("sha256").update(svg).digest("hex");
  if (sha !== manifest.svg_sha256) problems.push(`${manifest.svg} changed since the image was rendered (sha256 ${sha.slice(0, 12)} vs recorded ${manifest.svg_sha256.slice(0, 12)})`);
}

const brandSrc = read("src/config/brand.ts");
const platform = brandSrc.slice(brandSrc.indexOf("export const APEX_BRAND")).match(/platformName:\s*"([^"]+)"/)?.[1];
const wordmark = svg.match(/<text\b[^>]*\bid="wordmark"[^>]*>([^<]*)<\/text>/)?.[1]?.trim();
if (!platform) problems.push("could not read platformName from src/config/brand.ts");
else if (wordmark !== platform.toUpperCase()) problems.push(`share card #wordmark is ${JSON.stringify(wordmark ?? null)}, brand.ts platformName is "${platform}"`);

if (problems.length) {
  console.error("check:share-card FAILED\n  " + problems.join("\n  ") + "\n  Fix: node scripts/render-share-card.mjs, then commit the SVG, image and scripts/data/share-card.json together.");
  process.exit(1);
}
console.log(`check:share-card OK: ${expected} (${wordmark}, svg ${manifest.svg_sha256.slice(0, 12)})`);
