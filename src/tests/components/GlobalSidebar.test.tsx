import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";

// The sidebar pulls in the full app shell graph; everything with side effects
// or network is mocked so these tests exercise exactly the nav contract:
// which items render for which role, and which item is active on which path.
const authState = {
  user: { id: "u1", email: "sam@example.com", user_metadata: { full_name: "Sam" } } as unknown,
  isAdmin: false,
  isManager: false,
  isVaManager: false,
  isVa: false,
  isRecruiter: false,
  accountMode: null,
  effectiveMode: "agent" as const,
  signOut: vi.fn().mockResolvedValue({ error: null }),
};

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ ...authState }) }));
vi.mock("@/hooks/useBrand", () => ({
  useBrand: () => ({ legalName: "APEX Financial" }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    auth: { signOut: vi.fn() },
    rpc: vi.fn(),
  },
}));
vi.mock("@/lib/looseSupabase", () => ({ looseSupabase: { from: vi.fn() } }));
vi.mock("@/hooks/useIsTouchDevice", () => ({ useIsTouchDevice: () => false }));
vi.mock("@/hooks/useSoundEffects", () => ({ useSoundEffects: () => ({ playSound: vi.fn() }) }));
vi.mock("@/components/layout/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/onboarding/QuickAddAgentDialog", () => ({ QuickAddAgentDialog: () => null }));
vi.mock("@/components/dashboard/AddAgentModal", () => ({
  AddAgentModal: ({ trigger }: { trigger?: ReactNode }) => trigger ?? null,
}));
vi.mock("@/components/deals/SubmitDealDialog", () => ({ SubmitDealDialog: () => null }));
vi.mock("@/stores/agentProfileDrawer", () => ({
  useAgentProfileDrawer: (selector: (s: { openAgent: () => void }) => unknown) =>
    selector({ openAgent: vi.fn() }),
}));
vi.mock("@/shared/store/uiStore", () => ({
  useUIStore: (selector: (s: { setAskApexOpen: () => void }) => unknown) =>
    selector({ setAskApexOpen: vi.fn() }),
}));

import { GlobalSidebar } from "@/components/layout/GlobalSidebar";

function renderSidebar(pathname = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <GlobalSidebar isOpen onToggle={() => {}} isFullscreen={false} onFullscreenToggle={() => {}} />
    </MemoryRouter>,
  );
}

function link(name: string) {
  return screen.queryByRole("link", { name });
}

function group(name: string) {
  return screen.queryByRole("button", { name });
}

function setRoles(roles: Partial<typeof authState>) {
  authState.isAdmin = false;
  authState.isManager = false;
  authState.isVaManager = false;
  authState.isVa = false;
  authState.isRecruiter = false;
  authState.accountMode = null;
  Object.assign(authState, roles);
  // MP-332: the sidebar filters on the resolved account mode, so a role flag
  // set here must resolve the same way useAuth resolves it (admin wins, then
  // an explicit mode, then roles).
  if (!("effectiveMode" in roles)) {
    (authState as { effectiveMode: string }).effectiveMode =
      authState.isAdmin ? "admin"
      : authState.isVaManager ? "va_manager"
      : authState.isVa ? "va"
      : authState.isRecruiter ? "recruiter"
      : authState.isManager ? "manager"
      : "agent";
  }
}

beforeEach(() => {
  setRoles({});
  window.localStorage.clear();
});

