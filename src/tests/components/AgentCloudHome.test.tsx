/**
 * AgentCloudHome (F22 / F23 / F24 in the 2026-10-14 Galaxy OS map, and the map's
 * Home gate: "one scope/date bar governs related production widgets").
 *
 * The scoreboard renders Home's only date bar and Home owns its state, so the
 * dashboard RPC and Total IMO by agency read the window the scoreboard shows.
 * Before 2026-10-15 Home had a second "This month" picker that ran to Nov 1 and
 * counted policies dated later in October, so the IMO block read $86,844 beside a
 * month-to-date scoreboard reading $83,092 for the same book.
 *
 * F23: the date bar and sibling panels stay on screen while the RPC loads and
 * after it fails. F22: windows are built from the Phoenix business-day key.
 * F24: the analytics panel module is not imported and the panel is not
 * rendered until the disclosure opens, and it stays mounted afterwards.
 *
 * Every sibling panel is stubbed: this file grades the Home frame, not the
 * children, and the real ones each open their own queries.
 */
import fs from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import type { HomeData } from "@/lib/homeDashboard";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "samuel" }, isAdmin: true, isManager: false }) }));
const businessDay = vi.hoisted(() => ({ key: "2026-10-14" }));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => businessDay.key }));
vi.mock("@/hooks/useProductionRealtime", () => ({ useProductionRealtime: () => undefined }));
vi.mock("@/lib/invalidateOperationalTruth", () => ({ invalidateOperationalTruth: vi.fn() }));
vi.mock("@/components/dashboard/JoinYourTeam", () => ({ JoinYourTeam: () => <div data-testid="join-your-team" /> }));
vi.mock("@/components/dashboard/TrainingNextStep", () => ({ TrainingNextStep: () => <div data-testid="training" /> }));
type Control = { period: string; throughDate: string; onPeriodChange: (p: string) => void; onThroughDateChange: (d: string) => void };
vi.mock("@/components/dashboard/ScopedProductionScoreboard", () => ({
  ScopedProductionScoreboard: ({ control }: { control?: Control }) => (
    <div data-testid="scoreboard" data-period={control?.period} data-through={control?.throughDate}>
      <button type="button" onClick={() => control?.onPeriodChange("year")}>Year to date</button>
      <button type="button" onClick={() => control?.onThroughDateChange("2026-10-10")}>Through Oct 10</button>
    </div>
  ),
}));
vi.mock("@/components/dashboard/AyroProductionPanel", () => ({ AyroProductionPanel: () => <div data-testid="ayro" /> }));
vi.mock("@/components/dashboard/OperationsCommandCenter", () => ({ OperationsCommandCenter: () => <div data-testid="ops" /> }));
vi.mock("@/components/dashboard/HomeOperationsSummary", () => ({ HomeOperationsSummary: () => <div data-testid="ops-summary" /> }));
vi.mock("@/components/dashboard/RecordsAndBounties", () => ({ RecordsAndBounties: () => <div data-testid="records" /> }));
vi.mock("@/components/dashboard/ImoByAgency", () => ({
  ImoByAgency: (props: { start?: string; end?: string; windowLabel?: string }) => (
    <div data-testid="imo" data-start={props.start} data-end={props.end}>{props.windowLabel}</div>
  ),
}));
// The factory runs when the module is first imported, so this flag records
// whether AgentCloudHome's lazy import() has executed yet.
const panel = vi.hoisted(() => ({ imported: false, renders: 0 }));
vi.mock("@/components/dashboard/HomeAnalyticsPanel", () => {
  panel.imported = true;
  return {
    HomeAnalyticsPanel: (props: { trend: Array<{ m: string }> }) => {
      panel.renders += 1;
      return <div data-testid="analytics-panel">{props.trend.length} trend months</div>;
    },
  };
});

