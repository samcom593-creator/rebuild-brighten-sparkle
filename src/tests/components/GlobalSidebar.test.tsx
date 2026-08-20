import { describe, it, expect, vi, beforeEach } from "vitest";
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
};

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ ...authState }) }));
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
vi.mock("@/components/dashboard/AddAgentModal", () => ({ AddAgentModal: () => null }));
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

function setRoles(roles: Partial<typeof authState>) {
  authState.isAdmin = false;
  authState.isManager = false;
  authState.isVaManager = false;
  authState.isVa = false;
  Object.assign(authState, roles);
}

beforeEach(() => {
  setRoles({});
  window.localStorage.clear();
});

describe("GlobalSidebar · unified recruiting navigation", () => {
  it("gives admins one recruiting destination instead of a separate Interviews product", () => {
    setRoles({ isAdmin: true });
    renderSidebar();
    expect(link("Recruiting")?.getAttribute("href")).toBe("/dashboard/recruiting");
    expect(link("Interviews")).toBeNull();
  });

  it.each([
    ["manager", { isManager: true }],
    ["va_manager", { isVaManager: true }],
    ["va", { isVa: true }],
  ])("shows the unified Recruiting workspace to %s", (_label, roles) => {
    setRoles(roles as Partial<typeof authState>);
    renderSidebar();
    expect(link("Recruiting")).toBeTruthy();
    expect(link("Interviews")).toBeNull();
  });

  it("hides Interviews (and the rest of the staff cluster) from plain agents", () => {
    renderSidebar();
    expect(link("Interviews")).toBeNull();
    expect(link("Recruiting")).toBeNull();
    expect(link("Team")).toBeNull();
    expect(link("Admin")).toBeNull();
    // Non-staff items still render.
    expect(link("Call Center")).toBeTruthy();
    expect(link("Contracting")).toBeTruthy();
  });

  it("keeps the complete ten-destination admin map visible", () => {
    setRoles({ isAdmin: true });
    renderSidebar();
    expect(link("Admin")).toBeTruthy();
    for (const label of [
      "Home", "Recruiting", "Call Center", "Team", "Contracting",
      "Production", "Reports", "Resources", "Community", "Admin",
    ]) {
      expect(link(label)).toBeTruthy();
    }
  });
});

describe("GlobalSidebar · recruiting active-state behavior", () => {
  const ACTIVE_CLASS = "border-primary";

  it.each([
    "/dashboard/recruiting",
    "/dashboard/recruiting/interviews",
    "/dashboard/recruiting/follow-ups",
    "/dashboard/recruiting/hires",
  ])("keeps Recruiting active across %s", (pathname) => {
    setRoles({ isAdmin: true });
    renderSidebar(pathname);
    expect(link("Recruiting")!.className).toContain(ACTIVE_CLASS);
    expect(link("Home")!.className).not.toContain(ACTIVE_CLASS);
  });

  it("Home is exact-match only", () => {
    setRoles({ isAdmin: true });
    renderSidebar("/dashboard");
    expect(link("Home")!.className).toContain(ACTIVE_CLASS);
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
