import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Request = { table: string; columns: string; filters: Array<[string, unknown]>; limit?: number };
const db = vi.hoisted(() => ({
  rows: [] as Row[], rewards: [] as Row[], requests: [] as Request[],
  failTable: null as string | null, nullTable: null as string | null,
  missingIdentity: false, pending: false,
}));
const auth = vi.hoisted(() => ({ user: { id: "viewer-a" }, isAdmin: true, isManager: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-11-25" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: (table: string) => {
      const request: Request = { table, columns: "", filters: [] };
      db.requests.push(request);
      let range: [number, number] | null = null;
      const result = (single = false) => {
        if (db.pending) return new Promise(() => {});
        if (db.failTable === table) return Promise.resolve({ data: null, error: new Error("History unavailable") });
        if (db.nullTable === table) return Promise.resolve({ data: null, error: null });
        let rows: Row[] = table === "plaque_awards" ? db.rows : table === "agentlink_rewards" ? db.rewards
          : table === "agents" ? [
            { id: "agent-a", user_id: "viewer-a", display_name: "Synthetic Alpha", profile_id: "profile-a" },
            { id: "agent-b", user_id: "viewer-b", display_name: "Synthetic Beta", profile_id: "profile-b" },
          ] : table === "v_profile_directory" ? [{ id: "profile-a", full_name: "Synthetic Alpha", instagram_handle: null }] : [];
        if (db.missingIdentity && table === "agents" && request.columns === "id") rows = [];
        for (const [key, value] of request.filters) rows = rows.filter(row => Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
        if (range) rows = rows.slice(range[0], range[1] + 1);
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null });
      };
      const query = {
        select: (columns: string) => { request.columns = columns; return query; },
        eq: (key: string, value: unknown) => { request.filters.push([key, value]); return query; },
        in: (key: string, value: unknown[]) => { request.filters.push([key, value]); return query; },
        order: () => query, limit: (value: number) => { request.limit = value; return query; }, abortSignal: () => query,
        range: (from: number, to: number) => { range = [from, to]; return query; },
        single: () => result(true), maybeSingle: () => result(true),
        then: (resolve: (value: unknown) => unknown) => result().then(resolve),
      };
      return query;
    },
  },
}));

import HallOfFame from "@/pages/HallOfFame";
import MyPlaques from "@/pages/MyPlaques";
import PlaqueShare, { buildPlaqueShareCaption } from "@/pages/PlaqueShare";

const clients: QueryClient[] = [];
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const writeText = vi.fn<(text: string) => Promise<void>>();
function page(node: ReactNode, client: QueryClient) {
  return <QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>;
}
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return { ...render(page(node, client)), client };
}
function award(id: string, milestone_type: string, amount: number | null, overrides: Row = {}) {
  return {
    id, agent_id: "agent-a", milestone_type, milestone_date: "2026-11-24", amount,
    badge_label: id, color_hex: null, image_png_url: `/synthetic-${id}.png`, image_svg_url: null,
    custom_photo_url: null, awarded_at: "2026-11-24T18:00:00Z", created_at: "2026-11-24T18:00:00Z",
    share_slug: `public-${id}`, agent: { id: "agent-a", user_id: null, display_name: "Synthetic Alpha" }, ...overrides,
  };
}

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  auth.user = { id: "viewer-a" }; auth.isAdmin = true; auth.isManager = false;
  db.requests = []; db.failTable = null; db.nullTable = null; db.missingIdentity = false; db.pending = false; db.rewards = [];
  db.rows = [
    award("Monthly builder", "month_builder", 5, { milestone_date: "2026-11-01" }),
    award("Streak", "hot_streak", 7),
    award("Monthly production", "monthly_20k", 24750.5),
    award("Daily production", "single_day", 5000),
    award("Comeback", "comeback_champion", 900),
    award("Unmapped title", "10K CLUB", 10000),
    award("Missing premium", "first_deal_ever", null),
  ];
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