describe("GlobalSidebar · AgentCloud application navigation", () => {
  it("keeps recruiting actions inside the Grow group", () => {
    setRoles({ isAdmin: true });
    renderSidebar();
    expect(group("Grow")).toBeTruthy();
    expect(link("Interviews")?.getAttribute("href")).toBe("/dashboard/recruiting/interviews");
    expect(link("Recruit Pipeline")?.getAttribute("href")).toBe("/dashboard/recruiting");
    expect(link("Invite an agent")?.getAttribute("href")).toBe("/admin/invite-links");
  });

  it.each([
    ["manager", { isManager: true }],
    ["va_manager", { isVaManager: true }],
    ["va", { isVa: true }],
  ])("shows the recruiting workspace to %s", (_label, roles) => {
    setRoles(roles as Partial<typeof authState>);
    renderSidebar();
    expect(group("Grow")).toBeTruthy();
    expect(link("Interviews")).toBeTruthy();
    expect(link("Recruit Pipeline")).toBeTruthy();
  });

  it("keeps high-frequency work discoverable to plain agents without internal contracting", () => {
    renderSidebar();
    expect(group("Grow")).toBeTruthy();
    expect(link("Interviews")).toBeTruthy();
    expect(group("Learn")).toBeTruthy();
    expect(link("Training Home")).toBeTruthy();
    expect(link("Call Center")).toBeTruthy();
    expect(link("My Contracts")).toBeNull();
    expect(link("Finances")).toBeNull();
  });

  it("keeps the complete grouped admin map visible", () => {
    setRoles({ isAdmin: true });
    renderSidebar();
    for (const label of ["Sell", "Grow", "My Business", "Learn", "Team", "Owner", "Settings"]) {
      expect(group(label)).toBeTruthy();
    }
    for (const label of ["Home", "Reports", "Finances", "Training Home", "Nova Pro", "Producer Profile"]) {
      expect(link(label)).toBeTruthy();
    }
  });

  // MP-332 — mode-tailored nav. A Pure Recruiter sees recruiting, never the
  // selling surface; VA staff see the queues they work, never Clients; an
  // Agency Owner sees Reports (a leader surface) that a plain agent does not.
  it("gives a Pure Recruiter recruiting + invite, and hides the selling surface", () => {
    setRoles({ isRecruiter: true, effectiveMode: "recruiter" as never });
    renderSidebar();
    expect(group("Grow")).toBeTruthy();
    expect(link("Interviews")).toBeTruthy();
    expect(link("Follow-ups")).toBeTruthy();
    expect(link("Invite an agent")).toBeTruthy();
    expect(group("Sell")).toBeNull();
    expect(link("Book of Business")).toBeNull();
    expect(link("Quoter")).toBeNull();
    expect(link("Nova Pro")).toBeTruthy();
    expect(link("Producer Profile")).toBeNull();
  });

  it("gives VA staff the call center and recruiting workspace without producer books", () => {
    setRoles({ isVa: true });
    renderSidebar();
    expect(group("Grow")).toBeTruthy();
    expect(group("Sell")).toBeTruthy();
    expect(link("Call Center")).toBeTruthy();
    expect(link("Book of Business")).toBeNull();
  });

  it("shows producer and team surfaces to an Agency Owner without owner-only reports", () => {
    setRoles({ isManager: true, effectiveMode: "agency_owner" as never });
    renderSidebar();
    expect(group("Sell")).toBeTruthy();
    expect(group("Team")).toBeTruthy();
    expect(link("My Team")).toBeTruthy();
    expect(link("Reports")).toBeNull();
  });

  it("hides Reports from a plain agent", () => {
    setRoles({});
    renderSidebar();
    expect(link("Reports")).toBeNull();
  });

  it("keeps the canonical Add Agent action pinned at the bottom for hiring roles", () => {
    setRoles({ isManager: true });
    renderSidebar();
    expect(screen.getByRole("button", { name: "Add Agent" })).toBeTruthy();
  });

  it("keeps sign out visible for every signed-in role", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});

describe("GlobalSidebar · recruiting active-state behavior", () => {
  const ACTIVE_GROUP_CLASS = "text-foreground";
  const ACTIVE_LINK_CLASS = "bg-primary/15";

  it.each([
    "/dashboard/recruiting",
    "/dashboard/recruiting/interviews",
    "/dashboard/recruiting/follow-ups",
    "/dashboard/recruiting/hires",
    "/dashboard/recruiting/training",
  ])("keeps Grow active across %s", (pathname) => {
    setRoles({ isAdmin: true });
    renderSidebar(pathname);
    expect(group("Grow")!.className).toContain(ACTIVE_GROUP_CLASS);
    expect(link("Home")!.className).not.toContain(ACTIVE_LINK_CLASS);
  });

  it("keeps a nested recruiting route from falsely marking the pipeline leaf", () => {
    setRoles({ isAdmin: true });
    renderSidebar("/dashboard/recruiting/training");
    expect(group("Grow")!.className).toContain(ACTIVE_GROUP_CLASS);
    expect(link("Recruit Pipeline")!.className).not.toContain(ACTIVE_LINK_CLASS);
  });

  it("Home is exact-match only", () => {
    setRoles({ isAdmin: true });
    renderSidebar("/dashboard");
    expect(link("Home")!.className).toContain(ACTIVE_LINK_CLASS);
  });
});

describe("SidebarLayout · mobile drawer contract", () => {
  it("renders GlobalSidebar for both desktop rail and mobile drawer", () => {
    // The mobile drawer must stay a GlobalSidebar render — a separate mobile
    // nav is how role-specific workspace entries went missing on phones before.
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../components/layout/SidebarLayout.tsx"),
      "utf8",
    );
    const renders = source.match(/<GlobalSidebar/g) ?? [];
    expect(renders.length).toBe(2);
    expect(source).toMatch(/mobileOpen/);
  });
});
