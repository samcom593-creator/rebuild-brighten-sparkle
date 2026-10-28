import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
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
  isAgent: false,
  hasAgentRecord: false,
  isLoading: false,
  accountMode: null,
  effectiveMode: "agent" as const,
  signOut: vi.fn().mockResolvedValue({ error: null }),
};

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ ...authState }) }));
vi.mock("@/hooks/useBrand", () => ({
  useBrand: () => ({ legalName: "APEX Financial", shortName: "APEX" }),
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
vi.mock("@/components/deals/SubmitDealDialog", () => ({
  SubmitDealDialog: ({ trigger }: { trigger?: ReactNode }) => trigger ?? null,
}));
vi.mock("@/stores/agentProfileDrawer", () => ({
  useAgentProfileDrawer: (selector: (s: { openAgent: () => void }) => unknown) =>
    selector({ openAgent: vi.fn() }),
}));
const searchOpen = vi.hoisted(() => vi.fn());
vi.mock("@/shared/store/uiStore", () => ({
  useUIStore: Object.assign((selector: (s: { setAskApexOpen: () => void }) => unknown) =>
    selector({ setAskApexOpen: vi.fn() }), { getState: () => ({ setCommandPaletteOpen: searchOpen }) }),
}));

import { computeAccessibleName } from "dom-accessibility-api";
import { GlobalSidebar } from "@/components/layout/GlobalSidebar";
import { useFavoriteRoutes } from "@/components/layout/favoriteRoutes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TONE_CLASS, type Tone } from "@/lib/tones";

// The collapsed rail wraps every row in a tooltip, which needs the provider the shell mounts.
function renderSidebar(pathname = "/dashboard", mobile = false, isOpen = true) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[pathname]}>
        <GlobalSidebar mobile={mobile} isOpen={isOpen} onToggle={() => {}} isFullscreen={false} onFullscreenToggle={() => {}} />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

// The active link is tinted in its section's tone (colour layer, 2026-10-28); no other link is.
const ACTIVE_TINT = /bg-tone-\w+\/12/;

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
  authState.isAgent = false;
  authState.hasAgentRecord = false;
  authState.isLoading = false;
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
    // Interviews / Follow-ups are tabs inside Recruit Pipeline now, never standalone sidebar destinations.
    expect(link("Interviews")).toBeNull();
    expect(link("Follow-ups")).toBeNull();
    expect(link("Quoter")).toBeNull();
    expect(link("Scripts")).toBeNull();
    expect(link("Agencies")).toBeNull();
    expect(link("VA Team")).toBeNull();
    expect(link("Call list")?.getAttribute("href")).toBe("/dashboard/recruiting");
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
    expect(link("Call list")).toBeTruthy();
  });

  it("keeps high-frequency work discoverable to plain agents without internal contracting", () => {
    renderSidebar();
    expect(group("Grow")).toBeTruthy();
    // New hires, Call list and invite links are guarded to
    // managers and recruiting staff; a plain agent gets the open referral form.
    expect(link("New hires")).toBeNull();
    expect(link("Call list")).toBeNull();
    expect(link("Invite an agent")).toBeNull();
    expect(link("Refer a recruit")?.getAttribute("href")).toBe("/dashboard/referrals/new");
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
  it("gives a Pure Recruiter recruiting + calendar, and hides the selling surface", () => {
    setRoles({ isRecruiter: true, effectiveMode: "recruiter" as never });
    renderSidebar();
    expect(group("Grow")).toBeTruthy();
    expect(link("Call list")).toBeTruthy();
    expect(link("Calendar")?.getAttribute("href")).toBe("/dashboard/calendar");
    // /admin/invite-links and /dashboard/recruits do not admit recruiters.
    expect(link("Invite an agent")).toBeNull();
    expect(link("New hires")).toBeNull();
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

  it("puts permitted quick actions in the mobile navigation sheet", () => {
    setRoles({ isManager: true });
    renderSidebar("/dashboard", true);
    expect(screen.getByRole("button", { name: "Post a Deal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search people and pages" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Support desk" })).toHaveLength(1);
  });
});

describe("GlobalSidebar · recruiting active-state behavior", () => {
  const ACTIVE_GROUP_CLASS = "text-foreground";

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
    expect(link("Home")!.className).not.toMatch(ACTIVE_TINT);
    expect(link("Home")).not.toHaveAttribute("aria-current");
  });

  it("keeps a nested recruiting route from falsely marking the pipeline leaf", () => {
    setRoles({ isAdmin: true });
    renderSidebar("/dashboard/recruiting/training");
    expect(group("Grow")!.className).toContain(ACTIVE_GROUP_CLASS);
    expect(link("Call list")!.className).not.toMatch(ACTIVE_TINT);
    expect(link("Call list")).not.toHaveAttribute("aria-current");
  });

  it("Home is exact-match only", () => {
    setRoles({ isAdmin: true });
    renderSidebar("/dashboard");
    expect(link("Home")).toHaveAttribute("aria-current", "page");
    expect(link("Home")!.className).toContain(TONE_CLASS.gold.soft);
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
    expect(source).toContain("Navigation and quick actions");
    expect(source).toContain("<Sheet open={mobileOpen}");
  });
});

 it.each([false, true])("opens shared search from the sidebar (mobile=%s)", (mobile) => {
    searchOpen.mockClear();
    renderSidebar("/dashboard", mobile);
    fireEvent.click(screen.getByRole("button", { name: "Search people and pages" }));
    expect(searchOpen).toHaveBeenCalledWith(true);
  });

describe("GlobalSidebar · an active group can be collapsed (F27)", () => {
  it("collapses and reopens the group the current page sits in", () => {
    setRoles({ isAdmin: true });
    renderSidebar("/dashboard/call-center");
    expect(group("Sell")!.getAttribute("aria-expanded")).toBe("true");
    expect(link("Call Center")).toBeTruthy();
    fireEvent.click(group("Sell")!);
    expect(group("Sell")!.getAttribute("aria-expanded")).toBe("false");
    expect(link("Call Center")).toBeNull();
    fireEvent.click(group("Sell")!);
    expect(group("Sell")!.getAttribute("aria-expanded")).toBe("true");
    expect(link("Call Center")).toBeTruthy();
  });

  it("marks the current page's link with aria-current and nothing else", () => {
    setRoles({ isAdmin: true });
    renderSidebar("/dashboard/call-center");
    expect(link("Call Center")).toHaveAttribute("aria-current", "page");
    expect(link("My Pipeline")).not.toHaveAttribute("aria-current");
  });

  it("still lets a group the page is not in collapse", () => {
    setRoles({ isAdmin: true });
    renderSidebar("/dashboard/call-center");
    fireEvent.click(group("Learn")!);
    expect(group("Learn")!.getAttribute("aria-expanded")).toBe("false");
    expect(link("Call Lab")).toBeNull();
  });
});

describe("GlobalSidebar · applicant rail on every surface (F26)", () => {
  it.each([false, true])("gives an applicant the four next steps and no producer shortcuts (mobile=%s)", (mobile) => {
    setRoles({ isAgent: true, hasAgentRecord: false });
    renderSidebar("/dashboard", mobile);
    expect(link("Get licensed")?.getAttribute("href")).toBe("/get-licensed");
    expect(link("Training")?.getAttribute("href")).toBe("/dashboard/training/library");
    expect(group("Sell")).toBeNull();
    expect(link("Book of Business")).toBeNull();
    expect(screen.queryByRole("button", { name: "Post a Deal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Agent" })).toBeNull();
  });
});

describe("GlobalSidebar · one permanent Add Agent / Post a Deal pair (F37)", () => {
  it.each([false, true])("keeps Post a Deal directly under Add Agent for hiring roles (mobile=%s)", (mobile) => {
    setRoles({ isManager: true });
    renderSidebar("/dashboard", mobile);
    const addAgent = screen.getByRole("button", { name: "Add Agent" });
    const postDeal = screen.getByRole("button", { name: "Post a Deal" });
    expect(addAgent.compareDocumentPosition(postDeal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Add Agent" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Post a Deal" })).toHaveLength(1);
  });

  it("gives a plain agent Post a Deal on the desktop rail and no Add Agent", () => {
    setRoles({ isAgent: true, hasAgentRecord: true });
    renderSidebar("/dashboard", false);
    expect(screen.getByRole("button", { name: "Post a Deal" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Agent" })).toBeNull();
  });

  it("leaves the top bar with context and utilities only, so the desktop shell has one search entry and one creation pair", () => {
    const topBar = fs.readFileSync(path.resolve(__dirname, "../../components/layout/TopBar.tsx"), "utf8");
    const sidebar = fs.readFileSync(path.resolve(__dirname, "../../components/layout/GlobalSidebar.tsx"), "utf8");
    expect(topBar).not.toContain("SubmitDealDialog");
    expect(topBar).not.toContain("AddAgentModal");
    expect(topBar).not.toContain("setCommandPaletteOpen");
    expect(topBar).toContain("RolePreviewMenu");
    expect(topBar).toContain("NotificationBell");
    const searchEntries = (topBar + sidebar).match(/aria-label="Search people and pages"/g) ?? [];
    expect(searchEntries).toHaveLength(1);
  });
});

describe("GlobalSidebar · query-aware active state (F25)", () => {
  it("lights the VA's Contracting review on the contracting team view", () => {
    setRoles({ isVa: true });
    renderSidebar("/dashboard/team?view=contracting");
    expect(link("Contracting review")).toHaveAttribute("aria-current", "page");
    // Contracting review sits under Grow, so its tint is Grow's.
    expect(link("Contracting review")!.className).toContain(TONE_CLASS.royal.soft);
    expect(group("Grow")!.className).toContain("text-foreground");
  });

  it("leaves it dark on an unrelated team view", () => {
    setRoles({ isVa: true });
    renderSidebar("/dashboard/team?view=link");
    expect(link("Contracting review")).not.toHaveAttribute("aria-current");
    expect(link("Contracting review")!.className).not.toMatch(ACTIVE_TINT);
  });
});

describe("GlobalSidebar · section tones (colour layer, 2026-10-28)", () => {
  // The first aria-hidden span in a row is its bubble (a lucide svg is aria-hidden too, but it is not a span).
  const bubbleOf = (row: HTMLElement | null) => row?.querySelector('span[aria-hidden="true"]') ?? null;

  it.each([
    ["/dashboard", "Home", "gold", {}],
    ["/dashboard/call-center", "Call Center", "good", {}],
    ["/dashboard/recruiting", "Call list", "royal", { isManager: true }],
    ["/dashboard/production", "Book of Business", "good", {}],
    ["/dashboard/training/library", "Training Home", "warm", {}],
    ["/dashboard/team", "My Team", "cool", {}],
    ["/dashboard/settings/security", "Security", "slate", {}],
  ] as const)("on %s the active item (%s) carries its section's tone, %s, and no other link is tinted", (pathname, label, tone, roles) => {
    setRoles(roles as Partial<typeof authState>);
    renderSidebar(pathname);
    const active = link(label)!;
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.className).toContain(TONE_CLASS[tone as Tone].soft);
    expect(active.className).toContain("font-semibold");
    for (const other of screen.getAllByRole("link")) {
      if (other !== active) expect(other.className).not.toMatch(ACTIVE_TINT);
    }
  });

  it("puts every top-level section's icon in a bubble of its tone; a child keeps a plain icon", () => {
    setRoles({ isAdmin: true });
    renderSidebar("/dashboard/call-center");
    const expected: Array<[HTMLElement | null, Tone]> = [
      [link("Home"), "gold"], [link("My Day"), "gold"], [group("Sell"), "good"], [group("Grow"), "royal"],
      [group("My Business"), "good"], [group("Learn"), "warm"], [group("Team"), "cool"], [group("Owner"), "slate"],
      [group("Settings"), "slate"], [link("Producer Profile"), "slate"],
    ];
    for (const [row, tone] of expected) {
      const bubble = bubbleOf(row);
      expect(bubble, row?.textContent ?? "").not.toBeNull();
      expect(bubble!.className).toContain(TONE_CLASS[tone].soft);
      expect(bubble!.className).toContain(TONE_CLASS[tone].text);
      expect(bubble!.className).toContain("rounded-full");
    }
    // A child row has no bubble: the active child shows its section's tone on the icon itself.
    expect(link("Call Center")!.querySelector(".rounded-full.border")).toBeNull();
    expect(link("Call Center")!.querySelector("svg")?.getAttribute("class")).toContain(TONE_CLASS.good.text);
    expect(link("My Pipeline")!.querySelector("svg")?.getAttribute("class")).not.toContain(TONE_CLASS.good.text);
    // The active group's label firms up; its words, not only its colour, say where the person is.
    expect(group("Sell")!.className).toContain("font-semibold");
    expect(group("Grow")!.className).not.toContain("font-semibold");
  });

  it("gives a favourite the tone of the section that owns its page", () => {
    setRoles({ isManager: true });
    useFavoriteRoutes.getState().toggleFavorite("/dashboard/recruiting", "Call list");
    try {
      renderSidebar("/dashboard/recruiting");
      const rows = screen.getAllByRole("link", { name: "Call list" });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toHaveAttribute("aria-current", "page");
        expect(row.className).toContain(TONE_CLASS.royal.soft);
      }
    } finally {
      useFavoriteRoutes.getState().toggleFavorite("/dashboard/recruiting", "Call list");
    }
  });

  it("names every icon-only control when the rail is collapsed", () => {
    setRoles({ isAdmin: true });
    renderSidebar("/dashboard/recruiting", false, false);
    const controls = [...screen.getAllByRole("link"), ...screen.getAllByRole("button")];
    expect(controls.length).toBeGreaterThan(10);
    for (const control of controls) {
      // Icon-only: the label is not rendered, so the name must come from aria-label.
      expect(control.textContent?.trim(), control.outerHTML.slice(0, 120)).toBe("");
      expect(computeAccessibleName(control), control.outerHTML.slice(0, 120)).not.toBe("");
    }
    // Collapsed, a group shows only its bubble (its children stay hidden until the rail expands).
    expect(screen.getByRole("button", { name: "Grow" })).toBeTruthy();
    expect(link("Call list")).toBeNull();
    expect(screen.getByRole("link", { name: "Home" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "APEX Financial" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("names every control in the expanded rail and the phone sheet too", () => {
    setRoles({ isManager: true });
    for (const mobile of [false, true]) {
      const view = renderSidebar("/dashboard/recruiting", mobile);
      for (const control of [...screen.getAllByRole("link"), ...screen.getAllByRole("button")]) {
        expect(computeAccessibleName(control), control.outerHTML.slice(0, 120)).not.toBe("");
      }
      view.unmount();
    }
  });

  it("colours the quick-action icons (Add Agent good, Post a Deal gold) and keeps both outline, never a second gold fill", () => {
    setRoles({ isManager: true });
    renderSidebar("/dashboard", true);
    const addAgent = screen.getByRole("button", { name: "Add Agent" });
    const postDeal = screen.getByRole("button", { name: "Post a Deal" });
    expect(addAgent.querySelector("svg")?.getAttribute("class")).toContain(TONE_CLASS.good.text);
    expect(postDeal.querySelector("svg")?.getAttribute("class")).toContain(TONE_CLASS.gold.text);
    for (const button of [addAgent, postDeal]) {
      expect(button.className).toContain("border-input");
      expect(button.className).not.toContain("bg-primary");
      expect(button.className).toContain("h-11");
    }
  });
});
