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

  it("hands both license choices and agency builders to the video and application funnel", () => {
    const hero = source("src/components/landing/HeroSection.tsx");
    const index = source("src/pages/Index.tsx");
    const vsl = source("src/pages/Vsl.tsx");
    const apply = source("src/pages/Apply.tsx");
    const operatingSystem = source("src/components/landing/AgencyOperatingSystemSection.tsx");
    const pathArray = hero.match(/const partnerPaths = \[([\s\S]*?)\]\s+as const/);
    expect(pathArray, "The hero still declares all three audience paths").not.toBeNull();
    const paths = Array.from(
      pathArray![1].matchAll(/title: "([^"]+)",\s*description: "[^"]+",\s*track: "([^"]+)",\s*destination: "([^"]+)"/g),
      ([, title, track, destination]) => ({ title, track, destination }),
    );
    expect(paths).toEqual([
      { title: "I’m a licensed agent", track: "licensed-producer", destination: "/vsl" },
      { title: "I need my license", track: "licensing-roadmap", destination: "/vsl" },
      { title: "Building an agency?", track: "agency-builder", destination: "/vsl" },
    ]);
    expect(hero).toContain("Do you have your insurance license?");
    expect(hero).toContain('partnerPaths.filter((path) => path.track !== "agency-builder")');
    expect(hero).toContain('partnerPaths.filter((path) => path.track === "agency-builder")');
    expect(hero).toContain("buildPublicRecruitingHref(path.destination, searchParams, path.track)");
    expect(vsl).toContain('buildPublicRecruitingHref("/apply", searchParams)');
    expect(vsl).toMatch(/<Link\s+to=\{applyHref\}/);
    expect(vsl).toContain("<source src={VSL_VIDEO.src}");
    expect(apply).toContain('defaultLicenseStatusForTrack(searchParams.get("track"))');
    expect(apply).toContain("attributionJson: partnerPath");
    expect(apply).toContain("Founder · $1.2M income in first year");
    expect(apply).not.toContain("income in one year");
    expect(index).toContain("<AgencyOperatingSystemSection />");
    expect(operatingSystem).toContain("One platform. Every stage of agency growth.");
    expect(operatingSystem).toContain("Recruiting engine");
    expect(operatingSystem).toContain("Launch control");
    expect(operatingSystem).toContain("Agency intelligence");
    expect(hero.toLowerCase()).not.toContain("guaranteed placement");
  });
});
