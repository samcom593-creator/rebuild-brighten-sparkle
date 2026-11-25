import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { VSL_VIDEO, VSL_VIDEO_SCHEMA } from "@/lib/vslMedia";
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
    expect(page).toContain("VSL_VIDEO.src");
    expect(page).toContain("VSL_VIDEO.poster");
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
    expect(read("src/pages/Vsl.tsx")).toContain("JSON.stringify(VSL_VIDEO_SCHEMA)");
    expect(read("index.html")).not.toContain('"@type":"VideoObject"');
    expect(read("index.html")).not.toContain('"@type":"FAQPage"');
  });

  it("keeps the build/commit VSL guard sensitive to actual player, schema and route drift", () => {
    const sources = {
      hero: read("src/components/landing/HeroSection.tsx"), vsl: read("src/pages/Vsl.tsx"),
      media: read("src/lib/vslMedia.ts"), index: read("index.html"),
    };
    expect(vslSyncProblems(sources).problems).toEqual([]);
    expect(vslSyncProblems({ ...sources, vsl: sources.vsl.replace("<source src={VSL_VIDEO.src}", '<source src="/old.mp4"') }).problems).not.toEqual([]);
    expect(vslSyncProblems({ ...sources, media: sources.media.replace("thumbnailUrl: VSL_VIDEO.poster", 'thumbnailUrl: "/old.jpg"') }).problems).not.toEqual([]);
    expect(vslSyncProblems({ ...sources, index: sources.index.replace("if (p !== '/vsl') return;", "if (p !== '/' && p !== '/vsl') return;") }).problems).not.toEqual([]);
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
