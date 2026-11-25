import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { LICENSING_VSL_SCHEMA, recruitingVslForTrack, VSL_VIDEO, VSL_VIDEO_SCHEMA } from "@/lib/vslMedia";
import { LICENSING_VIDEO } from "@/lib/licensingMedia";
import { vslSyncProblems } from "../../../scripts/check-vsl-sync.mjs";

const ROOT = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

/**
 * The VSL is published as a hosted object, not a repo asset, so nothing in a
 * normal build fails if the page stops pointing at it. These assertions are
 * the only thing standing between a re-cut and a silently dead player.
 */
describe("public APEX VSL placement", () => {
  it("points at the published Supabase object, not a local or placeholder path", () => {
    expect(VSL_VIDEO.src).toBe(
      "https://xrzweoneiieddzxogewk.supabase.co/storage/v1/object/public/training-videos/vsl/2026-09-02/apex-vsl.mp4",
    );
    expect(VSL_VIDEO.poster).toMatch(/\/galaxy-vsl-poster\.jpg$/);
  });

  it("derives the label from the measured duration so the two cannot drift", () => {
    expect(VSL_VIDEO.durationSeconds).toBe(346);
    expect(VSL_VIDEO.durationLabel).toBe("5:46");
  });

  it("renders a real player on /vsl that reads from the canonical module", () => {
    const page = read("src/pages/Vsl.tsx");
    expect(page).toContain("recruitingVslForTrack(track)");
    expect(page).toContain("video.src");
    expect(page).toContain("video.poster");
    expect(page).toContain("<video");
    // A hardcoded URL in the page would let the module and the player drift.
    expect(page).not.toContain("supabase.co/storage");
  });

  it("keeps the homepage selection-only and hands both audiences to /vsl", () => {
    const hero = read("src/components/landing/HeroSection.tsx");
    expect(hero.match(/destination: "\/vsl"/g)).toHaveLength(2);
    expect(hero).not.toContain("<video");
    expect(hero).not.toContain("HomepageVsl");
    expect(hero).not.toContain("E2VJ1v85IRE");
    expect(hero).not.toContain("LazyYouTube");
  });

  it("derives the video schema from the actual media and renders it only on /vsl", () => {
    expect(VSL_VIDEO_SCHEMA).toMatchObject({
      "@type": "VideoObject", contentUrl: VSL_VIDEO.src, thumbnailUrl: VSL_VIDEO.poster,
      embedUrl: VSL_VIDEO.pageUrl, duration: "PT5M46S", uploadDate: "2026-09-02",
    });
    expect(LICENSING_VSL_SCHEMA).toMatchObject({
      "@type": "VideoObject", contentUrl: LICENSING_VIDEO.src, thumbnailUrl: LICENSING_VIDEO.poster,
      embedUrl: `${VSL_VIDEO.pageUrl}?track=licensing-roadmap`, duration: "PT5M18S", uploadDate: "2026-09-15",
    });
    expect(read("src/pages/Vsl.tsx")).toContain("JSON.stringify(schema)");
    expect(read("index.html")).not.toContain('"@type":"VideoObject"');
    expect(read("index.html")).not.toContain('"@type":"FAQPage"');
  });

  it("maps each explicit audience to its existing canonical media without replacing onboarding", () => {
    expect(recruitingVslForTrack("licensed-producer")).toMatchObject({ video: VSL_VIDEO, schema: VSL_VIDEO_SCHEMA, analyticsId: "vsl-2026-09-02" });
    expect(recruitingVslForTrack("licensing-roadmap")).toMatchObject({ video: LICENSING_VIDEO, schema: LICENSING_VSL_SCHEMA, analyticsId: "licensing-2026-09-15" });
    expect(recruitingVslForTrack("agency-builder").video).toBe(VSL_VIDEO);
    expect(recruitingVslForTrack(null).video).toBe(VSL_VIDEO);
    expect(read("src/pages/GetLicensed.tsx")).toContain("LICENSING_VIDEO.src");
    expect(read("src/lib/onboardingMedia.ts")).toContain("apex-new-agent-onboarding.mp4");
  });

  it("keeps the build/commit VSL guard sensitive to actual player, schema and route drift", () => {
    const sources = {
      hero: read("src/components/landing/HeroSection.tsx"), vsl: read("src/pages/Vsl.tsx"),
      media: read("src/lib/vslMedia.ts"), licensingMedia: read("src/lib/licensingMedia.ts"), index: read("index.html"),
    };
    expect(vslSyncProblems(sources).problems).toEqual([]);
    const mutations: Array<[string, keyof typeof sources, string, string]> = [
      ["audience ignored", "vsl", "recruitingVslForTrack(track)", "recruitingVslForTrack(null)"],
      ["old player source", "vsl", "<source src={video.src}", '<source src="/old.mp4"'],
      ["wrong poster", "vsl", "poster={video.poster}", "poster={VSL_VIDEO.poster}"],
      ["missing player reset", "vsl", "key={video.src}", ""],
      ["wrong duration", "vsl", "{video.durationLabel}", "{VSL_VIDEO.durationLabel}"],
      ["wrong play event", "vsl", "video: analyticsId", 'video: "vsl-2026-09-02"'],
      ["wrong rendered schema", "vsl", "JSON.stringify(schema)", "JSON.stringify(VSL_VIDEO_SCHEMA)"],
      ["wrong unlicensed selection", "media", "video: LICENSING_VIDEO", "video: VSL_VIDEO"],
      ["wrong licensed selection", "media", "video: VSL_VIDEO", "video: LICENSING_VIDEO"],
      ["wrong licensed schema poster", "media", "thumbnailUrl: VSL_VIDEO.poster", 'thumbnailUrl: "/old.jpg"'],
      ["wrong unlicensed schema source", "media", "contentUrl: LICENSING_VIDEO.src", "contentUrl: VSL_VIDEO.src"],
      ["wrong unlicensed preload branch", "index", "track === 'licensing-roadmap'", "false"],
      ["global poster preload", "index", "if (p !== '/vsl') return;", "if (p !== '/' && p !== '/vsl') return;"],
      ["cors poster preload", "index", "l.as = 'image';", "l.as = 'image'; l.crossOrigin = 'anonymous';"],
      ["missing licensing cache marker", "index", "2026-11-25-audience-vsl-2026-09-02-2026-09-15", "2026-11-25-audience-vsl-2026-09-02"],
    ];
    for (const [label, key, before, after] of mutations) {
      const changed = sources[key].replace(before, after);
      expect(changed, label).not.toBe(sources[key]);
      expect(vslSyncProblems({ ...sources, [key]: changed }).problems, label).not.toEqual([]);
    }
    expect(vslSyncProblems({ ...sources, hero: sources.hero + "<video />" }).problems).not.toEqual([]);
  });

  it("keeps /vsl routed and reachable, and does not re-gate /apply", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('<Route path="/vsl" element={<Vsl />} />');

    // 089baa85 killed the /apply VSL gate deliberately. Publishing the video
    // must not resurrect it.
    const apply = read("src/pages/Apply.tsx");
    expect(apply).not.toContain("VSL_VIDEO");
  });

  it("is covered by the post-deploy route smoke", () => {
    expect(read("scripts/route-smoke.mjs")).toContain('"/vsl"');
  });
});