import { AgentCloudHome } from "@/components/dashboard/AgentCloudHome";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../${file}`), "utf8");

const HOME: HomeData = {
  as_of: "2026-10-14T19:00:00Z",
  today: { personal_ap: 0, personal_policies: 0, team_ap: 0, team_policies: 0 },
  mtd: { personal_ap: 0, personal_policies: 0, team_ap: 0, team_policies: 0, goal: 0, pct_to_goal: 0, days_left: 17 },
  lifetime: { ap: 1234567, policies: 1759 },
  trend: [{ m: "2026-09", ap: 1000, policies: 3 }, { m: "2026-10", ap: 2000, policies: 5 }],
  leaderboard: [],
  policy_status: { active: 10, status_not_reported: 2 },
  roster: { total: 215, producing: 96, in_onboarding: 12 },
  needs_attention: { lapse_pending: 0, in_chargeback_window: 0, dormant_producers: 0 },
};

type RpcArgs = { p_start: string; p_end: string };
const rpc = vi.mocked(supabase.rpc);
const rpcCalls = (): RpcArgs[] => rpc.mock.calls.map((call) => call[1] as unknown as RpcArgs);

function renderHome() {
  const client = new QueryClient();
  const utils = render(
    <QueryClientProvider client={client}>
      <AgentCloudHome />
    </QueryClientProvider>,
  );
  return { client, ...utils };
}

beforeEach(() => {
  businessDay.key = "2026-10-14";
  rpc.mockReset();
  panel.imported = false;
  panel.renders = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentCloudHome", () => {
  it("F23: keeps the date bar and every sibling on screen while the dashboard RPC is still loading", () => {
    rpc.mockReturnValue(new Promise(() => undefined) as never);
    renderHome();
    expect(screen.getByRole("button", { name: "Year to date" })).toBeInTheDocument();
    expect(screen.getByText("Total IMO by agency")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    for (const id of ["join-your-team", "scoreboard", "ayro", "ops", "ops-summary", "records"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("one date bar: the RPC and Total IMO by agency read the scoreboard's month-to-date window", async () => {
    rpc.mockResolvedValue({ data: HOME, error: null } as never);
    renderHome();
    expect(await screen.findByText("215")).toBeInTheDocument();
    const board = screen.getByTestId("scoreboard");
    expect(board).toHaveAttribute("data-period", "month");
    expect(board).toHaveAttribute("data-through", "2026-10-14");
    // F22: the Phoenix business day 2026-10-14 gives Oct 1 through Oct 14, end-exclusive.
    expect(rpcCalls()).toEqual([{ p_start: "2026-10-01", p_end: "2026-10-15" }]);
    const imo = screen.getByTestId("imo");
    expect(imo).toHaveAttribute("data-start", "2026-10-01");
    expect(imo).toHaveAttribute("data-end", "2026-10-15");
    expect(imo).toHaveTextContent("Oct 1, 2026 – Oct 14, 2026");
    expect(screen.getByText(/same dates as the scoreboard/)).toBeInTheDocument();
    // The old second picker is gone.
    expect(screen.queryByRole("button", { name: "This month" })).not.toBeInTheDocument();
  });

  it("rolls to the new business day at Phoenix midnight, but keeps a date someone picked", async () => {
    rpc.mockResolvedValue({ data: HOME, error: null } as never);
    const { client, rerender } = renderHome();
    expect(await screen.findByText("215")).toBeInTheDocument();
    expect(screen.getByTestId("scoreboard")).toHaveAttribute("data-through", "2026-10-14");
    const tree = () => (
      <QueryClientProvider client={client}>
        <AgentCloudHome />
      </QueryClientProvider>
    );
    // Midnight passes (useBusinessToday re-renders with the new key): Home follows it.
    businessDay.key = "2026-10-15";
    rerender(tree());
    expect(screen.getByTestId("scoreboard")).toHaveAttribute("data-through", "2026-10-15");
    expect(rpcCalls().at(-1)).toEqual({ p_start: "2026-10-01", p_end: "2026-10-16" });
    // A picked date is a choice, not "today": it stays through the next rollover.
    fireEvent.click(screen.getByRole("button", { name: "Through Oct 10" }));
    businessDay.key = "2026-10-16";
    rerender(tree());
    expect(screen.getByTestId("scoreboard")).toHaveAttribute("data-through", "2026-10-10");
  });

  it("changing the scoreboard's period or date moves every production block on Home", async () => {
    rpc.mockResolvedValue({ data: HOME, error: null } as never);
    renderHome();
    expect(await screen.findByText("215")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Year to date" }));
    expect(rpcCalls().at(-1)).toEqual({ p_start: "2026-01-01", p_end: "2026-10-15" });
    expect(screen.getByTestId("imo")).toHaveAttribute("data-start", "2026-01-01");

    fireEvent.click(screen.getByRole("button", { name: "Through Oct 10" }));
    expect(rpcCalls().at(-1)).toEqual({ p_start: "2026-01-01", p_end: "2026-10-11" });
    expect(screen.getByTestId("imo")).toHaveAttribute("data-end", "2026-10-11");
    expect(screen.getByTestId("scoreboard")).toHaveAttribute("data-through", "2026-10-10");
  });

  it("F23: a failed load shows the error with Retry and leaves the date bar in place", async () => {
    vi.useFakeTimers();
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied", code: "42501" } } as never);
    renderHome();
    // retry: 1 with retryDelay 4s is part of the component's contract (MP-431).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("could not load.");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Year to date" })).toBeInTheDocument();
    expect(screen.queryByText("215")).not.toBeInTheDocument();
  });

  it("F24: does not import or render the analytics panel until the disclosure opens, then keeps it mounted", async () => {
    rpc.mockResolvedValue({ data: HOME, error: null } as never);
    const { container } = renderHome();
    expect(await screen.findByText("215")).toBeInTheDocument();
    expect(panel.imported).toBe(false);
    expect(panel.renders).toBe(0);
    expect(screen.queryByTestId("analytics-panel")).not.toBeInTheDocument();

    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByTestId("analytics-panel")).toHaveTextContent("2 trend months");
    expect(panel.imported).toBe(true);
    const rendersAfterOpen = panel.renders;

    details.open = false;
    fireEvent(details, new Event("toggle"));
    expect(screen.getByTestId("analytics-panel")).toBeInTheDocument();
    expect(panel.renders).toBe(rendersAfterOpen);
  });

  it("F24 / F22: the Home module carries no Recharts import and no browser-local date construction", () => {
    const home = source("components/dashboard/AgentCloudHome.tsx");
    expect(home).not.toContain('from "recharts"');
    expect(home).toContain('import("@/components/dashboard/HomeAnalyticsPanel")');
    expect(home).toContain("lazy(() =>");
    expect(home).not.toContain("new Date(");
    expect(home).not.toContain("phxToday");
    expect(home).not.toContain("toLocaleDateString");
    expect(home).toContain("useBusinessToday()");
    expect(source("components/dashboard/HomeAnalyticsPanel.tsx")).toContain('from "recharts"');
  });
});
