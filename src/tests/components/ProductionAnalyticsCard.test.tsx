import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { ProductionAnalyticsCard } from "@/components/dashboard/ProductionAnalyticsCard";

const row = { week_alp: 1000, month_alp: 2000, year_alp: 3000, week_deals: 1, month_deals: 2, year_deals: 3 };
beforeEach(() => { vi.mocked(supabase.rpc).mockReset(); });
afterEach(() => vi.useRealTimers());
describe("production analytics verified reads", () => {
  it("supports the database client’s PromiseLike result without requiring catch on it", async () => {
    vi.mocked(supabase.rpc).mockReturnValue({ then: (resolve: (value: unknown) => unknown) => resolve({ data: [row], error: null }) } as never);
    render(<ProductionAnalyticsCard />);
    expect(await screen.findByText("$3.0K")).toBeInTheDocument();
  });
  it("shows a retry action instead of false zeros for a malformed result", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: [{}], error: null } as never);
    render(<ProductionAnalyticsCard />);
    expect(await screen.findByText("Production figures could not be verified.")).toBeInTheDocument();
    expect(screen.queryByText("$0")).toBeNull();
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [row], error: null } as never);
    fireEvent.click(screen.getByRole("button", { name: "Retry production figures" }));
    expect(await screen.findByText("$3.0K")).toBeInTheDocument();
  });
  it("does not shift the Phoenix month twice around midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-01T07:30:00Z"));
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [row], error: null } as never);
    render(<ProductionAnalyticsCard />);
    expect(screen.getByText("MTD (Nov)")).toBeInTheDocument();
    expect(await screen.findByText("$3.0K")).toBeInTheDocument();
  });
});
