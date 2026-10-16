/**
 * F35: every settings section has one predictable home. Security holds only
 * password and session controls; the calendar feed lives under Integrations,
 * the iPhone shortcuts under Personal automation, and neither repeats on the
 * Account tab. Discord sits under Integrations for admins as a way into the
 * admin Integrations page, which saves the webhook the alert senders read.
 */
import fs from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = { isAdmin: true };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "00000000-0000-4000-8000-0000000000ee" }, isAdmin: authState.isAdmin, isLoading: false, profile: null }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() }, auth: {} } }));
vi.mock("@/components/dashboard/CalendarSyncSection", () => ({ CalendarSyncSection: () => <div>Calendar feed section</div> }));
vi.mock("@/components/dashboard/IPhoneShortcutsSection", () => ({ IPhoneShortcutsSection: () => <div>iPhone shortcuts section</div> }));
vi.mock("@/components/dashboard/ProfileSettings", () => ({ ProfileSettings: () => <div>Profile section</div> }));

import Settings from "@/pages/Settings";

const appSource = fs.readFileSync(path.resolve(__dirname, "../../App.tsx"), "utf8");

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function tabs() {
  return within(screen.getByRole("navigation", { name: "Settings sections" }));
}

beforeEach(() => {
  authState.isAdmin = true;
});

describe("Settings tabs (F35)", () => {
  it("Integrations holds the calendar feed and, for an admin, the way into Discord notifications", () => {
    renderAt("/dashboard/settings?tab=integrations");
    expect(document.title).toBe("Integrations");
    expect(screen.getByText("Calendar feed section")).toBeTruthy();
    expect(screen.queryByText("iPhone shortcuts section")).toBeNull();
    expect(screen.queryByText("Profile section")).toBeNull();

    const current = tabs().getByRole("link", { name: "Integrations" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.getAttribute("href")).toBe("/dashboard/settings?tab=integrations");

    const discord = screen.getByRole("link", { name: "Open Discord notifications" });
    expect(discord.getAttribute("href")).toBe("/dashboard/integrations");
    // The link must land on a declared, admin-only route.
    expect(appSource).toMatch(/path="\/dashboard\/integrations" element={<ProtectedRoute requireAdmin>/);
  });

  it("a non-admin gets the calendar feed without the admin-only Discord entry", () => {
    authState.isAdmin = false;
    renderAt("/dashboard/settings?tab=integrations");
    expect(screen.getByText("Calendar feed section")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open Discord notifications" })).toBeNull();
    expect(screen.queryByText("Discord notifications")).toBeNull();
  });

  it("Personal automation holds only the iPhone shortcuts", () => {
    renderAt("/dashboard/settings?tab=automation");
    expect(document.title).toBe("Personal automation");
    expect(screen.getByText("iPhone shortcuts section")).toBeTruthy();
    expect(screen.queryByText("Calendar feed section")).toBeNull();
    expect(tabs().getByRole("link", { name: "Personal automation" }).getAttribute("aria-current")).toBe("page");
  });

  it("Security holds only password and session controls", () => {
    renderAt("/dashboard/settings/security");
    expect(screen.getByText("Change password")).toBeTruthy();
    expect(screen.getByText("Active sessions")).toBeTruthy();
    expect(screen.queryByText("Calendar feed section")).toBeNull();
    expect(screen.queryByText("iPhone shortcuts section")).toBeNull();
  });

  it("Account no longer repeats the calendar feed or the shortcuts, and an unknown tab lands there", () => {
    for (const url of ["/dashboard/settings", "/dashboard/settings?tab=nope", "/dashboard/settings?force_password_change=true"]) {
      const view = renderAt(url);
      expect(screen.getByText("Profile section")).toBeTruthy();
      expect(screen.queryByText("Calendar feed section")).toBeNull();
      expect(screen.queryByText("iPhone shortcuts section")).toBeNull();
      expect(tabs().getByRole("link", { name: "Account" }).getAttribute("aria-current")).toBe("page");
      view.unmount();
    }
  });

  it("every viewer can reach Integrations and Personal automation; Agency and Billing stay owner-only", () => {
    authState.isAdmin = false;
    renderAt("/dashboard/settings");
    const names = tabs().getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual(["Account", "Notifications", "Security", "Integrations", "Personal automation", "Assistant"]);
  });

  it("a non-admin opening an owner-only tab by URL lands on Account", () => {
    authState.isAdmin = false;
    renderAt("/dashboard/settings/billing");
    expect(screen.getByText("Profile section")).toBeTruthy();
    expect(screen.queryByText("Billing & plan")).toBeNull();
  });
});