describe("legacy award unit presentation", () => {
  it("renders mixed Hall of Fame values with their actual units and keeps count standings", async () => {
    mount(<HallOfFame />);
    await screen.findByText("Monthly hires");
    const hireCard = within(screen.getByText("Monthly builder").closest("button")!);
    expect(hireCard.getByText("5")).toBeInTheDocument();
    expect(hireCard.queryByText("$5")).not.toBeInTheDocument();
    expect(hireCard.getByText("Milestone month: November 2026")).toBeInTheDocument();
    const streakCard = within(screen.getByText("Streak").closest("button")!);
    expect(streakCard.getByText("Streak days")).toBeInTheDocument();
    expect(streakCard.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("$24,750.50")).toBeInTheDocument();
    expect(screen.getByText("Recorded premium increase")).toBeInTheDocument();
    expect(screen.getByText("Recorded value · unit unavailable")).toBeInTheDocument();
    expect(screen.getByText("Premium not on file")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("by plaque count")).toBeInTheDocument());
    expect(screen.getAllByText("Milestone types").length).toBeGreaterThan(0);
    expect(screen.queryByText("Recorded award amounts")).not.toBeInTheDocument();
    expect(screen.queryByText("Total $")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Monthly builder").closest("button")!);
    const detail = within(screen.getByRole("dialog"));
    expect(detail.getByText("Monthly hires")).toBeInTheDocument();
    expect(detail.getByText("Milestone month: November 2026")).toBeInTheDocument();
  });

  it("keeps Hall of Fame load failures ahead of empty wall or leaderboard messages", async () => {
    db.failTable = "plaque_awards";
    mount(<HallOfFame />);
    await screen.findByText("Award totals could not be verified.");
    expect(screen.getByText("The plaque wall didn't load")).toBeInTheDocument();
    expect(screen.getByText("The leaderboard didn't load")).toBeInTheDocument();
    expect(screen.queryByText("No plaques awarded yet")).not.toBeInTheDocument();
    expect(screen.queryByText("No plaques match these filters")).not.toBeInTheDocument();
  });

  it("shows typed facts alongside original My Plaques artwork", async () => {
    mount(<MyPlaques />);
    await screen.findByText("Monthly hires: 5");
    expect(screen.getByText("Streak days: 7")).toBeInTheDocument();
    expect(screen.getByText("Recorded ALP: $24,750.50")).toBeInTheDocument();
    expect(screen.getByText("Recorded premium: $5,000")).toBeInTheDocument();
    expect(screen.getByText("Recorded premium increase: $900")).toBeInTheDocument();
    expect(screen.getByText("Recorded value · unit unavailable: 10,000")).toBeInTheDocument();
    expect(screen.getByText("Recorded ALP: Premium not on file")).toBeInTheDocument();
    expect(screen.getByText("Milestone month: November 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Original artwork")).toHaveLength(7);
  });

  it("copies a historical plaque link on Galaxy using its existing slug", async () => {
    db.rows = [award("Daily production", "single_day", 5000, { share_slug: "public-token_AbC-123" })];
    mount(<MyPlaques />);
    await screen.findByText("Recorded premium: $5,000");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://galaxyfinancial.org/plaque/public-token_AbC-123"));
  });

  it("keeps zero hires as a count in the generated fallback rather than dollars or missing data", async () => {
    db.rows = [award("Daily recruiting", "day_on_the_board", 0, { image_png_url: null })];
    mount(<MyPlaques />);
    expect(await screen.findByText("Daily hires: 0")).toBeInTheDocument();
    expect(screen.queryByText("BIG SALE")).not.toBeInTheDocument();
  });

  it("shares the public slug's recorded hiring facts and month without a dollar claim", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const sharePath = "/plaque/public-Monthly%20builder?via=share%20sheet&token=Ab%2F123#award";
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[sharePath]}><Routes><Route path="/plaque/:slug" element={<PlaqueShare />} /></Routes></MemoryRouter></QueryClientProvider>);
    await screen.findByText("Monthly hires");
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Milestone month: November 2026")).toBeInTheDocument();
    expect(screen.getByText("Original artwork")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "X" }));
    const caption = new URL(String(open.mock.calls[0][0])).searchParams.get("text");
    expect(caption).toContain("Monthly hires: 5");
    expect(caption).toContain("Milestone month: November 2026");
    expect(caption).not.toContain("$");
    expect(new URL(String(open.mock.calls[0][0])).searchParams.get("url")).toBe(`https://galaxyfinancial.org${sharePath}`);
    fireEvent.click(screen.getByRole("button", { name: "Facebook" }));
    expect(new URL(String(open.mock.calls[1][0])).searchParams.get("u")).toBe(`https://galaxyfinancial.org${sharePath}`);
    fireEvent.click(screen.getByRole("button", { name: "Copy Link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`https://galaxyfinancial.org${sharePath}`));
    expect(db.requests.some(r => r.table === "plaque_awards" && r.filters.some(([key, value]) => key === "share_slug" && value === "public-Monthly builder"))).toBe(true);
  });

  it.each([
    ["hot_streak", 7, "Streak days: 7"],
    ["comeback_champion", 900, "Recorded premium increase: $900"],
    ["monthly_20k", 24750.5, "Recorded ALP: $24,750.50"],
    ["10K CLUB", 10000, "Recorded value · unit unavailable: 10,000"],
    ["first_deal_ever", null, "Recorded ALP: Premium not on file"],
  ] as const)("keeps %s units in manual share copy", (milestone_type, amount, expected) => {
    const caption = buildPlaqueShareCaption({ agent_name: "Synthetic Alpha", badge_label: null, milestone_type, milestone_date: "2026-11-24", amount });
    expect(caption).toContain(expected);
    expect(caption).toContain("Milestone date: Nov 24, 2026");
    expect(caption).not.toContain("$0");
    expect(caption).not.toContain("just earned");
  });
});

