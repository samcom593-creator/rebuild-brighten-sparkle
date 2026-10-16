import { describe, expect, it } from "vitest";
import {
  AGENT_CLOUD_PRIMARY_NAV,
  agentCloudGroupIsActive,
  agentCloudItemIsActive,
  agentCloudSearchMatches,
  initialGroupExpansion,
  isAgentCloudGroup,
  isApplicantViewer,
  isNavGroupOpen,
  reconcileGroupExpansion,
  toggleNavGroup,
  type AgentCloudNavGroup,
} from "@/components/layout/agentCloudNavigation";

// Builds the {pathname, search} pair react-router's useLocation() returns.
const at = (url: string) => {
  const [pathname, query = ""] = url.split("?");
  return { pathname, search: query ? `?${query}` : "" };
};

function groupNamed(label: string): AgentCloudNavGroup {
  const group = AGENT_CLOUD_PRIMARY_NAV.find((entry) => isAgentCloudGroup(entry) && entry.label === label);
  if (!group || !isAgentCloudGroup(group)) throw new Error(`${label} is not a group in the manifest`);
  return group;
}

function item(groupLabel: string, label: string) {
  const found = groupNamed(groupLabel).items.find((entry) => entry.label === label);
  if (!found) throw new Error(`${groupLabel} / ${label} is not in the manifest`);
  return found;
}

describe("agentCloudSearchMatches", () => {
  it("ignores query params unless the item declares which ones matter", () => {
    expect(agentCloudSearchMatches("?view=link", "/dashboard/team?view=contracting")).toBe(true);
    expect(agentCloudSearchMatches("", "/dashboard/team?view=contracting", [])).toBe(true);
  });

  it("compares each declared param against the value in the href", () => {
    expect(agentCloudSearchMatches("?view=contracting", "/dashboard/team?view=contracting", ["view"])).toBe(true);
    expect(agentCloudSearchMatches("?review=abc&view=contracting", "/dashboard/team?view=contracting", ["view"])).toBe(true);
    expect(agentCloudSearchMatches("?view=link", "/dashboard/team?view=contracting", ["view"])).toBe(false);
    expect(agentCloudSearchMatches("", "/dashboard/team?view=contracting", ["view"])).toBe(false);
  });
});

describe("agentCloudItemIsActive", () => {
  const contracting = item("Grow", "Contracting review");

  it("declares the view param on the VA's Contracting review item", () => {
    expect(contracting.href).toBe("/dashboard/team?view=contracting");
    expect(contracting.matchParams).toEqual(["view"]);
  });

  it("is active on the contracting team view and on no other team URL", () => {
    expect(agentCloudItemIsActive(at("/dashboard/team?view=contracting"), contracting)).toBe(true);
    expect(agentCloudItemIsActive(at("/dashboard/team?view=link"), contracting)).toBe(false);
    expect(agentCloudItemIsActive(at("/dashboard/team"), contracting)).toBe(false);
    expect(agentCloudItemIsActive(at("/dashboard/teams?view=contracting"), contracting)).toBe(false);
  });

  it("keeps a path-only item active on every view of its page", () => {
    const myTeam = item("Team", "My Team");
    expect(agentCloudItemIsActive(at("/dashboard/team?view=contracting"), myTeam)).toBe(true);
    expect(agentCloudItemIsActive(at("/dashboard/team?view=link"), myTeam)).toBe(true);
    // Support desk links to ?tab=desk but declares nothing, so the FAQ tab keeps it lit.
    expect(agentCloudItemIsActive(at("/dashboard/help?tab=faq"), { href: "/dashboard/help?tab=desk" })).toBe(true);
  });

  it("keeps Home an exact match", () => {
    expect(agentCloudItemIsActive(at("/dashboard"), { href: "/dashboard" })).toBe(true);
    expect(agentCloudItemIsActive(at("/dashboard/team"), { href: "/dashboard" })).toBe(false);
  });
});

describe("agentCloudGroupIsActive", () => {
  const grow = groupNamed("Grow");
  const sell = groupNamed("Sell");

  it("follows its items, declared params included", () => {
    expect(agentCloudGroupIsActive(at("/dashboard/team?view=contracting"), grow)).toBe(true);
    expect(agentCloudGroupIsActive(at("/dashboard/team?view=link"), grow)).toBe(false);
    expect(agentCloudGroupIsActive(at("/dashboard/call-center"), sell)).toBe(true);
    expect(agentCloudGroupIsActive(at("/dashboard/call-center"), grow)).toBe(false);
  });

  it("keeps Grow active on the nested recruiting routes the manifest does not list", () => {
    expect(agentCloudGroupIsActive(at("/dashboard/recruiting/hires"), grow)).toBe(true);
    expect(agentCloudGroupIsActive(at("/dashboard/recruiting/hires"), sell)).toBe(false);
  });
});

describe("isApplicantViewer", () => {
  const applicant = { authLoading: false, isAdmin: false, isManager: false, isAgent: true, hasAgentRecord: false, isPreviewing: false };

  it("is a role-agent login with no agents row, once auth has finished loading", () => {
    expect(isApplicantViewer(applicant)).toBe(true);
  });

  it.each([
    ["auth is still loading", { authLoading: true }],
    ["an agents row exists", { hasAgentRecord: true }],
    ["the login is an admin", { isAdmin: true }],
    ["the login is a manager", { isManager: true }],
    ["the login has no agent role (staff)", { isAgent: false }],
    ["a role is being previewed", { isPreviewing: true }],
  ])("is false when %s", (_label, override) => {
    expect(isApplicantViewer({ ...applicant, ...override })).toBe(false);
  });
});

describe("sidebar group expansion", () => {
  it("opens every group by default, the active one included", () => {
    const state = initialGroupExpansion(["Sell"]);
    expect(isNavGroupOpen(state, "Sell")).toBe(true);
    expect(isNavGroupOpen(state, "Grow")).toBe(true);
  });

  it("lets the user collapse the active group and keeps it collapsed while the route stays inside it", () => {
    let state = toggleNavGroup(initialGroupExpansion(["Sell"]), "Sell");
    expect(isNavGroupOpen(state, "Sell")).toBe(false);
    const sameGroup = reconcileGroupExpansion(state, ["Sell"]);
    // Same object: nothing to re-render, and the user's choice stands.
    expect(sameGroup).toBe(state);
    expect(isNavGroupOpen(sameGroup, "Sell")).toBe(false);
    state = toggleNavGroup(state, "Sell");
    expect(isNavGroupOpen(state, "Sell")).toBe(true);
  });

  it("reopens a group when the route enters it and leaves every other choice alone", () => {
    let state = toggleNavGroup(toggleNavGroup(initialGroupExpansion(["Sell"]), "Sell"), "Grow");
    expect(isNavGroupOpen(state, "Grow")).toBe(false);
    state = reconcileGroupExpansion(state, ["Grow"]);
    expect(isNavGroupOpen(state, "Grow")).toBe(true);
    expect(isNavGroupOpen(state, "Sell")).toBe(false);
    state = reconcileGroupExpansion(state, []);
    expect(isNavGroupOpen(state, "Sell")).toBe(false);
    state = reconcileGroupExpansion(state, ["Sell"]);
    expect(isNavGroupOpen(state, "Sell")).toBe(true);
    expect(isNavGroupOpen(state, "Grow")).toBe(true);
  });

  it("treats the active set as a set, not a sequence", () => {
    const state = initialGroupExpansion(["Sell", "Grow"]);
    expect(reconcileGroupExpansion(state, ["Grow", "Sell"])).toBe(state);
  });
});
