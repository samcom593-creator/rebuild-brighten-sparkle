import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  error: null as null | { message: string },
  pending: false,
  invoke: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: { id: "synthetic-viewer" }, isAdmin: false }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "order", "limit", "abortSignal", "in"]) query[method] = () => query;
      query.then = (resolve: (value: unknown) => unknown) => {
        if (db.pending) return new Promise(() => {});
        const result = table === "plaque_awards"
          ? { data: db.error ? null : db.rows, error: db.error }
          : { data: [
            { id: "synthetic-a", user_id: null, display_name: "Synthetic Alpha" },
            { id: "synthetic-b", user_id: null, display_name: "Synthetic Beta" },
          ], error: null };
        return Promise.resolve(result).then(resolve);
      };
      return query;
    },
    functions: { invoke: db.invoke },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AwardsGallery from "@/pages/AwardsGallery";

const clients: QueryClient[] = [];
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const writeText = vi.fn();
function page(client: QueryClient) {
  return <QueryClientProvider client={client}><MemoryRouter><AwardsGallery /></MemoryRouter></QueryClientProvider>;
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return { ...render(page(client)), client };
}
function award(id: string, agent: string, tier: string, date: string, amount: number | null) {
  return {
    id, agent_id: agent, milestone_type: tier, milestone_date: date, amount,
    badge_label: null, color_hex: null, image_svg_url: null, image_png_url: null,
    email_sent_at: null, email_delivery_status: null, awarded_at: `${date}T18:00:00Z`, custom_photo_url: null,
  };
}
function summaryTile(label: string) {
  return within(screen.getByRole("group", { name: "Award summary" })).getByText(label).parentElement!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T18:00:00Z"));
  auth.user = { id: "synthetic-viewer" };
  auth.isAdmin = false;
  db.error = null;
  db.pending = false;
  db.invoke.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  db.rows = [
    award("synthetic-1", "synthetic-a", "single_day", "2026-11-24", 5000),
    award("synthetic-2", "synthetic-b", "single_day_bronze", "2026-11-23", null),
    award("synthetic-3", "synthetic-a", "single_day_platinum", "2026-11-22", 5000),
    award("synthetic-4", "synthetic-b", "diamond_week", "2026-09-30", 9000),
  ];
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("Wins & Awards", () => {
  it("shows a loading state without unverified zero counts", () => {
    db.pending = true;
    renderPage();
    expect(screen.getByRole("status", { name: "Loading awards" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Award summary" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No recorded awards/)).not.toBeInTheDocument();
  });

  it("distinguishes an unreadable feed from an empty wall and recovers on retry", async () => {
    db.error = { message: "synthetic unavailable" };
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Awards could not be loaded");
    expect(screen.queryByRole("group", { name: "Award summary" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No recorded awards/)).not.toBeInTheDocument();
    db.error = null;
    fireEvent.click(screen.getByRole("button", { name: "Retry awards" }));
    expect(await screen.findByRole("group", { name: "Award summary" })).toBeInTheDocument();
    expect(summaryTile("Awards in view")).toHaveTextContent("3");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("charts recorded counts for the selected window and preserves unknown premium", async () => {
    renderPage();
    await screen.findByRole("group", { name: "Award summary" });
    expect(summaryTile("Awards in view")).toHaveTextContent("3");
    expect(summaryTile("Agents recognized")).toHaveTextContent("2");
    expect(summaryTile("Premium not on file")).toHaveTextContent("1");
    const bars = within(screen.getByRole("list", { name: "Award counts by milestone" })).getAllByRole("listitem");
    expect(bars).toHaveLength(3);
    for (const bar of bars) expect(bar).toHaveTextContent("1 award");
    expect(screen.queryByText("Total Value")).not.toBeInTheDocument();
    expect(screen.queryByText("$10.0k")).not.toBeInTheDocument();
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
    expect(screen.getByText("no premium on file")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Last 90 days" }));
    expect(summaryTile("Awards in view")).toHaveTextContent("4");
    fireEvent.change(screen.getByRole("textbox", { name: "Search awards" }), { target: { value: "Synthetic Alpha" } });
    expect(summaryTile("Awards in view")).toHaveTextContent("2");
    expect(summaryTile("Agents recognized")).toHaveTextContent("1");
    expect(within(screen.getByRole("list", { name: "Award counts by milestone" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("keeps a verified snapshot visible with a stale warning when refresh fails", async () => {
    renderPage();
    await screen.findByRole("group", { name: "Award summary" });
    db.error = { message: "synthetic refresh failed" };
    fireEvent.click(screen.getByRole("button", { name: "Refresh awards" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Showing the last verified award records");
    expect(summaryTile("Awards in view")).toHaveTextContent("3");
    expect(screen.queryByText(/No recorded awards/)).not.toBeInTheDocument();
  });

  it("labels the bounded history rather than claiming a complete agency total", async () => {
    db.rows = Array.from({ length: 501 }, (_, index) => award(`synthetic-old-${index}`, "synthetic-a", "single_day", "2025-01-01", 3000));
    renderPage();
    expect(await screen.findByText(/Showing the newest 500 awards/)).toHaveTextContent("older awards are not included");
    expect(screen.getByText(/No recorded awards match this window/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Award counts by milestone" })).not.toBeInTheDocument();
  });

  it("keeps admin publishing controls restricted and never starts an external action on load", async () => {
    const view = renderPage();
    await screen.findByRole("group", { name: "Award summary" });
    expect(screen.getByRole("link", { name: "Leaderboard" })).toHaveAttribute("href", "/dashboard/leaderboard");
    expect(screen.getByRole("link", { name: "Hall of Fame" })).toHaveAttribute("href", "/dashboard/hall-of-fame");
    expect(screen.queryByRole("link", { name: "Win Post Studio" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Render All" })).not.toBeInTheDocument();
    auth.isAdmin = true;
    view.rerender(page(view.client));
    expect(screen.getByRole("link", { name: "Win Post Studio" })).toHaveAttribute("href", "/awards");
    expect(screen.getByRole("button", { name: "Render All" })).toBeInTheDocument();
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it("does not reuse the prior user's award snapshot after a user change", async () => {
    const view = renderPage();
    await screen.findByRole("group", { name: "Award summary" });
    auth.user = { id: "synthetic-other-viewer" };
    db.error = { message: "synthetic denied" };
    view.rerender(page(view.client));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Awards could not be loaded"));
    expect(screen.queryByRole("group", { name: "Award summary" })).not.toBeInTheDocument();
    expect(screen.queryByText("Synthetic Alpha")).not.toBeInTheDocument();
  });

  it("copies exact recorded facts and leaves unknown premium unavailable", async () => {
    db.rows[0].amount = 1031.76;
    renderPage();
    const recorded = await screen.findByRole("article", { name: "Synthetic Alpha Gold award" });
    expect(recorded).toHaveTextContent("$1,031.76");
    fireEvent.click(within(recorded).getByRole("button", { name: "Copy stats" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Recorded premium: $1,031.76")));
    expect(await within(recorded).findByText("Stats copied.")).toBeInTheDocument();

    writeText.mockRejectedValueOnce(new Error("denied"));
    const missing = screen.getByRole("article", { name: "Synthetic Beta Bronze award" });
    fireEvent.click(within(missing).getByRole("button", { name: "Copy stats" }));
    const field = await within(missing).findByRole("textbox", { name: /Award stats/ });
    expect(field).toHaveAttribute("readonly");
    expect((field as HTMLTextAreaElement).value).toContain("Recorded premium: Premium not on file");
    expect((field as HTMLTextAreaElement).value).not.toContain("$0");
    expect(within(missing).queryByText("Stats copied.")).not.toBeInTheDocument();
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it("labels saved artwork as the original design rather than the redesigned award face", async () => {
    db.rows[0].image_png_url = "https://example.test/original-award.png";
    renderPage();
    const card = await screen.findByRole("article", { name: "Synthetic Alpha Gold award" });
    expect(within(card).queryByRole("img", { name: /Original plaque/ })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Original art" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Stored artwork from the earlier design/)).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: "Original plaque artwork for Synthetic Alpha" })).toHaveAttribute("src", "https://example.test/original-award.png");
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it("clears selected award text immediately on an account switch", async () => {
    const view = renderPage();
    const card = await screen.findByRole("article", { name: "Synthetic Alpha Gold award" });
    fireEvent.click(within(card).getByRole("button", { name: "Open award for Synthetic Alpha" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("textbox", { name: /Caption text/ }), { target: { value: "Private award caption" } });
    auth.user = { id: "synthetic-other-viewer" };
    db.error = { message: "synthetic denied" };
    view.rerender(page(view.client));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Private award caption")).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Awards could not be loaded");
  });

  it("renders and copies hiring counts and monthly buckets without turning them into premium", async () => {
    db.rows = [
      award("daily-hires", "synthetic-a", "day_hiring_champion", "2026-11-24", 5),
      award("monthly-hires", "synthetic-b", "month_team_builder", "2026-11-01", 7),
      award("streak", "synthetic-a", "hot_streak", "2026-11-24", 5),
    ];
    renderPage();
    await screen.findByRole("group", { name: "Award summary" });
    expect(summaryTile("Premium not on file")).toHaveTextContent("0");
    const daily = screen.getByRole("article", { name: "Synthetic Alpha Hiring Champion award" });
    expect(daily).toHaveTextContent("Daily hires");
    expect(daily).not.toHaveTextContent("$5");
    const monthly = screen.getByRole("article", { name: "Synthetic Beta Team Builder award" });
    expect(monthly).toHaveTextContent("November 2026");
    fireEvent.click(within(monthly).getByRole("button", { name: "Copy stats" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Monthly hires: 7")));
    expect(writeText.mock.calls.at(-1)?.[0]).toContain("Milestone month: November 2026");
    expect(writeText.mock.calls.at(-1)?.[0]).not.toMatch(/\$|ALP|Earned:/);
    expect(screen.getByRole("article", { name: "Synthetic Alpha Hot Streak award" })).toHaveTextContent("Streak days");
  });
});
