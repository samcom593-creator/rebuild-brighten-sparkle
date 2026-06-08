#!/usr/bin/env node
/**
 * check-vsl-sync — standalone port of vite.config.ts apex-vsl-sync-check plugin.
 *
 * The plugin runs at build start and fails any Vite build when index.html's VSL
 * references drift from HeroSection.tsx's <LazyYouTube videoId="..."> — but the
 * 2026-06-07 wave-27 cross-session race (commits e24adf69 -> 2ec9b695 -> 2b21d6df)
 * proved that the plugin only catches drift on the NEXT build (i.e., on Vercel,
 * after the bad commit has already been pushed). Local pre-commit catches it
 * before push, so a parallel session can't ship a state that fails the rule it
 * just enforced.
 *
 * Same 5 drift surfaces as the Vite plugin:
 *   1. <link rel="preload"> i.ytimg.com hqdefault.jpg
 *   2. VideoObject thumbnailUrl
 *   3. VideoObject contentUrl
 *   4. VideoObject embedUrl
 *   5. BUMP_VERSION must contain current videoId
 *
 * Exit 0 = synced. Exit 1 = drift with full diff + fix instructions.
 *
 * Usage:
 *   node scripts/check-vsl-sync.mjs
 *
 * Wired into:
 *   - .husky/pre-commit (blocks bad commits locally)
 *   - package.json scripts.check:vsl-sync + verify:core
 *   - vite.config.ts vslSyncCheckPlugin (final ratchet at Vercel build)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const HERO = resolve(ROOT, "src/components/landing/HeroSection.tsx");
const INDEX = resolve(ROOT, "index.html");

if (!existsSync(HERO) || !existsSync(INDEX)) {
  console.error(`[check-vsl-sync] missing source files (HERO=${existsSync(HERO)}, INDEX=${existsSync(INDEX)}). Run from repo root.`);
  process.exit(1);
}

const hero = readFileSync(HERO, "utf8");
const index = readFileSync(INDEX, "utf8");

const heroMatch = hero.match(/<LazyYouTube\s+videoId="([A-Za-z0-9_-]{8,15})"/);
if (!heroMatch) {
  console.error('[check-vsl-sync] could not find <LazyYouTube videoId="..."> in src/components/landing/HeroSection.tsx — has the hero VSL component been renamed? Update vite.config.ts vslSyncCheckPlugin regex AND this script.');
  process.exit(1);
}
const heroId = heroMatch[1];

const checks = [
  { label: '<link rel="preload"> i.ytimg.com poster', pattern: /i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{8,15})\/hqdefault\.jpg/g },
  { label: 'VideoObject thumbnailUrl',                pattern: /"thumbnailUrl":"https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{8,15})\/hqdefault\.jpg"/g },
  { label: 'VideoObject contentUrl',                  pattern: /"contentUrl":"https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{8,15})"/g },
  { label: 'VideoObject embedUrl',                    pattern: /"embedUrl":"https:\/\/www\.youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{8,15})"/g },
];

const drift = [];
for (const { label, pattern } of checks) {
  const ids = Array.from(index.matchAll(pattern), (m) => m[1]);
  if (ids.length === 0) {
    drift.push(`  - ${label}: no match found in index.html (expected ${heroId})`);
    continue;
  }
  for (const id of ids) {
    if (id !== heroId) {
      drift.push(`  - ${label}: index.html=${id} but HeroSection.tsx=${heroId}`);
    }
  }
}

const bumpMatch = index.match(/var\s+BUMP_VERSION\s*=\s*"([^"]+)"/);
if (!bumpMatch) {
  drift.push('  - BUMP_VERSION: could not locate `var BUMP_VERSION = "..."` in index.html cache-bust script');
} else if (!bumpMatch[1].includes(heroId)) {
  drift.push(`  - BUMP_VERSION: "${bumpMatch[1]}" does not contain current videoId ${heroId} — caches will not evict on this swap`);
}

if (drift.length > 0) {
  console.error(`[check-vsl-sync] index.html VSL references DRIFTED from HeroSection.tsx LazyYouTube videoId="${heroId}":`);
  console.error(drift.join("\n"));
  console.error(`\nFix: update every i.ytimg.com / youtube.com / youtube-nocookie.com URL in index.html to videoId ${heroId}, AND bump the BUMP_VERSION string in the cache-bust script at index.html:14 to include "${heroId}" (e.g. "2026-MM-DD-new-vsl-${heroId}"). The wave-25 regression (commit 2da7ddc7) is exactly what this guard prevents.`);
  process.exit(1);
}

console.log(`[check-vsl-sync] OK — all 5 index.html surfaces match HeroSection.tsx videoId="${heroId}"`);
process.exit(0);
