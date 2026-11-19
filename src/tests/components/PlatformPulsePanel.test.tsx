/**
 * PlatformPulsePanel (MP-BEST-2, 2026-11-19): the owner's read on who really uses the platform.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  auth: { isAdmin: true },
  calls: [] as string[],
  reply: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => env.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string) => { env.calls.push(fn); return Promise.resolve(env.reply); } },
}));

import { PlatformPulsePanel, PULSE_FILTERS, screenName, speedBand, type PlatformPulse, type PulseAgent } from "@/components/dashboard/PlatformPulsePanel";

const agent = (name: string, over: Partial<PulseAgent> = {}): PulseAgent => ({
  agent_id: `id-${name}`, user_id: `u-${name}`, display_name: name, manager_name: "Chudi", license_status: "licensed", stage: "live",
  hired_at: "2026-09-01T00:00:00Z", last_seen: new Date(Date.now() - 3_600_000).toISOString(), views_7d: 0, views_30d: 0, days_30d: 0,
  phone_views_30d: 0, top_page: null, deals_30d: 0, last_deal: null, leads_held: 0, leads_untouched: 0, leads_sold: 0, leads_warm: 0,
  last_worked: null, ...over,
});

const pulse = (): PlatformPulse => ({
  generated_at: new Date().toISOString(),
  team: { active_agents: 5, with_login: 4, seen_7d: 2, seen_30d: 3, seen_90d: 4, sold_30d: 1, selling_on_platform: 1, selling_off_platform: 0, on_platform_not_selling: 2, dark: 2 },
  daily: [{ day: "2026-11-17", agents: 2 }, { day: "2026-11-18", agents: 4 }, { day: "2026-11-19", agents: 1 }],
  agents: [
    agent("Seller", { views_7d: 30, views_30d: 120, days_30d: 20, deals_30d: 6, top_page: "/dashboard/my-leads", leads_held: 100, leads_untouched: 10 }),
    agent("Trier", { views_7d: 12, views_30d: 40, days_30d: 9, top_page: "/dashboard/my-leads", leads_held: 50, leads_untouched: 45 }),
    agent("Learner", { views_30d: 8, days_30d: 3, top_page: "/dashboard/training/sales-course" }),
    agent("Quiet", { last_seen: null }),
    agent("NoLogin", { user_id: null, last_seen: null }),
  ],
  pages: [{ path: "/dashboard", views: 300, people: 4, phone_views: 90 }, { path: "/dashboard/my-leads", views: 200, people: 3, phone_views: 20 }],
  speed: [{ path: "/agent-portal", samples: 19, p75_ms: 4068 }, { path: "/dashboard", samples: 137, p75_ms: 2468 }, { path: "/dashboard/lead-manager", samples: 28, p75_ms: 2823 }],
  leads: { held: 150, untouched: 55, worked: 95, sold: 5, warm: 14, holders: 2 },
  stability: { forced_reloads_7d: 20, forced_reload_people_7d: 9, forced_reloads_30d: 87, other_crashes_30d: 0, other_crash_people_30d: 0 },
});

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PlatformPulsePanel /></QueryClientProvider>);
}
const rosterNames = () => within(screen.getByTestId("pulse-roster")).getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent);

describe("PlatformPulsePanel", () => {
  beforeEach(() => {
    env.auth.isAdmin = true;
    env.calls.length = 0;
    env.reply = { data: pulse(), error: null };
  });

  it("renders nothing and never asks the database for a non-admin", () => {
    env.auth.isAdmin = false;
    const { container } = renderPanel();
    expect(container.firstChild).toBeNull();
    expect(env.calls).toEqual([]);
  });

  it("says the split in one sentence and opens on the people who log in without selling, most active first", async () => {
    renderPanel();
    const headline = await screen.findByTestId("pulse-headline");
    expect(headline.textContent).toContain("5 active agents");
    expect(headline.textContent).toContain("every one of them uses the platform");
    expect(headline.textContent).toContain("2 log in without selling yet, and 2 did neither");
    expect(rosterNames()).toEqual(["Trier", "Learner"]);
    expect(env.calls).toEqual(["admin_platform_pulse"]);
  });

  it("each tile counts its group and filters the list; untouched leads sort worst first", async () => {
    renderPanel();
    await screen.findByTestId("pulse-roster");
    const tile = (label: string) => screen.getByRole("button", { name: new RegExp(label) });
    expect(tile("Holding untouched leads").textContent).toContain("2");
    expect(tile("Dark for 30 days").textContent).toContain("2");
    fireEvent.click(tile("Holding untouched leads"));
    expect(rosterNames()).toEqual(["Trier", "Seller"]);
    expect(screen.getByText("45 of 50")).toBeTruthy();
    fireEvent.click(tile("Dark for 30 days"));
    expect(rosterNames()).toEqual(["NoLogin", "Quiet"]);
    expect(screen.getByText("No login yet")).toBeTruthy();
    expect(screen.getByText("Not in 90 days")).toBeTruthy();
  });

  it("states the lead work rate from the totals, not from the roster", async () => {
    renderPanel();
    const line = await screen.findByTestId("pulse-leads-line");
    expect(line.textContent).toContain("55 of 150 leads in live packs have never been called");
    expect(line.textContent).toContain("(37%)");
  });

  it("labels each screen's speed with a word and an icon, and names screens the way the menu does", async () => {
    renderPanel();
    await screen.findByTestId("pulse-roster");
    expect(screen.getByText("Slow")).toBeTruthy();
    expect(screen.getByText("Fast")).toBeTruthy();
    expect(screen.getByText("Needs work")).toBeTruthy();
    expect(screen.getAllByText("My Leads").length).toBeGreaterThan(0);
    expect(screen.getByText("4.1s")).toBeTruthy();
  });

  it("shows the failure, with a retry, instead of an empty all-clear when the read fails", async () => {
    env.reply = { data: null, error: { code: "42501", message: "admin only" } };
    renderPanel();
    await waitFor(() => expect(screen.getByText(/do not have permission/i)).toBeTruthy());
    expect(screen.queryByTestId("pulse-headline")).toBeNull();
  });
});

describe("pulse helpers", () => {
  it("speed bands follow the 2.5s and 4s lines", () => {
    expect(speedBand(2500).label).toBe("Fast");
    expect(speedBand(2501).label).toBe("Needs work");
    expect(speedBand(4000).label).toBe("Needs work");
    expect(speedBand(4001).label).toBe("Slow");
  });
  it("names a screen by its sidebar label, falls back to known extras, then to the path itself", () => {
    expect(screenName("/dashboard")).toBe("Home");
    expect(screenName("/dashboard/production")).toBe("Book of Business");
    expect(screenName("/agent-portal")).toBe("Agent portal");
    expect(screenName("/somewhere/new")).toBe("/somewhere/new");
    expect(screenName(null)).toBe("No screen on record");
  });
  it("the five groups are disjoint where they claim to be: selling, logging in without selling, and dark cover everyone once", () => {
    const by = (k: string) => PULSE_FILTERS.find((f) => f.key === k)!.test;
    for (const a of pulse().agents) {
      expect([by("selling")(a), by("not_selling")(a), by("dark")(a)].filter(Boolean)).toHaveLength(1);
    }
  });
});
