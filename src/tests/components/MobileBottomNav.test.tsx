import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The bottom nav reads the resolved account mode and the applicant signals
// from useAuth, and follows Sam's role preview. Both hooks are stubbed so the
// tests exercise exactly the ladder choice and the active-tab rule.
const authState = {
  effectiveMode: "agent" as string,
  isAdmin: false,
  isManager: false,
  isAgent: true,
  hasAgentRecord: true,
  isLoading: false,
};
const preview = { isPreviewing: false, effectiveRole: "agent" as string };

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ ...authState }) }));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ ...preview }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));

import { MobileBottomNav } from "@/components/layout/MobileBottomNav";

function renderNav(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MobileBottomNav />
    </MemoryRouter>,
  );
}

const tab = (name: string) => screen.queryByRole("button", { name });
const activeTabLabel = () =>
  screen.queryAllByRole("button").find((button) => button.getAttribute("aria-current") === "page")?.textContent ?? null;

beforeEach(() => {
  Object.assign(authState, { effectiveMode: "agent", isAdmin: false, isManager: false, isAgent: true, hasAgentRecord: true, isLoading: false });
  Object.assign(preview, { isPreviewing: false, effectiveRole: "agent" });
});

describe("MobileBottomNav · staff Contracting tab active state (F25)", () => {
  beforeEach(() => {
    authState.effectiveMode = "va";
    authState.isAgent = false;
  });

  it("is active on the contracting team view", () => {
    renderNav("/dashboard/team?view=contracting");
    expect(tab("Contracting")?.getAttribute("aria-current")).toBe("page");
    expect(activeTabLabel()).toBe("Contracting");
  });

  it("is not active on an unrelated team view", () => {
    renderNav("/dashboard/team?view=link");
    expect(tab("Contracting")).toBeTruthy();
    expect(tab("Contracting")?.getAttribute("aria-current")).toBeNull();
    expect(activeTabLabel()).toBeNull();
  });

  it("is not active on the bare team page", () => {
    renderNav("/dashboard/team");
    expect(tab("Contracting")?.getAttribute("aria-current")).toBeNull();
  });

  it("keeps path-only tabs active on nested routes", () => {
    renderNav("/dashboard/recruiting/hires");
    expect(activeTabLabel()).toBe("Recruiting");
  });
});

describe("MobileBottomNav · active rule goes through the shared manifest", () => {
  it("keeps the recruiter's Settings tab lit on a nested settings page, where the desktop rail lists its own item", () => {
    authState.effectiveMode = "recruiter";
    renderNav("/dashboard/settings/notifications");
    expect(activeTabLabel()).toBe("Settings");
  });

  it("lights Home on the home route only, as the manifest does", () => {
    Object.assign(authState, { effectiveMode: "admin", isAdmin: true });
    renderNav("/dashboard/production");
    expect(activeTabLabel()).toBe("Production");
    expect(tab("Home")?.getAttribute("aria-current")).toBeNull();
  });

  it("follows the manifest's nested rule for a tab that declares no exception", () => {
    Object.assign(authState, { effectiveMode: "admin", isAdmin: true });
    renderNav("/dashboard/team/attendance");
    expect(activeTabLabel()).toBe("Team");
  });
});

describe("MobileBottomNav · applicant ladder (F26)", () => {
  it("gives an applicant the same four next steps as the desktop rail and no producer shortcuts", () => {
    authState.hasAgentRecord = false;
    renderNav("/dashboard");
    for (const label of ["Home", "Get licensed", "Training", "Support desk"]) {
      expect(tab(label)).toBeTruthy();
    }
    for (const label of ["Numbers", "Book", "Pipeline", "Profile"]) {
      expect(tab(label)).toBeNull();
    }
    expect(activeTabLabel()).toBe("Home");
  });

  it("keeps the producer ladder for an agent with an agents row", () => {
    renderNav("/dashboard/production");
    expect(tab("Get licensed")).toBeNull();
    expect(activeTabLabel()).toBe("Book");
  });

  it("does not flash the applicant ladder while auth is still loading", () => {
    authState.hasAgentRecord = false;
    authState.isLoading = true;
    renderNav("/dashboard");
    expect(tab("Get licensed")).toBeNull();
    expect(tab("Book")).toBeTruthy();
  });

  it("follows a role preview instead of the applicant rule", () => {
    Object.assign(authState, { isAdmin: true, effectiveMode: "admin", isAgent: false, hasAgentRecord: false });
    Object.assign(preview, { isPreviewing: true, effectiveRole: "va" });
    renderNav("/dashboard");
    expect(tab("Contracting")).toBeTruthy();
    expect(tab("Admin")).toBeNull();
    expect(tab("Get licensed")).toBeNull();
  });
});
