/**
 * AgentCloudHome (F22 / F23 / F24 in the 2026-10-14 Galaxy OS map).
 *
 * F23: the period controls are in the tree while the RPC loads, after it
 * fails, and while a custom draft is invalid; an invalid draft shows a
 * message and never changes the window. F22: the window handed to the RPC
 * and to ImoByAgency is the key-space window for the Phoenix business day.
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
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { HomeData } from "@/lib/homeDashboard";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "samuel" }, isAdmin: true, isManager: false }) }));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-10-14" }));
vi.mock("@/hooks/useProductionRealtime", () => ({ useProductionRealtime: () => undefined }));
vi.mock("@/lib/invalidateOperationalTruth", () => ({ invalidateOperationalTruth: vi.fn() }));
vi.mock("@/components/dashboard/JoinYourTeam", () => ({ JoinYourTeam: () => <div data-testid="join-your-team" /> }));
vi.mock("@/components/dashboard/TrainingNextStep", () => ({ TrainingNextStep: () => <div data-testid="training" /> }));
vi.mock("@/components/dashboard/ScopedProductionScoreboard", () => ({ ScopedProductionScoreboard: () => <div data-testid="scoreboard" /> }));
vi.mock("@/components/dashboard/AyroProductionPanel", () => ({ AyroProductionPanel: () => <div data-testid="ayro" /> }));
vi.mock("@/components/dashboard/OperationsCommandCenter", () => ({ OperationsCommandCenter: () => <div data-testid="ops" /> }));
vi.mock("@/components/dashboard/HomeOperationsSummary", () => ({ HomeOperationsSummary: () => <div data-testid="ops-summary" /> }));
vi.mock("@/components/dashboard/RecordsAndBounties", () => ({ RecordsAndBounties: () => <div data-testid="records" /> }));
vi.mock("@/components/dashboard/ImoByAgency", () => ({
  ImoByAgency: (props: { start?: string; end?: string; windowLabel?: string }) => (
    <div data-testid="imo" data-start={props.start} data-end={props.end}>{props.windowLabel}</div>
  ),
}));
// Radix menus need pointer capture jsdom does not have; the picker's wiring
// (which item sets which period) is what matters here, so the menu is flat.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" role="menuitem" onClick={onSelect}>{children}</button>
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
  rpc.mockReset();
  panel.imported = false;
  panel.renders = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentCloudHome", () => {
  it("F23: keeps the period controls on screen while the dashboard RPC is still loading", () => {
    rpc.mockReturnValue(new Promise(() => undefined) as never);
    renderHome();
    expect(screen.getByRole("button", { name: "This month" })).toBeInTheDocument();
    expect(screen.getByText("Total IMO by agency")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    // The siblings that do not depend on this RPC render regardless of it.
    for (const id of ["join-your-team", "scoreboard", "ayro", "ops", "ops-summary", "records"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("F22: asks the RPC and ImoByAgency for the key-space window of the Phoenix business day", async () => {
    rpc.mockResolvedValue({ data: HOME, error: null } as never);
    renderHome();
    expect(await screen.findByText("215")).toBeInTheDocument();
    expect(rpcCalls()).toEqual([{ p_start: "2026-10-01", p_end: "2026-11-01" }]);
    const imo = screen.getByTestId("imo");
    expect(imo).toHaveAttribute("data-start", "2026-10-01");
    expect(imo).toHaveAttribute("data-end", "2026-11-01");
    expect(imo).toHaveTextContent("This month");
  });

  it("F23: an invalid custom draft shows a message, keeps both fields, and never changes the window", async () => {
    rpc.mockResolvedValue({ data: HOME, error: null } as never);
    renderHome();
    expect(await screen.findByText("215")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Custom range" }));
    const start = screen.getByLabelText("Start date") as HTMLInputElement;
    const end = screen.getByLabelText("End date") as HTMLInputElement;
    expect(start.value).toBe("2026-09-14");
    expect(end.value).toBe("2026-10-14");
    // Selecting the preset commits its default 30-day window (the day after today is the exclusive end).
    expect(rpcCalls().at(-1)).toEqual({ p_start: "2026-09-14", p_end: "2026-10-15" });
    // That window is a new query key, so its numbers load before the draft is touched.
    expect(await screen.findByText("215")).toBeInTheDocument();
    const callsBefore = rpc.mock.calls.length;

    fireEvent.change(start, { target: { value: "" } });
    expect(screen.getByText("Pick a start date.")).toBeInTheDocument();
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    expect(screen.getByLabelText("End date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Custom range" })).toBeInTheDocument();

    fireEvent.change(start, { target: { value: "2026-10-20" } });
    expect(screen.getByText("The start date must be on or before the end date.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

    // Neither invalid draft touched the query or the sibling window.
    expect(rpc.mock.calls.length).toBe(callsBefore);
    expect(screen.getByTestId("imo")).toHaveAttribute("data-start", "2026-09-14");
    expect(screen.getByText("215")).toBeInTheDocument();
  });

  it("F23 / F22: Apply commits a valid draft as an end-exclusive window", async () => {
    rpc.mockResolvedValue({ data: HOME, error: null } as never);
    renderHome();
    expect(await screen.findByText("215")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Custom range" }));

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-10-10" } });
    expect(screen.getByText("Showing 2026-09-14 - 2026-10-14. Apply to switch to 2026-10-01 - 2026-10-10.")).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);

    expect(rpcCalls().at(-1)).toEqual({ p_start: "2026-10-01", p_end: "2026-10-11" });
    const imo = screen.getByTestId("imo");
    expect(imo).toHaveAttribute("data-start", "2026-10-01");
    expect(imo).toHaveAttribute("data-end", "2026-10-11");
    expect(imo).toHaveTextContent("2026-10-01 - 2026-10-10");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("F23: a failed load shows the error with Retry and leaves the period controls in place", async () => {
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
    expect(screen.getByRole("button", { name: "This month" })).toBeInTheDocument();
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
