import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const occurrences = (source: string, value: string) => source.split(value).length - 1;

describe("agent dashboard Free Leads contract", () => {
  it("reuses one status card beside the dashboard's existing controls", () => {
    const dashboard = read("src/pages/AgentCommandDashboard.tsx");

    expect(occurrences(dashboard, "<FreeLeadsStatusCard agentId={agentId} />")).toBe(1);
    expect(occurrences(dashboard, "<MyReferralLinkCard />")).toBe(1);
    expect(occurrences(dashboard, "<LicenseProgressSelector")).toBe(1);
    expect(dashboard).not.toContain("<AgentReferralLinkCard");
  });

  it("keeps the shared Free Leads card status-only", () => {
    const card = read("src/components/dashboard/FreeLeadsStatusCard.tsx");

    expect(card).not.toContain("LicenseProgressSelector");
    expect(card).not.toContain("ReferralLink");
    expect(card).not.toContain("<Button");
  });
});
