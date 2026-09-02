import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { VSL_VIDEO } from "@/lib/vslMedia";

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
    expect(VSL_VIDEO.poster).toMatch(/\/apex-vsl-poster\.jpg$/);
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

  it("uses the same final cut on the public homepage", () => {
    const hero = read("src/components/landing/HeroSection.tsx");
    expect(hero).toContain("VSL_VIDEO.src");
    expect(hero).toContain("VSL_VIDEO.poster");
    expect(hero).toContain("<HomepageVsl />");
    expect(hero).not.toContain("E2VJ1v85IRE");
    expect(hero).not.toContain("LazyYouTube");
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
