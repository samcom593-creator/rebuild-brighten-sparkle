import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, refetch, invalidateQueries } = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn(), invalidateQueries: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: query, useQueryClient: () => ({ invalidateQueries }) }));
vi.mock("@/components/contentwheel/CwBridgeStripForSmb", () => ({ CwBridgeStripForSmb: () => null }));
vi.mock("@/hooks/useConfirm", () => ({ useConfirm: () => vi.fn() }));
import SocialMediaBot from "@/pages/admin/SocialMediaBot";
import TelegramBot from "@/pages/admin/TelegramBot";

const dashboard = {
  drafts_today: 2, drafts_approved_today: 0, drafts_shipped_today: 0, drafts_pending_today: 1,
  inbound_7d_count: 0, inbound_7d_paid: 0, inbound_7d_revenue_usd: 0, open_blockers: 0,
  critical_blockers: 0, total_followers: 0, analytics: [], blockers: [], inbound: [], goals: [],
  scoreboard: null, recent_runs: [], top_hooks: [], generated_at: "2026-11-24T00:00:00Z", as_of: "2026-11-24T00:00:00Z",
  today_pack: [
    { id: 1, draft_date: "2026-11-24", title: "Archived draft", platform: "instagram", status: "archived" },
    { id: 2, draft_date: "2026-11-24", title: "Draft awaiting review", platform: "instagram", status: "awaiting_approval" },
  ],
};

beforeEach(() => {
  query.mockReset(); refetch.mockReset(); invalidateQueries.mockReset();
  query.mockReturnValue({ data: [], isLoading: false, isError: false, isRefetching: false, refetch });
});

describe("automation dashboard recovery and empty states", () => {
  it("renders a working retry action when the social dashboard cannot load", () => {
    query.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => queryKey[0] === "social-bot-dashboard"
      ? { data: undefined, isLoading: false, isError: true, isRefetching: false, refetch }
      : { data: [], isLoading: false });
    render(<MemoryRouter><SocialMediaBot /></MemoryRouter>);
    expect(screen.getByText("Social Media Bot data unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("labels archived drafts accurately and supports the current awaiting-approval state in the detail dialog", async () => {
    query.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => ({
      data: queryKey[0] === "social-bot-dashboard" ? dashboard : [], isLoading: false, isError: false, isRefetching: false, refetch,
    }));
    render(<MemoryRouter><SocialMediaBot /></MemoryRouter>);
    expect(screen.getByText("archived")).toBeInTheDocument();
    expect(screen.getByText("awaiting approval")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    fireEvent.click(screen.getByText("Archived draft"));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    await userEvent.setup().keyboard("{Escape}");
    fireEvent.click(screen.getByText("Draft awaiting review"));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it.each([
    ["Funnel", "No users yet"],
    ["Escalations", "No open escalations"],
    ["Stuck users", "Nothing stuck"],
    ["Groups", "No groups registered"],
    ["Pre-Agent HQ", "No HQ channels seeded"],
  ])("renders the empty %s view without passing an icon component as a child", async (tab, title) => {
    render(<MemoryRouter><TelegramBot /></MemoryRouter>);
    await userEvent.setup().click(screen.getByRole("tab", { name: tab }));
    const heading = await screen.findByRole("heading", { name: title });
    expect(heading.parentElement?.querySelector("svg")).toBeInTheDocument();
  });
});
