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

function group(name: string) {
  return screen.queryByRole("button", { name });
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

describe("GlobalSidebar · AgentCloud application navigation", () => {
  it("keeps every recruiting application inside one expanded group", () => {
    setRoles({ isAdmin: true });
    renderSidebar();
    expect(group("Recruiting")).toBeTruthy();
    expect(link("Interviews")?.getAttribute("href")).toBe("/dashboard/recruiting/interviews");
    expect(link("APEX Training")?.getAttribute("href")).toBe("/dashboard/recruiting/training");
  });

  it.each([
    ["manager", { isManager: true }],
    ["va_manager", { isVaManager: true }],
    ["va", { isVa: true }],
  ])("shows the AgentCloud recruiting applications to %s", (_label, roles) => {
    setRoles(roles as Partial<typeof authState>);
    renderSidebar();
    expect(group("Recruiting")).toBeTruthy();
    expect(link("Interviews")).toBeTruthy();
    expect(link("APEX Training")).toBeTruthy();
  });

  it("keeps non-admin AgentCloud applications discoverable to plain agents", () => {
    renderSidebar();
    expect(group("Recruiting")).toBeTruthy();
    expect(link("Interviews")).toBeTruthy();
    expect(link("APEX Training")).toBeTruthy();
    expect(link("Call Center")).toBeTruthy();
    expect(group("Contracting")).toBeTruthy();
    expect(link("Finances")).toBeNull();
  });

  it("keeps the complete grouped admin map visible", () => {
    setRoles({ isAdmin: true });
    renderSidebar();
    for (const label of ["Clients", "Recruiting", "Agency", "Contracting", "Tools", "Settings"]) {
      expect(group(label)).toBeTruthy();
    }
    for (const label of ["Home", "Reports", "Finances", "Resources", "Nova", "Producer Profile"]) {
      expect(link(label)).toBeTruthy();
    }
  });
});

describe("GlobalSidebar · recruiting active-state behavior", () => {
  const ACTIVE_GROUP_CLASS = "text-white";
  const ACTIVE_LINK_CLASS = "bg-[#C9A961]/15";

  it.each([
    "/dashboard/recruiting",
    "/dashboard/recruiting/interviews",
    "/dashboard/recruiting/follow-ups",
    "/dashboard/recruiting/hires",
    "/dashboard/recruiting/training",
  ])("keeps Recruiting active across %s", (pathname) => {
    setRoles({ isAdmin: true });
    renderSidebar(pathname);
    expect(group("Recruiting")!.className).toContain(ACTIVE_GROUP_CLASS);
    expect(link("Home")!.className).not.toContain(ACTIVE_LINK_CLASS);
  });

  it("marks APEX Training without also marking the pipeline", () => {
    setRoles({ isAdmin: true });
    renderSidebar("/dashboard/recruiting/training");
    expect(link("APEX Training")!.className).toContain(ACTIVE_LINK_CLASS);
    expect(screen.getAllByRole("link", { name: "Pipeline" }).every((item) => !item.className.includes(ACTIVE_LINK_CLASS))).toBe(true);
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
