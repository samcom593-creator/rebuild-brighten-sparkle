import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("new-agent onboarding video placement", () => {
  it("releases the canonical hosted media", () => {
    const media = read("src/lib/onboardingMedia.ts");
    expect(media).toContain("apex-new-agent-onboarding.mp4");
    expect(media).toContain("apex-new-agent-onboarding-poster.jpg");
    expect(media).toMatch(/ready:\s*true/);
  });

  it("puts onboarding after the licensing walkthrough for unlicensed applicants", () => {
    const page = read("src/pages/GetLicensed.tsx");
    expect(page.indexOf('id="licensing-video"')).toBeLessThan(
      page.indexOf('id="apex-onboarding"'),
    );
    expect(page).toContain("onEnded={startOnboardingVideo}");

    const join = read("src/pages/JoinLink.tsx");
    expect(join).toContain("#licensing-video");
    expect(join).not.toContain("PostSubmitOnboardingVideo");
  });

  it("plays onboarding immediately after a hire activates", () => {
    const hire = read("src/pages/HireLink.tsx");
    expect(hire).toContain("PostSubmitOnboardingVideo");
    expect(hire).toContain("onboardingPlayerRef.current?.start(nextUrl)");
  });

  it("keeps the video discoverable from the training index", () => {
    const training = read("src/pages/TrainingIndex.tsx");
    expect(training).toContain('/get-licensed#apex-onboarding');
  });
});
