/**
 * The postable board (/board, src/pages/BoardLive.tsx), OVERHAUL-leaderboards 2026-10-29.
 *
 * Pinned: it reads the same team board as the Leaderboard; the $5,000 rule is printed under the
 * title so it is in every screenshot; Team sales and Policies are the sum of exactly the rows on
 * it; the income estimate is shown only to a viewer the server sent it to for every row (Sam),
 * never to an agent; no lead spend; ?m=-1 is last month; the board is closed to logins that are
 * not active agents.
 */
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  board: null as null | Record<string, unknown>,
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      db.calls.push({ fn, args });
      if (fn === "leaderboard_team_board") return Promise.resolve({ data: db.board, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from: () => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "maybeSingle"]) q[k] = () => q;
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
      return q;
    },
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c; },
    removeChannel: () => {},
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn(() => Promise.resolve()), prefersReducedMotion: () => true }));

import BoardLive from "@/pages/BoardLive";

function row(rank: number, name: string, ap: number, deals: number, est: number | null) {
  return {
    rank, agent_key: `00000000-0000-4000-8000-00000000000${rank}`, agent_id: `00000000-0000-4000-8000-00000000000${rank}`,
    name, avatar_url: null, deals, ap, month_ap: ap, est_earnings: est, readable: est !== null,
    first_policy_date: "2026-08-23", agency: "APEX Financial", departed: false, is_viewer: false,
    cheers: rank === 1 ? 3 : 0, cheered_by_me: false, cheer_names: [],
  };
}

function payload(fullReader: boolean) {
  return {
    access: "team", full_reader: fullReader, as_of: "2026-10-29T18:00:00Z",
    window_start: "2026-10-01", window_end: "2026-10-30", month_start: "2026-10-01", month_end: "2026-11-01", minimum: 5000,
    rows: [row(1, "Jontay Taylor", 41307.32, 24, fullReader ? 24784.39 : null), row(2, "Edwin Ac-lumor", 38302, 23, fullReader ? 22981.2 : null)],
    me: null, below_bar_ap: fullReader ? 1411 : null, agency_gap: [],
  };
}

function renderBoard(path = "/board") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <BoardLive />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T18:00:00Z"));
  db.calls = [];
  db.board = payload(true);
});
afterEach(() => vi.useRealTimers());

describe("BoardLive", () => {
  it("prints the $5,000 rule under the title and adds up exactly the rows shown", async () => {
    renderBoard();
    expect(await screen.findByText("Jontay Taylor")).toBeInTheDocument();
    expect(screen.getByText("Ranked: agents with $5,000 or more in October.")).toBeInTheDocument();
    const totals = screen.getByText("Team sales").closest("dl") as HTMLElement;
    expect(within(totals).getByText("$79,609")).toBeInTheDocument();
    expect(within(totals).getByText("47")).toBeInTheDocument();
    expect(within(totals).getByText("$47,766")).toBeInTheDocument();
    expect(screen.getByText("3 cheers")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/lead spend/i);
    expect(screen.getByText(/Jontay Taylor leads · next milestone \$45,000/)).toBeInTheDocument();
  });

  it("never shows an agent anyone's income estimate", async () => {
    db.board = payload(false);
    renderBoard();
    await screen.findByText("Jontay Taylor");
    expect(screen.queryByText("Est. earnings")).not.toBeInTheDocument();
    expect(screen.queryByText("Est. income")).not.toBeInTheDocument();
  });

  it("shows last month for ?m=-1", async () => {
    db.board = { ...payload(true), month_start: "2026-09-01", month_end: "2026-10-01", window_start: "2026-09-01", window_end: "2026-10-01" };
    renderBoard("/board?m=-1");
    await screen.findByText("Jontay Taylor");
    expect(db.calls.find((c) => c.fn === "leaderboard_team_board")?.args).toEqual({ p_start: "2026-09-01", p_end: "2026-10-01" });
    expect(screen.getByText("Ranked: agents with $5,000 or more in September.")).toBeInTheDocument();
  });

  it("is closed to logins that are not active agents", async () => {
    db.board = { ...payload(false), access: "none", rows: [] };
    renderBoard();
    expect(await screen.findByText("The production board is for active agents on the team.")).toBeInTheDocument();
  });
});
