import { beforeEach, describe, expect, it } from "vitest";
import { ATTRIBUTION_KEYS } from "@/lib/attribution";
import { buildPublicRecruitingHref, defaultLicenseStatusForTrack, parsePublicRecruitingTrack, PUBLIC_RECRUITING_TRACKS } from "@/lib/publicRecruitingFlow";
import { setRefSlug } from "@/lib/refSlug";

const url = (path: string) => new URL(path, "https://galaxyfinancial.org");

beforeEach(() => localStorage.clear());

describe("public recruiting route context", () => {
  it.each(PUBLIC_RECRUITING_TRACKS)("keeps the referral and %s track from homepage through VSL to Apply", (track) => {
    const landing = new URLSearchParams("ref=synthetic-agent_1");
    const video = url(buildPublicRecruitingHref("/vsl", landing, track));
    const apply = url(buildPublicRecruitingHref("/apply", video.searchParams));
    expect(video.pathname).toBe("/vsl");
    expect(apply.pathname).toBe("/apply");
    expect(apply.searchParams.get("ref")).toBe("synthetic-agent_1");
    expect(apply.searchParams.get("track")).toBe(track);
  });

  it("uses an explicit audience choice without mutating incoming params", () => {
    const incoming = new URLSearchParams("ref=synthetic-agent&track=licensed-producer");
    const roadmap = url(buildPublicRecruitingHref("/get-licensed", incoming, "licensing-roadmap"));
    expect(roadmap.searchParams.get("track")).toBe("licensing-roadmap");
    expect(roadmap.searchParams.get("ref")).toBe("synthetic-agent");
    expect(incoming.get("track")).toBe("licensed-producer");
  });

  it("preserves the existing paid-traffic mode and attribution allowlist across both hops", () => {
    const incoming = new URLSearchParams({ source: "ad", utm_medium: "paid_social", ref: "synthetic-agent" });
    for (const key of ATTRIBUTION_KEYS) if (!incoming.has(key)) incoming.set(key, `synthetic-${key}`);
    const video = url(buildPublicRecruitingHref("/vsl", incoming, "licensed-producer"));
    const apply = url(buildPublicRecruitingHref("/apply", video.searchParams));
    for (const key of ATTRIBUTION_KEYS) expect(apply.searchParams.get(key)).toBe(incoming.get(key));
    expect(apply.searchParams.get("source")).toBe("ad");
    expect(apply.searchParams.get("utm_medium")).toBe("paid_social");
  });

  it("excludes resume and personal fields, drops oversized campaign values, and encodes allowed values", () => {
    const incoming = new URLSearchParams({
      track: "licensed-producer", resume: "synthetic-private-resume", email: "synthetic@example.invalid", phone: "5550100",
      firstName: "Synthetic", utm_campaign: "Career & agency", utm_content: "x".repeat(201), source: " ad ",
    });
    const next = url(buildPublicRecruitingHref("/vsl", incoming));
    for (const key of ["resume", "email", "phone", "firstName", "utm_content"]) expect(next.searchParams.has(key)).toBe(false);
    expect(next.searchParams.get("utm_campaign")).toBe("Career & agency");
    expect(next.searchParams.get("source")).toBe("ad");
    expect(next.searchParams.size).toBe(3);
  });

  it("retains the existing validated referral fallback and prefers a valid URL referral", () => {
    setRefSlug("stored-synthetic-agent");
    expect(url(buildPublicRecruitingHref("/apply", new URLSearchParams())).searchParams.get("ref")).toBe("stored-synthetic-agent");
    expect(url(buildPublicRecruitingHref("/apply", new URLSearchParams("ref=url-agent"))).searchParams.get("ref")).toBe("url-agent");
  });

  it("drops unknown tracks and invalid referral values", () => {
    expect(buildPublicRecruitingHref("/apply", new URLSearchParams("track=unknown-path&ref=%3Cscript%3E"))).toBe("/apply");
    expect(parsePublicRecruitingTrack(" Licensed-Producer ")).toBe("licensed-producer");
    expect(parsePublicRecruitingTrack("licensed-producer<script>")).toBeNull();
  });

  it("keeps public links usable when the browser denies the localStorage getter", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => { throw new DOMException("Storage denied", "SecurityError"); },
    });
    try {
      expect(() => buildPublicRecruitingHref("/apply", new URLSearchParams())).not.toThrow();
      expect(buildPublicRecruitingHref("/apply", new URLSearchParams())).toBe("/apply");
      expect(buildPublicRecruitingHref("/vsl", new URLSearchParams("ref=synthetic-agent"), "licensed-producer"))
        .toBe("/vsl?ref=synthetic-agent&track=licensed-producer");
    } finally {
      Object.defineProperty(window, "localStorage", descriptor);
    }
  });
});

describe("new application license default", () => {
  it.each([
    ["licensed-producer", "licensed"], [" LICENSED-PRODUCER ", "licensed"],
    ["agency-builder", "unlicensed"], ["licensing-roadmap", "unlicensed"],
    ["licensed", "unlicensed"], ["unknown-path", "unlicensed"], [null, "unlicensed"],
  ])("defaults %s to %s without inferring another audience's license", (track, expected) => {
    expect(defaultLicenseStatusForTrack(track)).toBe(expected);
  });
});