describe("My Plaques personal scope and unavailable states", () => {
  it("preserves the recorded reward period and deal description in the merged view and copied stats", async () => {
    db.rows = [];
    db.rewards = [{ id: "weekly-leader", agent_id: "agent-a", title: "Weekly production leader", rank: 1,
      period: "weekly", period_key: "2026-11-16", description: "5 deals in the recorded award week", alp: 12500,
      awarded_at: "2026-11-24T18:00:00Z" }];
    mount(<MyPlaques />);
    expect(await screen.findByText("Award period: Weekly · 2026-11-16")).toBeInTheDocument();
    expect(screen.getByText(/^Awarded:/)).toBeInTheDocument();
    expect(screen.getByText("5 deals in the recorded award week")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy stats" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("Award period: Weekly · 2026-11-16");
    expect(copied).toContain("5 deals in the recorded award week");
    expect(copied).toContain("$12,500.00 ALP");
    expect(copied).toContain("Rank: #1");
    expect(copied).toContain("Awarded:");
  });

  it("opens old rewards links on production awards and preserves the other query and anchor on filter changes", async () => {
    db.rewards = [{ id: "reward-one", agent_id: "agent-a", title: "Production leader", description: null,
      alp: 12500, rank: 1, awarded_at: "2026-11-24T18:00:00Z" }];
    function LocationProbe() { const at = useLocation(); return <output data-testid="award-location">{at.pathname}{at.search}{at.hash}</output>; }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/dashboard/my-plaques?source=reward&month=2026-11#history"]}><MyPlaques /><LocationProbe /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText("Production leader")).toBeInTheDocument();
    expect(screen.queryByAltText("Monthly builder")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Production awards" })).toHaveAttribute("aria-pressed", "true");
    const count = db.requests.length;
    fireEvent.click(screen.getByRole("button", { name: "Milestone plaques" }));
    expect(await screen.findByAltText("Monthly builder")).toBeInTheDocument();
    expect(screen.queryByText("Production leader")).not.toBeInTheDocument();
    expect(screen.getByTestId("award-location")).toHaveTextContent("/dashboard/my-plaques?source=plaque&month=2026-11#history");
    expect(db.requests).toHaveLength(count);
    expect(screen.getByRole("link", { name: "Win wall" })).toHaveAttribute("href", "/dashboard/awards");
  });

  it("keeps recorded zero reward premium distinct from missing premium", async () => {
    db.rows = [];
    db.rewards = [
      { id: "zero", agent_id: "agent-a", title: "Recorded zero", description: null, alp: 0, rank: 1, awarded_at: "2026-11-24T18:00:00Z" },
      { id: "missing", agent_id: "agent-a", title: "No premium", description: null, alp: null, rank: 2, awarded_at: "2026-11-24T18:00:00Z" },
    ];
    mount(<MyPlaques />);
    expect(await screen.findByText("$0.00 ALP")).toBeInTheDocument();
    expect(screen.getByText("Recorded premium unavailable")).toBeInTheDocument();
    expect(screen.getByText("2 awards in this view.")).toBeInTheDocument();
  });

  it("bounds both feeds and labels truncated plaque history instead of claiming all-time coverage", async () => {
    db.rows = Array.from({ length: 101 }, (_, i) => award(`History ${i}`, "single_day", i));
    mount(<MyPlaques />);
    expect(await screen.findByText(/Showing the latest 100 milestone plaques/)).toBeInTheDocument();
    expect(screen.getAllByText("Original artwork")).toHaveLength(100);
    expect(screen.queryByAltText("History 100")).not.toBeInTheDocument();
    expect(db.requests.find(request => request.table === "agentlink_rewards")?.limit).toBe(501);
    expect(db.requests.find(request => request.table === "plaque_awards")?.limit).toBe(101);
  });

  it("does not request any award feed when Mine cannot resolve the current agent", async () => {
    auth.isAdmin = false; db.missingIdentity = true;
    mount(<MyPlaques />);
    await screen.findByText("Your agent profile could not be verified.");
    expect(db.requests.some(r => r.table === "plaque_awards" || r.table === "agentlink_rewards")).toBe(false);
    expect(screen.queryByText("No award records were returned for this view.")).not.toBeInTheDocument();
  });

  it.each(["plaque_awards", "agentlink_rewards"])("shows a failed %s feed as unavailable, with a working retry", async table => {
    db.failTable = table;
    mount(<MyPlaques />);
    await screen.findByText("Plaques could not be loaded.");
    expect(screen.queryByText("No award records were returned for this view.")).not.toBeInTheDocument();
    db.failTable = null;
    fireEvent.click(screen.getByRole("button", { name: "Retry awards" }));
    expect(await screen.findByText("Monthly hires: 5")).toBeInTheDocument();
  });

  it.each(["plaque_awards", "agentlink_rewards"])("rejects an unverified null %s response rather than displaying empty success", async table => {
    db.nullTable = table;
    mount(<MyPlaques />);
    await screen.findByText("Plaques could not be loaded.");
    expect(screen.queryByText("No award records were returned for this view.")).not.toBeInTheDocument();
  });

  it.each(["plaque_awards", "agentlink_rewards"])("rejects malformed nonempty %s rows instead of claiming an empty history", async table => {
    db.rows = table === "plaque_awards" ? [{}] : [];
    db.rewards = table === "agentlink_rewards" ? [{}] : [];
    mount(<MyPlaques />);
    await screen.findByText("Plaques could not be loaded.");
    expect(screen.queryByText("No award records were returned for this view.")).not.toBeInTheDocument();
  });

  it("rejects a plaque without a mapped milestone type even when its identity is present", async () => {
    db.rows = [award("Malformed milestone", "month_builder", 5, { milestone_type: null })];
    mount(<MyPlaques />);
    await screen.findByText("Plaques could not be loaded.");
    expect(screen.queryByText("No award records were returned for this view.")).not.toBeInTheDocument();
  });

  it("shows an empty view only after both award feeds return verified empty arrays", async () => {
    db.rows = []; db.rewards = [];
    mount(<MyPlaques />);
    expect(await screen.findByText("No award records were returned for this view.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the previous account's cards immediately while the next account is loading", async () => {
    auth.isAdmin = false;
    const { rerender, client } = mount(<MyPlaques />);
    await screen.findByText("Monthly hires: 5");
    expect(db.requests.filter(r => r.table === "plaque_awards" || r.table === "agentlink_rewards").every(r => r.filters.some(([key, value]) => key === "agent_id" && value === "agent-a"))).toBe(true);
    db.pending = true;
    auth.user = { id: "viewer-b" };
    rerender(page(<MyPlaques />, client));
    expect(screen.queryByText("Monthly hires: 5")).not.toBeInTheDocument();
    expect(screen.getByText("Loading plaques…")).toBeInTheDocument();
    expect(client.getQueryCache().find({ queryKey: ["my-plaques", "viewer-b", "mine"] })).toBeDefined();
  });

  it("forces Mine when all-agent permission is removed", async () => {
    db.rows.push(award("Other account award", "streak_20", 20, { agent_id: "agent-b" }));
    const { rerender, client } = mount(<MyPlaques />);
    await screen.findByAltText("Other account award");
    auth.isAdmin = false;
    rerender(page(<MyPlaques />, client));
    await screen.findByText("Monthly hires: 5");
    expect(screen.queryByAltText("Other account award")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All agents" })).not.toBeInTheDocument();
    const lastPlaques = db.requests.filter(r => r.table === "plaque_awards").at(-1);
    expect(lastPlaques?.filters).toContainEqual(["agent_id", "agent-a"]);
  });
});
