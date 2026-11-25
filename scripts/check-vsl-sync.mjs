#!/usr/bin/env node
/** Keep /vsl's player, route-scoped preload, schema, and cache marker in sync. */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function vslSyncProblems({ hero, vsl, media, licensingMedia, index }) {
  const problems = [];
  const baseMatch = media.match(/const\s+VSL_MEDIA_BASE\s*=\s*["']([^"']+)["']/);
  const videoFile = media.match(/\bsrc:\s*`\$\{VSL_MEDIA_BASE\}\/([^`]+)`/);
  const posterFile = media.match(/\bposter:\s*`\$\{VSL_MEDIA_BASE\}\/([^`]+)`/);
  const licensingBase = licensingMedia?.match(/const\s+TRAINING_MEDIA_BASE\s*=\s*["']([^"']+)["']/);
  const licensingVideo = licensingMedia?.match(/\bsrc:\s*`\$\{TRAINING_MEDIA_BASE\}\/([^`]+)`/);
  const licensingPoster = licensingMedia?.match(/\bposter:\s*`\$\{TRAINING_MEDIA_BASE\}\/([^`]+)`/);
  if (!baseMatch || !videoFile || !posterFile || !licensingBase || !licensingVideo || !licensingPoster) {
    return { release: null, licensingRelease: null, problems: ["Could not derive both canonical recruiting video and poster pairs."] };
  }
  const mediaBase = baseMatch[1];
  const release = mediaBase.slice(mediaBase.lastIndexOf("/") + 1);
  const posterUrl = `${mediaBase}/${posterFile[1]}`;
  const licensingRelease = licensingBase[1].slice(licensingBase[1].lastIndexOf("/") + 1);
  const licensingPosterUrl = `${licensingBase[1]}/${licensingPoster[1]}`;
  const checks = [
    ["/vsl audience selection", vsl, "const { video, schema, analyticsId, label } = recruitingVslForTrack(track)"],
    ["/vsl video source", vsl, "<source src={video.src}"],
    ["/vsl video poster", vsl, "poster={video.poster}"],
    ["/vsl native player reset", vsl, "key={video.src}"],
    ["/vsl video title", vsl, "aria-label={video.title}"],
    ["/vsl video duration", vsl, "{video.durationLabel}"],
    ["/vsl play telemetry", vsl, "video: analyticsId"],
    ["/vsl schema render", vsl, 'type="application/ld+json">{JSON.stringify(schema)}'],
    ["unlicensed audience branch", media, 'track === "licensing-roadmap"'],
    ["unlicensed video", media, "video: LICENSING_VIDEO"],
    ["unlicensed schema", media, "schema: LICENSING_VSL_SCHEMA"],
    ["unlicensed play telemetry", media, `analyticsId: "licensing-${licensingRelease}"`],
    ["licensed video", media, "video: VSL_VIDEO"],
    ["licensed schema", media, "schema: VSL_VIDEO_SCHEMA"],
    ["licensed play telemetry", media, `analyticsId: "vsl-${release}"`],
    ["canonical VideoObject type", media, '"@type": "VideoObject"'],
    ["VideoObject thumbnailUrl", media, "thumbnailUrl: VSL_VIDEO.poster"],
    ["VideoObject contentUrl", media, "contentUrl: VSL_VIDEO.src"],
    ["VideoObject embedUrl", media, "embedUrl: VSL_VIDEO.pageUrl"],
    ["canonical video page URL", media, 'pageUrl: "https://galaxyfinancial.org/vsl"'],
    ["licensing VideoObject thumbnailUrl", media, "thumbnailUrl: LICENSING_VIDEO.poster"],
    ["licensing VideoObject contentUrl", media, "contentUrl: LICENSING_VIDEO.src"],
    ["licensing VideoObject embedUrl", media, "embedUrl: `${VSL_VIDEO.pageUrl}?track=licensing-roadmap`"],
    ["licensing VideoObject duration", media, "Math.floor(LICENSING_VIDEO.durationSeconds / 60)"],
    ["licensed poster preload", index, posterUrl],
    ["unlicensed poster preload", index, licensingPosterUrl],
  ];
  for (const [label, source, expected] of checks) {
    if (!source.includes(expected)) problems.push(`${label}: missing ${expected}`);
  }
  if (!/import\s*\{[^}]*\brecruitingVslForTrack\b[^}]*\}\s*from\s*["']@\/lib\/vslMedia["']/.test(vsl)) {
    problems.push("/vsl must select its video and structured data from the canonical media module.");
  }
  if (!/import\s*\{[^}]*\bLICENSING_VIDEO\b[^}]*\}\s*from\s*["']@\/lib\/licensingMedia["']/.test(media)) {
    problems.push("The unlicensed selection must import the canonical licensing video.");
  }
  if (/<video\b|<HomepageVsl\b/.test(hero)) {
    problems.push("The two-choice homepage must hand off to /vsl rather than embed another player.");
  }

  const markup = index.replace(/<!--[\s\S]*?-->/g, "");
  if (/<link\b[^>]*(?:galaxy-vsl-poster|how-to-get-your-life-insurance-license-poster)/i.test(markup)) {
    problems.push("Poster preload must be route-scoped to /vsl, not a static link on every page.");
  }
  const preload = [...markup.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(source => source.includes(posterUrl) || source.includes(licensingPosterUrl));
  if (!preload || !preload.includes("if (p !== '/vsl') return;")) {
    problems.push("Poster preload must gate on /vsl only.");
  }
  if (preload) {
    // Execute only the isolated preload against a tiny fake document. This is
    // a local contract check, not a browser/network probe. Presence of both
    // strings alone cannot prove that the audience branches are correct.
    const scenarios = [
      ["/vsl", "?track=licensed-producer", posterUrl],
      ["/vsl", "?track=licensing-roadmap", licensingPosterUrl],
      ["/vsl/", "?track=%20LICENSING-ROADMAP%20", licensingPosterUrl],
      ["/vsl", "?track=agency-builder", posterUrl],
      ["/vsl", "?track=unknown", posterUrl],
      ["/vsl", "", posterUrl],
      ["/", "?track=licensing-roadmap", null],
      ["/apply", "?track=licensed-producer", null],
      ["/get-licensed", "", null],
      ["/dashboard", "", null],
    ];
    for (const [pathname, search, expected] of scenarios) {
      const links = [];
      try {
        runInNewContext(preload, {
          location: { pathname, search }, URLSearchParams,
          document: {
            createElement: () => ({ setAttribute(name, value) { this[name.toLowerCase()] = String(value); } }),
            head: { appendChild: link => links.push(link) },
          },
        }, { timeout: 100 });
        if (expected === null ? links.length !== 0 : links.length !== 1 || links[0].href !== expected || links[0].rel !== "preload" || links[0].as !== "image") {
          problems.push(`Poster preload selects the wrong asset or route for ${pathname}${search}.`);
        }
        if (links.some(link => link.crossOrigin !== undefined || link.crossorigin !== undefined)) {
          problems.push("Poster preload must remain no-cors to match the video poster request.");
        }
      } catch {
        problems.push(`Poster preload could not run for ${pathname}${search}.`);
      }
    }
  }
  const schemas = [...markup.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (schemas.some((s) => /["']@type["']\s*:\s*["']VideoObject["']/.test(s[1]))) {
    problems.push("The homepage shell must not advertise a VideoObject when only /vsl has a player.");
  }
  const bump = index.match(/var\s+BUMP_VERSION\s*=\s*"([^"]+)"/);
  if (!bump || !bump[1].includes(release) || !bump[1].includes(licensingRelease)) {
    problems.push(`BUMP_VERSION must contain both canonical releases ${release} and ${licensingRelease}.`);
  }
  return { release, licensingRelease, problems };
}

export function inspectVslSync(root = ROOT) {
  const read = (file) => readFileSync(resolve(root, file), "utf8");
  return vslSyncProblems({
    hero: read("src/components/landing/HeroSection.tsx"),
    vsl: read("src/pages/Vsl.tsx"),
    media: read("src/lib/vslMedia.ts"),
    licensingMedia: read("src/lib/licensingMedia.ts"),
    index: read("index.html"),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { release, licensingRelease, problems } = inspectVslSync();
    if (problems.length) {
      console.error(`[check-vsl-sync] canonical VSL references drifted:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
      process.exit(1);
    }
    console.log(`[check-vsl-sync] OK — /vsl selects licensed ${release} and unlicensed ${licensingRelease} media, schema, and preload; homepage is selection-only.`);
  } catch (error) {
    console.error(`[check-vsl-sync] ${error.message}`);
    process.exit(1);
  }
}
