import { describe, expect, it } from "vitest";
import { isDeadEndLink } from "@/lib/apexResourcesHub";

describe("isDeadEndLink: the Training Hub never sends an agent to a page they cannot open", () => {
  it("drops the password-gated library pages and the retired CRM", () => {
    expect(isDeadEndLink("https://apex-resources.vercel.app/admin/")).toBe(true);
    expect(isDeadEndLink("https://apex-resources.vercel.app")).toBe(true);
    expect(isDeadEndLink("https://agentlink.insuracloud.ai")).toBe(true);
    expect(isDeadEndLink("admin/")).toBe(true);
  });

  it("keeps the public files and every other destination", () => {
    expect(isDeadEndLink("https://apex-resources.vercel.app/assets/APEX_Agent_Playbook.pdf")).toBe(false);
    expect(isDeadEndLink("assets/Needs_Analysis_Quiz.pdf")).toBe(false);
    expect(isDeadEndLink("https://apexfinancial.readymode.com")).toBe(false);
    expect(isDeadEndLink("https://docs.google.com/document/d/abc")).toBe(false);
  });
});
