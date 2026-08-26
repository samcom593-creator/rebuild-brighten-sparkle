import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("recruiting command center", () => {
  it("uses one actionable command surface across applicants, interviews, and follow-ups", () => {
    const hero = read("src/components/recruiting/RecruitingCommandHero.tsx");
    expect(hero).toContain("Every number opens the people behind it");
    expect(hero).toContain("metric.onClick");
    expect(read("src/pages/DashboardApplicants.tsx")).toContain("<RecruitingCommandHero");
    expect(read("src/pages/Interviews.tsx")).toContain("<RecruitingCommandHero");
    expect(read("src/pages/InterviewRecovery.tsx")).toContain("<RecruitingCommandHero");
  });

  it("places each applicant on exactly one furthest-stage pipeline rung", () => {
    const applicants = read("src/pages/DashboardApplicants.tsx");
    expect(applicants).toContain("const stageOf = (a: Application)");
    expect(applicants).toContain('interviews.get(a.id) === "scheduled"');
    expect(applicants).toContain("stageOf(application) === column.key");
    expect(applicants).not.toContain("interview_scheduled_at");
  });

  it("counts only future, non-canceled interview bookings in applicant metrics", () => {
    const applicants = read("src/pages/DashboardApplicants.tsx");
    expect(applicants).toContain('.is("canceled_at", null)');
    expect(applicants).toContain('.gte("scheduled_at", new Date().toISOString())');
  });
});
