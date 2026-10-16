/**
 * DashboardToday (F17 / F18 / F19 / F20 / F21 in the 2026-10-14 Galaxy OS map).
 *
 * F18: each task renders once, the first ranked task carries the NOW mark.
 * F19: an injected read failure renders an alert that says the widget could
 * not load, with its own Retry, on every widget (the compact DONE row says
 * Unavailable), never $0, never "no blockers"; zero copy appears only after a
 * successful empty read, and one widget's Retry does not touch the others. A
 * posted deal with no premium is counted and named, never summed as $0.
 * F17: the login's identity comes from useAgentIdentity; error, ambiguous and
 * none are shown in the task sections while the other widgets still load.
 * F20 / F21: the ranked order follows the due-date queue and "today" is the
 * Phoenix business key, which is also the posted_date filter on the book.
 *
 * The global test setup mocks the Supabase client with a chain whose `then`
 * never settles, so this file overrides `from` with a per-table thenable.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import type { UseAgentIdentityResult } from "@/hooks/useAgentIdentity";
import type { AgentIdentityRow } from "@/lib/agentIdentity";

const identity = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/hooks/useAgentIdentity", () => ({ useAgentIdentity: () => identity.current }));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-10-14" }));
const auth = vi.hoisted(() => ({ current: { isAdmin: true, isVa: false, isVaManager: false } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));

import DashboardToday from "@/pages/DashboardToday";

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };
type Call = { table: string; method: string; args: unknown[] };

const results = new Map<string, Result>();
const calls: Call[] = [];
const ok = (rows: Row[]): Result => ({ data: rows, error: null });
const fail = (message: string): Result => ({ data: null, error: { message } });

function chainFor(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "is", "not", "in", "order", "limit", "update"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      return chain;
    };
  }
  chain.then = (onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) => {
    const result = results.get(table) ?? fail(`no stub for ${table}`);
    return Promise.resolve(result).then(onFulfilled, onRejected);
  };
  return chain;
}

const AGENT_ROW: AgentIdentityRow = {
  id: "agent-1",
  user_id: "user-1",
  agent_code: "AGT1",
  display_name: "Test Agent",
  status: "active",
  is_inactive: false,
  is_deactivated: false,
  created_at: "2026-01-01T00:00:00Z",
  canonical_agent_id: null,
};

function resolved(): UseAgentIdentityResult {
  return { identity: { status: "resolved", agentId: "agent-1", row: AGENT_ROW }, agentId: "agent-1", isLoading: false, isError: false, refetch: vi.fn(), userId: "user-1" };
}

function allEmpty() {
  for (const table of ["today_tasks", "v_upcoming_calls", "v_production_unified", "social_bot_drafts", "social_bot_blockers", "v_cfo_snapshot"]) {
    results.set(table, ok([]));
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardToday />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Wed 2026-10-14 12:00 in Phoenix. Only Date is mocked; timers stay real so findBy* can poll.
  vi.setSystemTime(new Date("2026-10-14T19:00:00Z"));
  results.clear();
  calls.length = 0;
  identity.current = resolved();
  auth.current = { isAdmin: true, isVa: false, isVaManager: false };
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainFor(table)) as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DashboardToday", () => {
  it("renders each task once, marks the first ranked task NOW, ranks the due-date queue, and buckets on the Phoenix day", async () => {
    allEmpty();
    results.set("today_tasks", ok([
      { id: "t-next-month", title: "Charlie", notes: null, due_at: "2026-11-03T19:00:00Z", completed_at: null, priority: "med", is_income_producing: false, created_at: "2026-06-17T00:00:00Z" },
      { id: "t-unscheduled", title: "Bravo", notes: null, due_at: null, completed_at: null, priority: "med", is_income_producing: false, created_at: "2026-10-10T00:00:00Z" },
      { id: "t-today", title: "Alpha", notes: null, due_at: "2026-10-14T23:30:00Z", completed_at: null, priority: "high", is_income_producing: true, created_at: "2026-10-14T18:00:00Z" },
      { id: "t-done", title: "Delta", notes: null, due_at: null, completed_at: "2026-10-15T06:59:00Z", priority: "med", is_income_producing: false, created_at: "2026-10-01T00:00:00Z" },
      { id: "t-done-yesterday", title: "Echo", notes: null, due_at: null, completed_at: "2026-10-14T06:00:00Z", priority: "med", is_income_producing: false, created_at: "2026-10-01T00:00:00Z" },
    ]));
    results.set("v_upcoming_calls", ok([
      { id: 2, prospect_name: "Tomorrow Person", summary: null, location: null, start_at: "2026-10-15T07:30:00Z", end_at: "2026-10-15T08:00:00Z", call_type: "interview", status: "scheduled", outcome: null },
      { id: 1, prospect_name: "Jordan Lee", summary: null, location: "https://zoom.us/j/1", start_at: "2026-10-15T06:30:00Z", end_at: "2026-10-15T07:00:00Z", call_type: "interview", status: "scheduled", outcome: null },
    ]));
    results.set("v_production_unified", ok([{ annual_premium: 1200 }, { annual_premium: "800" }]));
    results.set("social_bot_drafts", ok([
      { id: 1, title: "Pending piece", hook: null, platform: "instagram", status: "pending" },
      { id: 2, title: "Approved piece", hook: null, platform: "youtube", status: "approved" },
    ]));
    results.set("social_bot_blockers", ok([{ id: 1, title: "IG token expired", description: null, severity: "high", dollar_impact: 2500 }]));
    results.set("v_cfo_snapshot", ok([{ ghost_ap_at_risk: 15000, dup_charges_open: 2, ica_paid_stuck: null, as_of: "2026-10-14T19:00:00Z" }]));

    renderPage();

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    // F18: once each, in queue order: due today, then unscheduled, then next month (created earliest, ranked last).
    expect(screen.getAllByText(/^(Alpha|Bravo|Charlie)$/).map((el) => el.textContent)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(screen.getAllByText("Alpha")).toHaveLength(1);
    expect(screen.getByText("NOW").parentElement).toHaveTextContent("Alpha");
    expect(screen.getByText("3 open")).toBeInTheDocument();
    expect(screen.getByText(/Due today · 4:30 PM MST/)).toBeInTheDocument();
    // F21: the header names the business day from the key, not the browser clock.
    expect(screen.getByText(/Wed, Oct 14 · MST business day/)).toBeInTheDocument();
    // DONE: completed at 23:59 MST on the 14th counts; 23:00 MST on the 13th does not.
    expect(screen.getByText("Delta")).toBeInTheDocument();
    expect(screen.queryByText("Echo")).not.toBeInTheDocument();
    // NEXT MEETING: 23:30 MST tonight is today's call; 00:30 MST tomorrow is not.
    expect(await screen.findByText("Jordan Lee")).toBeInTheDocument();
    expect(screen.getByText("11:30 PM MST")).toBeInTheDocument();
    expect(screen.queryByText("Tomorrow Person")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join" })).toHaveAttribute("href", "https://zoom.us/j/1");
    // REVENUE from the unified production view (the leaderboard's source), on the Phoenix key, agency-wide for staff.
    expect(await screen.findByText("$2,000 ALP")).toBeInTheDocument();
    expect(screen.getByText("2 deals posted today")).toBeInTheDocument();
    expect(calls).toContainEqual({ table: "v_production_unified", method: "eq", args: ["posted_date", "2026-10-14"] });
    expect(calls).toContainEqual({ table: "v_production_unified", method: "neq", args: ["origin", "external_daily_gap"] });
    expect(calls).toContainEqual({ table: "v_production_unified", method: "not", args: ["agent_id", "is", null] });
    expect(calls).not.toContainEqual({ table: "v_production_unified", method: "eq", args: ["agent_id", "agent-1"] });
    expect(calls).toContainEqual({ table: "today_tasks", method: "eq", args: ["owner_agent_id", "agent-1"] });
    // CONTENT prefers the approved draft; BLOCKED and FINANCES show measured values.
    expect(await screen.findByText("Approved piece")).toBeInTheDocument();
    expect(await screen.findByText("IG token expired")).toBeInTheDocument();
    expect(screen.getByText("high · $2,500 impact")).toBeInTheDocument();
    expect(await screen.findByText("$15,000 at risk")).toBeInTheDocument();
    expect(screen.getByText("2 duplicate-charge flags · Unknown paid-and-stuck")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says each widget could not load, with its own Retry, when the reads fail, never a zero, and retries one widget alone", async () => {
    results.set("today_tasks", fail("tasks are down"));
    results.set("v_upcoming_calls", fail("calls are down"));
    results.set("v_production_unified", fail("book is down"));
    results.set("social_bot_drafts", fail("drafts are down"));
    results.set("social_bot_blockers", fail("blockers are down"));
    results.set("v_cfo_snapshot", fail("cfo is down"));

    renderPage();

    // Tasks are shown twice (PRIORITIES and DONE), so seven alerts for six failed reads.
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(7);
    for (const message of ["tasks are down", "calls are down", "book is down", "drafts are down", "blockers are down", "cfo is down"]) {
      expect(screen.getAllByText(message).length).toBeGreaterThanOrEqual(1);
    }
    expect(screen.getAllByRole("button", { name: /retry/i })).toHaveLength(7);
    // Six full-size widgets name what failed; the compact DONE row says Unavailable.
    for (const label of ["Your tasks", "Today's calls", "Today's production", "Ready content", "Open blockers", "The finance snapshot"]) {
      expect(screen.getByText(`${label} could not load.`)).toBeInTheDocument();
    }
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No open blockers/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No remaining meeting today/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No tasks yet|No open tasks|Nothing completed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/deals posted today/)).not.toBeInTheDocument();
    expect(screen.queryByText(/at risk/)).not.toBeInTheDocument();

    // One widget's Retry reloads only that widget.
    results.set("v_production_unified", ok([{ annual_premium: 2000 }]));
    const revenueAlert = screen.getByText("book is down").closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(revenueAlert).getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("$2,000 ALP")).toBeInTheDocument();
    expect(screen.getByText("1 deal posted today")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(6);
    expect(screen.getAllByText("drafts are down").length).toBeGreaterThanOrEqual(1);
  });

  it("counts a posted deal with no premium and names it instead of summing it as $0", async () => {
    allEmpty();
    results.set("v_production_unified", ok([{ annual_premium: 1200 }, { annual_premium: null }]));
    const first = renderPage();
    expect(await screen.findByText("$1,200 ALP")).toBeInTheDocument();
    expect(screen.getByText("2 deals posted today, 1 without a premium amount")).toBeInTheDocument();
    first.unmount();

    results.set("v_production_unified", ok([{ annual_premium: null }]));
    renderPage();
    expect(await screen.findByText("ALP unknown")).toBeInTheDocument();
    expect(screen.getByText("1 deal posted today, 1 without a premium amount")).toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });

  it("reserves the zero copy for a successful empty read", async () => {
    allEmpty();
    renderPage();

    expect(await screen.findByText("No tasks yet")).toBeInTheDocument();
    expect(screen.getByText("0 open")).toBeInTheDocument();
    expect(await screen.findByText("No remaining meeting today")).toBeInTheDocument();
    expect(await screen.findByText("$0 ALP")).toBeInTheDocument();
    expect(screen.getByText("0 deals posted today")).toBeInTheDocument();
    expect(await screen.findByText("No ready content")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Content Command/ })).toHaveAttribute("href", "/dashboard/admin/content-command");
    expect(await screen.findByText("No open blockers")).toBeInTheDocument();
    expect(await screen.findByText("No finance snapshot for this login")).toBeInTheDocument();
    expect(await screen.findByText(/Nothing completed yet/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an identity read failure in the task sections with Retry while the other widgets still load", async () => {
    allEmpty();
    results.set("v_production_unified", ok([{ annual_premium: 500 }]));
    const refetch = vi.fn();
    identity.current = { identity: { status: "error", message: "agents read failed" }, agentId: null, isLoading: false, isError: true, refetch, userId: "user-1" } satisfies UseAgentIdentityResult;

    renderPage();

    expect(await screen.findByText("$500 ALP")).toBeInTheDocument();
    expect(screen.getAllByText("agents read failed")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: /retry/i })[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.table === "today_tasks")).toBe(false);
    expect(screen.queryByText(/No tasks yet|No open tasks/)).not.toBeInTheDocument();
  });

  it("names an ambiguous or unlinked login instead of picking a row", async () => {
    allEmpty();
    identity.current = { identity: { status: "ambiguous", candidates: [AGENT_ROW, { ...AGENT_ROW, id: "agent-2" }] }, agentId: null, isLoading: false, isError: false, refetch: vi.fn(), userId: "user-1" } satisfies UseAgentIdentityResult;
    const first = renderPage();
    expect(await screen.findAllByText("More than one agent record matches this login")).toHaveLength(2);
    expect(screen.getAllByText(/2 records match/)).toHaveLength(2);
    expect(calls.some((call) => call.table === "today_tasks")).toBe(false);
    first.unmount();

    identity.current = { identity: { status: "none" }, agentId: null, isLoading: false, isError: false, refetch: vi.fn(), userId: "user-1" } satisfies UseAgentIdentityResult;
    renderPage();
    expect(await screen.findAllByText("This login has no agent record")).toHaveLength(2);
    expect(calls.some((call) => call.table === "today_tasks")).toBe(false);
  });
  it("an agent who is not staff sees only their own posted deals", async () => {
    allEmpty();
    auth.current = { isAdmin: false, isVa: false, isVaManager: false };
    results.set("v_production_unified", ok([{ annual_premium: 900 }]));

    renderPage();

    expect(await screen.findByText("$900 ALP")).toBeInTheDocument();
    expect(calls).toContainEqual({ table: "v_production_unified", method: "eq", args: ["agent_id", "agent-1"] });
  });

  it("an agent with no agent record gets the identity message on REVENUE, never an endless loading block", async () => {
    allEmpty();
    auth.current = { isAdmin: false, isVa: false, isVaManager: false };
    identity.current = { identity: { status: "none" }, agentId: null, isLoading: false, isError: false, refetch: vi.fn(), userId: "user-1" } satisfies UseAgentIdentityResult;

    renderPage();

    expect((await screen.findAllByText("This login has no agent record")).length).toBeGreaterThanOrEqual(2);
    expect(calls.some((call) => call.table === "v_production_unified")).toBe(false);
  });
});
