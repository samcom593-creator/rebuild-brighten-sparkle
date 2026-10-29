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
 * OVERHAUL-home (2026-10-29): the conversion strip leads the owner's Home and
 * Selling agents replaces the "Roster 68 · No sale yet 59" tiles; the all-time
 * Ayro block is off Home (it stays on Book of Business). The trend and policy
 * status panel is now the only reader of apex_admin_home_dashboard on Home, so
 * the RPC waits until that panel is opened.
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
vi.mock("@/components/dashboard/HomeConversions", () => ({
  HomeConversions: () => <div data-testid="conversions" />,
  SellingAgentsTile: () => <div data-testid="selling-agents" />,
}));
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

/** Opens Reports and its "Trend and policy status" disclosure, the panel that reads the RPC. */
function showOverview() {
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Overview" }), { button: 0, ctrlKey: false });
}

function openAnalytics(container: HTMLElement) {
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Reports" }), { button: 0, ctrlKey: false });
  const details = container.querySelector("details") as HTMLDetailsElement;
  expect(details).not.toBeNull();
  details.open = true;
  fireEvent(details, new Event("toggle"));
  return details;
}

describe("AgentCloudHome", () => {
  it("F24: does not import or render the analytics panel until the disclosure opens, then keeps it mounted", async () => {
    rpc.mockResolvedValue({ data: HOME, error: null } as never);
    const { container } = renderHome();
    expect(screen.getByTestId("conversions")).toBeInTheDocument();
    expect(panel.imported).toBe(false);
    expect(panel.renders).toBe(0);
    expect(screen.queryByTestId("analytics-panel")).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Reports" }), { button: 0, ctrlKey: false });
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

  it("F23 / OVERHAUL-home: conversions lead, the date bar and every daily block are on screen; no all-time Ayro block and no roster tiles", () => {
    rpc.mockReturnValue(new Promise(() => undefined) as never);
    renderHome();
    expect(screen.getByRole("button", { name: "Year to date" })).toBeInTheDocument();
    expect(screen.getByText("Total IMO by agency")).toBeInTheDocument();
    for (const id of ["join-your-team", "conversions", "scoreboard", "selling-agents", "ops"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // The strip comes before production, so the funnel is the first thing Sam reads.
    const order = ["conversions", "scoreboard", "selling-agents"].map((id) => screen.getByTestId(id));
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Removed from Home: the all-time Ayro block and the vanity roster counts.
    expect(screen.queryByTestId("ayro")).not.toBeInTheDocument();
    for (const gone of ["Roster", "No sale yet", "agents on the team", "active, no production yet"]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
    for (const id of ["ops-summary", "records"]) expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Operations" }), { button: 0, ctrlKey: false });
    expect(screen.getByTestId("ops-summary")).toBeInTheDocument();
    expect(screen.getByTestId("scoreboard")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Reports" }), { button: 0, ctrlKey: false });
    expect(screen.getByTestId("records")).toBeInTheDocument();
    expect(screen.getByTestId("scoreboard")).toBeInTheDocument();
    expect(screen.getByTestId("conversions")).toBeInTheDocument();
  });

  it("OVERHAUL-home: apex_admin_home_dashboard (~2.2s) is not called until its panel is opened", async () => {
    rpc.mockResolvedValue({ data: HOME, error: null } as never);
    const { container } = renderHome();
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc).not.toHaveBeenCalled();
    openAnalytics(container);
    expect(await screen.findByTestId("analytics-panel")).toBeInTheDocument();
    expect(rpcCalls()).toEqual([{ p_start: "2026-10-01", p_end: "2026-10-15" }]);
  });

  it("one date bar: the RPC and Total IMO by agency read the scoreboard's month-to-date window", async () => {
    rpc.mockResolvedValue({ data: HOME, error: null } as never);
    const { container } = renderHome();
    const board = screen.getByTestId("scoreboard");
    expect(board).toHaveAttribute("data-period", "month");
    expect(board).toHaveAttribute("data-through", "2026-10-14");
    const imo = screen.getByTestId("imo");
    // F22: the Phoenix business day 2026-10-14 gives Oct 1 through Oct 14, end-exclusive.
    expect(imo).toHaveAttribute("data-start", "2026-10-01");
    expect(imo).toHaveAttribute("data-end", "2026-10-15");
    expect(imo).toHaveTextContent("Oct 1, 2026 – Oct 14, 2026");
    expect(screen.getByText(/same dates as the scoreboard/)).toBeInTheDocument();
    openAnalytics(container);
    expect(await screen.findByTestId("analytics-panel")).toBeInTheDocument();
    expect(rpcCalls()).toEqual([{ p_start: "2026-10-01", p_end: "2026-10-15" }]);
    // The old second picker is gone.
    expect(screen.queryByRole("button", { name: "This month" })).not.toBeInTheDocument();
  });

  it("rolls to the new business day at Phoenix midnight, but keeps a date someone picked", async () => {
    rpc.mockResolvedValue({ data: HOME, error: null } as never);
    const { client, rerender, container } = renderHome();
    openAnalytics(container);
    expect(await screen.findByTestId("analytics-panel")).toBeInTheDocument();
    showOverview();
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
    expect(screen.getByTestId("imo")).toHaveAttribute("data-end", "2026-10-16");
    expect(rpcCalls().at(-1)).toEqual({ p_start: "2026-10-01", p_end: "2026-10-16" });
    // A picked date is a choice, not "today": it stays through the next rollover.
    fireEvent.click(screen.getByRole("button", { name: "Through Oct 10" }));
    businessDay.key = "2026-10-16";
    rerender(tree());
    expect(screen.getByTestId("scoreboard")).toHaveAttribute("data-through", "2026-10-10");
  });

  it("changing the scoreboard's period or date moves every production block on Home", async () => {
    rpc.mockResolvedValue({ data: HOME, error: null } as never);
    const { container } = renderHome();
    openAnalytics(container);
    expect(await screen.findByTestId("analytics-panel")).toBeInTheDocument();
    showOverview();

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
    const { container } = renderHome();
    openAnalytics(container);
    // retry: 1 with retryDelay 4s is part of the component's contract (MP-431).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Unavailable");
    expect(alert).toHaveTextContent("You do not have permission to view this.");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Year to date" })).toBeInTheDocument();
    expect(screen.queryByTestId("analytics-panel")).not.toBeInTheDocument();
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
    // OVERHAUL-home: the all-time Ayro block and the roster tiles are not rendered on Home.
    expect(home).not.toContain("<AyroProductionPanel");
    expect(home).not.toContain("RosterTiles");
    expect(home).toContain("<HomeConversions />");
  });
});
