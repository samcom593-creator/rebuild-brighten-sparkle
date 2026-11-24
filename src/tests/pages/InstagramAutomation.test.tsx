import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, readSubscriptions } = vi.hoisted(() => ({ from: vi.fn(), readSubscriptions: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
import InstagramAutomation from "@/pages/InstagramAutomation";

const rows = [
  { id: "subscription-1", agent_id: "agent-1", status: "active", instagram_handle: "fixture_one", created_at: "2026-11-01T00:00:00Z" },
  { id: "subscription-2", agent_id: "agent-2", status: "active", instagram_handle: "fixture_two", created_at: "2026-11-02T00:00:00Z" },
];

beforeEach(() => {
  from.mockReset(); readSubscriptions.mockReset();
  readSubscriptions.mockResolvedValue({ data: rows, error: null });
  from.mockImplementation((relation: string) => relation === "instagram_subscriptions"
    ? { select: vi.fn().mockReturnThis(), order: readSubscriptions }
    : { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [{ id: "agent-1", display_name: "First Producer" }, { id: "agent-2", display_name: "Second Producer" }], error: null }) });
});

describe("Instagram subscription metric truth", () => {
  it("keeps billing amounts and revenue unknown when enrollment records contain no billing evidence", async () => {
    const { container } = render(<InstagramAutomation />);
    await screen.findByText("First Producer");
    expect(screen.getAllByText("Billing amount unavailable")).toHaveLength(2);
    const revenue = within(screen.getByText("Monthly recurring revenue").parentElement!);
    expect(revenue.getByText("Not available")).toBeInTheDocument();
    expect(revenue.getByText("Verified billing amounts are needed to calculate revenue.")).toBeInTheDocument();
    expect(within(screen.getByText("Active Subscribers").parentElement!).getByText("2")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$\s*(97|194)/);
    expect(screen.queryByText(/Last paid:/)).not.toBeInTheDocument();
  });

  it("does not invent a service price or zero revenue for an empty enrollment list", async () => {
    readSubscriptions.mockResolvedValue({ data: [], error: null });
    const { container } = render(<InstagramAutomation />);
    await screen.findByText("No Instagram automation subscriptions yet");
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$\s*\d/);
  });

  it("reports a failed read as unavailable rather than zero subscribers and supports retry", async () => {
    readSubscriptions.mockResolvedValueOnce({ data: null, error: new Error("Subscription feed unavailable") })
      .mockResolvedValueOnce({ data: rows, error: null });
    render(<InstagramAutomation />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Subscription feed unavailable");
    expect(within(screen.getByText("Active Subscribers").parentElement!).getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No Instagram automation subscriptions yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry subscriptions" }));
    await screen.findByText("First Producer");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(readSubscriptions).toHaveBeenCalledTimes(2);
  });

  it("does not count a missing subscription status as active", async () => {
    readSubscriptions.mockResolvedValue({ data: [{ ...rows[0], status: null }], error: null });
    render(<InstagramAutomation />);
    await screen.findByText("First Producer");
    expect(screen.getByText("unknown")).toBeInTheDocument();
    expect(within(screen.getByText("Active Subscribers").parentElement!).getByText("0")).toBeInTheDocument();
  });
});
