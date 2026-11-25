import { recruitingVslForTrack, VSL_VIDEO } from "@/lib/vslMedia";
import { LICENSING_VIDEO } from "@/lib/licensingMedia";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

describe("today production and landing elevation", () => {
  it("aggregates the signed-in hierarchy on the Phoenix business date", () => {
    const migration = source("supabase/migrations/20260826003000_crm_today_production.sql");
    expect(migration).toContain("d.created_at at time zone 'America/Phoenix'");
    expect(migration).toContain("sold_on = current_date");
    expect(migration).toContain("coalesce(sum(annual_premium), 0)");
    expect(migration).toContain("d.duplicate_of_deal_id is null");
    expect(migration).toContain("crm_can_read_agent_scope(d.agent_id)");
  });

  it("keeps My Team live and says who sold today", () => {
    // OVERHAUL-myteam (2026-10-31): the eight-figure strip with its "Sold Today" line is gone (four numbers at
    // most). A posted deal still refreshes the roster at once, and the seller's row says "Sold today".
    const crm = source("src/pages/DashboardCRM.tsx");
    const list = source("src/lib/teamList.ts");
    expect(crm).toContain('queryKey: ["crm-agent-roster"]');
    expect(crm).toContain('rpc("crm_agent_sales_pulse"');
    expect(crm).toContain('table: "deals"');
    expect(list).toContain('parts.push("Sold today")');
  });

  it("keeps home to two license answers and preserves the video/application handoff", () => {
    const hero = source("src/components/landing/HeroSection.tsx");
    const index = source("src/pages/Index.tsx");
    const vsl = source("src/pages/Vsl.tsx");
    const apply = source("src/pages/Apply.tsx");
    const operatingSystem = source("src/components/landing/AgencyOperatingSystemSection.tsx");
    const pathArray = hero.match(/const partnerPaths = \[([\s\S]*?)\]\s+as const/);
    expect(pathArray, "The hero declares its two audience choices").not.toBeNull();
    const paths = Array.from(
      pathArray![1].matchAll(/title: "([^"]+)",\s*track: "([^"]+)",\s*destination: "([^"]+)"/g),
      ([, title, track, destination]) => ({ title, track, destination }),
    );
    expect(paths).toEqual([
      { title: "Yes, I'm Currently Licensed", track: "licensed-producer", destination: "/vsl" },
      { title: "No, I'm Unlicensed", track: "licensing-roadmap", destination: "/vsl" },
    ]);
    expect(hero).toContain("Do you currently have a life insurance license?");
    expect(hero).toContain("partnerPaths.map((path)");
    expect(hero).not.toContain("Building an agency?");
    expect(hero).toContain("buildPublicRecruitingHref(path.destination, searchParams, path.track)");
    expect(vsl).toContain('buildPublicRecruitingHref("/apply", searchParams)');
    expect(vsl).toMatch(/<Link\s+to=\{applyHref\}/);
    expect(vsl).toContain("recruitingVslForTrack(track)");
    expect(vsl).toContain("<source src={video.src}");
    expect(vsl).toContain("key={video.src}");
    expect(recruitingVslForTrack("licensed-producer").video).toBe(VSL_VIDEO);
    expect(recruitingVslForTrack("licensing-roadmap").video).toBe(LICENSING_VIDEO);
    expect(apply).toContain('defaultLicenseStatusForTrack(searchParams.get("track"))');
    expect(apply).toContain("attributionJson: partnerPath");
    expect(apply).toContain("Agent application form");
    expect(apply).toContain("<form onSubmit={handleSubmit(onSubmit)}>");
    expect(apply).not.toContain("Founder · $1.2M income in first year");
    expect(apply).not.toContain("landing_live_stats");
    expect(apply).not.toContain("income in one year");
    expect(index).toContain("<HeroSection />");
    for (const removed of ["AgencyOperatingSystemSection", "BenefitsSection", "EarningsSection", "CareerPathwaySection", "RecruitFAQ", "Testimonials", "CTASection", "Footer", "StickyMobileCTA", "DealsTicker", "Navbar"]) {
      expect(index).not.toContain(removed);
    }
    expect(operatingSystem).toContain("One platform. Every stage of agency growth.");
    expect(operatingSystem).toContain("Recruiting engine");
    expect(operatingSystem).toContain("Launch control");
    expect(operatingSystem).toContain("Agency intelligence");
    expect(hero.toLowerCase()).not.toContain("guaranteed placement");
  });
});
