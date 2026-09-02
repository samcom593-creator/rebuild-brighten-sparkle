#!/usr/bin/env node
/**
 * Keep the homepage player, /vsl media record, preload, structured data, and
 * cache-bust marker on the same hosted VSL release.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HERO = resolve(ROOT, "src/components/landing/HeroSection.tsx");
const MEDIA = resolve(ROOT, "src/lib/vslMedia.ts");
const INDEX = resolve(ROOT, "index.html");

for (const file of [HERO, MEDIA, INDEX]) {
  if (!existsSync(file)) {
    console.error(`[check-vsl-sync] missing required file: ${file}`);
    process.exit(1);
  }
}

const hero = readFileSync(HERO, "utf8");
const media = readFileSync(MEDIA, "utf8");
const index = readFileSync(INDEX, "utf8");
const baseMatch = media.match(/const\s+VSL_MEDIA_BASE\s*=\s*["']([^"']+)["']/);

if (!baseMatch) {
  console.error("[check-vsl-sync] could not find VSL_MEDIA_BASE in src/lib/vslMedia.ts");
  process.exit(1);
}

const mediaBase = baseMatch[1];
const release = mediaBase.slice(mediaBase.lastIndexOf("/") + 1);
const videoUrl = `${mediaBase}/apex-vsl.mp4`;
const posterUrl = `${mediaBase}/apex-vsl-poster.jpg`;
const checks = [
  ["homepage video source", hero, "VSL_VIDEO.src"],
  ["homepage video poster", hero, "VSL_VIDEO.poster"],
  ["poster preload", index, `href="${posterUrl}"`],
  ["VideoObject thumbnailUrl", index, `"thumbnailUrl":"${posterUrl}"`],
  ["VideoObject contentUrl", index, `"contentUrl":"${videoUrl}"`],
  ["VideoObject embedUrl", index, '"embedUrl":"https://apex-financial.org/vsl"'],
];

const drift = checks
  .filter(([, source, expected]) => !source.includes(expected))
  .map(([label, , expected]) => `  - ${label}: missing ${expected}`);

const bumpMatch = index.match(/var\s+BUMP_VERSION\s*=\s*"([^"]+)"/);
if (!bumpMatch) {
  drift.push('  - BUMP_VERSION: missing `var BUMP_VERSION = "..."`');
} else if (!bumpMatch[1].includes(release)) {
  drift.push(`  - BUMP_VERSION: "${bumpMatch[1]}" does not contain release ${release}`);
}

if (drift.length > 0) {
  console.error(`[check-vsl-sync] references drifted from canonical VSL release ${release}:`);
  console.error(drift.join("\n"));
  process.exit(1);
}

console.log(`[check-vsl-sync] OK — homepage and metadata use canonical VSL release ${release}`);
