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

import { renameRetiredBrand, rewriteRetiredHost } from "@/lib/apexResourcesHub";

describe("renameRetiredBrand: the retired company name never renders on the live Galaxy hub", () => {
  it("rewrites the retired COMPANY name and its website label", () => {
    expect(renameRetiredBrand("APEX Financial Release Course")).toBe("Galaxy Financial Release Course");
    expect(renameRetiredBrand("APEX Financial Release: Intro")).toBe("Galaxy Financial Release: Intro");
    expect(renameRetiredBrand("Apex Financial")).toBe("Galaxy Financial");
    expect(renameRetiredBrand("APEX Website")).toBe("Galaxy Website");
  });

  it("leaves bare APEX/Apex doctrine untouched (The Apex Standard is still live)", () => {
    expect(renameRetiredBrand("APEX Mindset after Release (HOW TO WIN)")).toBe("APEX Mindset after Release (HOW TO WIN)");
    expect(renameRetiredBrand("APEX Agent Playbook")).toBe("APEX Agent Playbook");
    expect(renameRetiredBrand("Apex Script 3.0 — Senior Benefits")).toBe("Apex Script 3.0 — Senior Benefits");
    expect(renameRetiredBrand("APEX Onboarding Course")).toBe("APEX Onboarding Course");
  });

  it("passes undefined/empty through unchanged", () => {
    expect(renameRetiredBrand(undefined)).toBeUndefined();
    expect(renameRetiredBrand("")).toBe("");
  });
});

describe("rewriteRetiredHost: the retired apex-financial.org host is repointed at the live host", () => {
  it("repoints the retired company website link", () => {
    expect(rewriteRetiredHost("https://apex-financial.org")).toBe("https://galaxyfinancial.org");
    expect(rewriteRetiredHost("https://apex-financial.org/apply")).toBe("https://galaxyfinancial.org/apply");
  });

  it("leaves other hosts (incl. apexfinancial.readymode.com) alone", () => {
    expect(rewriteRetiredHost("https://apexfinancial.readymode.com")).toBe("https://apexfinancial.readymode.com");
    expect(rewriteRetiredHost("https://docs.google.com/document/d/abc")).toBe("https://docs.google.com/document/d/abc");
    expect(rewriteRetiredHost(undefined)).toBeUndefined();
  });
});
