#!/usr/bin/env node
/** Keep /vsl's player, route-scoped preload, schema, and cache marker in sync. */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function vslSyncProblems({ hero, vsl, media, index }) {
  const problems = [];
  const baseMatch = media.match(/const\s+VSL_MEDIA_BASE\s*=\s*["']([^"']+)["']/);
  const videoFile = media.match(/\bsrc:\s*`\$\{VSL_MEDIA_BASE\}\/([^`]+)`/);
  const posterFile = media.match(/\bposter:\s*`\$\{VSL_MEDIA_BASE\}\/([^`]+)`/);
  if (!baseMatch || !videoFile || !posterFile) {
    return { release: null, problems: ["Could not derive the canonical VSL base, video, or poster."] };
  }
  const mediaBase = baseMatch[1];
  const release = mediaBase.slice(mediaBase.lastIndexOf("/") + 1);
  const posterUrl = `${mediaBase}/${posterFile[1]}`;
  const checks = [
    ["/vsl video source", vsl, "<source src={VSL_VIDEO.src}"],
    ["/vsl video poster", vsl, "poster={VSL_VIDEO.poster}"],
    ["/vsl schema render", vsl, 'type="application/ld+json">{JSON.stringify(VSL_VIDEO_SCHEMA)}'],
    ["canonical VideoObject type", media, '"@type": "VideoObject"'],
    ["VideoObject thumbnailUrl", media, "thumbnailUrl: VSL_VIDEO.poster"],
    ["VideoObject contentUrl", media, "contentUrl: VSL_VIDEO.src"],
    ["VideoObject embedUrl", media, "embedUrl: VSL_VIDEO.pageUrl"],
    ["canonical video page URL", media, 'pageUrl: "https://galaxyfinancial.org/vsl"'],
    ["poster preload", index, `l.href = "${posterUrl}"`],
  ];
  for (const [label, source, expected] of checks) {
    if (!source.includes(expected)) problems.push(`${label}: missing ${expected}`);
  }
  if (!/import\s*\{[^}]*\bVSL_VIDEO_SCHEMA\b[^}]*\}\s*from\s*["']@\/lib\/vslMedia["']/.test(vsl)) {
    problems.push("/vsl must import its structured data from the canonical media module.");
  }
  if (/<video\b|<HomepageVsl\b/.test(hero)) {
    problems.push("The two-choice homepage must hand off to /vsl rather than embed another player.");
  }

  const markup = index.replace(/<!--[\s\S]*?-->/g, "");
  if (/<link\b[^>]*galaxy-vsl-poster/i.test(markup)) {
    problems.push("Poster preload must be route-scoped to /vsl, not a static link on every page.");
  }
  const preload = (markup.match(/<script>[\s\S]*?<\/script>/g) || []).find((s) => s.includes(posterUrl));
  if (!preload || !preload.includes("if (p !== '/vsl') return;")) {
    problems.push("Poster preload must gate on /vsl only.");
  }
  if (preload && /crossorigin/i.test(preload)) {
    problems.push("Poster preload must remain no-cors to match the video poster request.");
  }
  const schemas = [...markup.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (schemas.some((s) => /["']@type["']\s*:\s*["']VideoObject["']/.test(s[1]))) {
    problems.push("The homepage shell must not advertise a VideoObject when only /vsl has a player.");
  }
  const bump = index.match(/var\s+BUMP_VERSION\s*=\s*"([^"]+)"/);
  if (!bump || !bump[1].includes(release)) {
    problems.push(`BUMP_VERSION must contain the canonical media release ${release}.`);
  }
  return { release, problems };
}

export function inspectVslSync(root = ROOT) {
  const read = (file) => readFileSync(resolve(root, file), "utf8");
  return vslSyncProblems({
    hero: read("src/components/landing/HeroSection.tsx"),
    vsl: read("src/pages/Vsl.tsx"),
    media: read("src/lib/vslMedia.ts"),
    index: read("index.html"),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { release, problems } = inspectVslSync();
    if (problems.length) {
      console.error(`[check-vsl-sync] canonical VSL references drifted:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
      process.exit(1);
    }
    console.log(`[check-vsl-sync] OK — /vsl player, schema, and preload use canonical release ${release}; homepage is selection-only.`);
  } catch (error) {
    console.error(`[check-vsl-sync] ${error.message}`);
    process.exit(1);
  }
}
