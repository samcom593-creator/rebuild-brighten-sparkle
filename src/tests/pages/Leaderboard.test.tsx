/**
 * Leaderboard page (src/pages/Leaderboard.tsx, OVERHAUL-leaderboards 2026-10-29).
 *
 * Pinned: no lead spend anywhere; the $5,000 rule is on the board; only the rows the server
 * ranks are ranked, and a viewer under the bar sees their own distance to it instead; a
 * teammate's row has a Cheer button that sets the cheer on the server, says Cheered and pops
 * once from the button, and a second tap takes it back; your own row and a departed agent's
 * row have no button; the income estimate shows only where the server sent it; a failed read
 * is an error with Retry, never an empty board; the team board is closed to logins that are
 * not active agents; Recruiting and Referrals are for leaders only; the window lives in the URL
 * and is what the page asks the server for; the retired tabs (Top Producing Leg, Activity,
 * Custom) are gone.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Json = Record<string, unknown>;

const db = vi.hoisted(() => ({
  board: null as null | Record<string, unknown>,
  boardError: null as null | { message: string },
  cheerError: null as null | { message: string },
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  cheers: new Map<string, { cheers: number; mine: boolean }>(),
  apps: [] as Array<Record<string, unknown>>,
}));
const auth = vi.hoisted(() => ({ effectiveMode: "agent" as string }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      db.calls.push({ fn, args });
      if (fn === "leaderboard_team_board") {
        return Promise.resolve(db.boardError ? { data: null, error: db.boardError } : { data: db.board, error: null });
      }
      if (fn === "leaderboard_set_cheer") {
        if (db.cheerError) return Promise.resolve({ data: null, error: db.cheerError });
        const key = String(args.p_agent_key);
        const prev = db.cheers.get(key) ?? { cheers: 0, mine: false };
        const mine = args.p_cheer === true;
        const cheers = prev.cheers + (mine && !prev.mine ? 1 : !mine && prev.mine ? -1 : 0);
        db.cheers.set(key, { cheers, mine });
        return Promise.resolve({ data: { agent_key: key, month_start: "2026-10-01", cheers, cheered_by_me: mine }, error: null });
      }
      if (fn === "get_leaderboard_profiles") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const data = table === "applications" ? db.apps
        : table === "agents" ? [{ id: "sam-id", user_id: null, display_name: "Sam Owner" }]
        : table === "v_agent_canonical_map" ? [{ agent_id: "sam-id", canonical_agent_id: "sam-id" }]
        : [];
      const q: Record<string, unknown> = {};
      for (const k of ["select", "gte", "lt", "is", "not", "in", "eq", "order"]) q[k] = () => q;
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
      return q;
    },
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c; },
    removeChannel: () => {},
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "me" }, effectiveMode: auth.effectiveMode }) }));
// The burst and the sounds are spied, never run: jsdom has no canvas and no audio.
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn(() => Promise.resolve()), prefersReducedMotion: () => true }));
vi.mock("@/hooks/useSoundEffects", () => ({ playSoundEffect: vi.fn(), useSoundEffects: () => ({ playSound: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import Leaderboard from "@/pages/Leaderboard";
import { celebrate } from "@/lib/celebrate";
import { toast } from "sonner";

function boardRow(over: Json & { rank: number; agent_key: string; name: string; ap: number }): Json {
  return {
    agent_id: over.agent_key, avatar_url: null, deals: 4, month_ap: over.ap, est_earnings: null, readable: false,
    first_policy_date: "2026-08-23", agency: "APEX Financial", departed: false, is_viewer: false,
    cheers: 0, cheered_by_me: false, cheer_names: [], ...over,
  };
}

const JONTAY = "95759777-1432-4210-8e9b-f174d79685a2";
const EDWIN = "b541becd-0c94-49f6-8186-316a2caa9d07";
const MEJA = "f9bbec20-366e-41e6-a912-c0e309be8702";
const KJ = "431dff0d-7c82-4134-a85e-457e5226fc7f";

function payload(over: Json = {}): Record<string, unknown> {
  return {
    access: "team", full_reader: false, as_of: "2026-10-29T18:00:00Z",
    window_start: "2026-10-01", window_end: "2026-10-30", month_start: "2026-10-01", month_end: "2026-11-01", minimum: 5000,
    rows: [
      boardRow({ rank: 1, agent_key: JONTAY, name: "Jontay Taylor", ap: 41307.32, deals: 24, cheers: 2, cheer_names: ["Tyler Krejcha", "Cari Mullen"] }),
      boardRow({ rank: 2, agent_key: EDWIN, name: "Edwin Ac-lumor", ap: 38302, deals: 23 }),
      boardRow({ rank: 3, agent_key: MEJA, name: "Meja L Maka", ap: 10205.04, deals: 7, is_viewer: true, readable: true, est_earnings: 6123.02, cheers: 1, cheer_names: ["Edwin Ac-lumor"] }),
      boardRow({ rank: 4, agent_key: KJ, name: "KJ Vaughns", ap: 7000, departed: true }),
    ],
    me: { month_ap: 10205.04, month_deals: 7, ap: 10205.04, deals: 7, est_earnings: 6123.02 },
    below_bar_ap: null, agency_gap: [],
    ...over,
  };
}

function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="search">{search}</output>;
}

function renderPage(path = "/dashboard/leaderboard") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Leaderboard />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const list = () => screen.getByRole("list");
const rowOf = (name: string) => within(list()).getByText(name).closest("li") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T18:00:00Z"));
  db.board = payload();
  db.boardError = null;
  db.cheerError = null;
  db.calls = [];
  db.cheers = new Map([[JONTAY, { cheers: 2, mine: false }]]);
  db.apps = [];
  auth.effectiveMode = "agent";
  vi.mocked(celebrate).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Leaderboard", () => {
  it("states the $5,000 rule on the board and shows no lead spend anywhere", async () => {
    renderPage();
    expect(await screen.findByText("Jontay Taylor")).toBeInTheDocument();
    expect(screen.getByText(/The \$5,000 rule\./)).toBeInTheDocument();
    expect(screen.getByText(/Only agents with \$5,000 or more in sales in October are ranked\. Anyone under \$5,000 for the month is not ranked or counted\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/lead spend|after leads/i);
  });

  it("ranks exactly the rows the server ranked and adds them up for Team sales", async () => {
    renderPage();
    await screen.findByText("Jontay Taylor");
    expect(within(list()).getAllByRole("listitem")).toHaveLength(4);
    const standing = screen.getByRole("region", { name: /Your standing in October/ });
    // 41,307.32 + 38,302 + 10,205.04 + 7,000
    expect(within(standing).getByText("$96,814")).toBeInTheDocument();
    expect(within(standing).getByText("4 agents on the board")).toBeInTheDocument();
    expect(within(standing).getByText("#3")).toBeInTheDocument();
    expect(within(standing).getByText("of 4 agents on the board")).toBeInTheDocument();
    // Gap to #2: 38,302 - 10,205.04
    expect(within(standing).getByText("Gap to #2")).toBeInTheDocument();
    expect(within(standing).getByText("$28,097")).toBeInTheDocument();
  });

  it("does not rank a viewer under the bar, and tells them how far they have to go", async () => {
    db.board = payload({
      rows: (payload().rows as Json[]).map((r) => ({ ...r, is_viewer: false, readable: false, est_earnings: null })),
      me: { month_ap: 1411, month_deals: 1, ap: 1411, deals: 1, est_earnings: 846.6 },
    });
    renderPage();
    await screen.findByText("Jontay Taylor");
    expect(screen.queryByText("You")).not.toBeInTheDocument();
    const standing = screen.getByRole("region", { name: /Your standing in October/ });
    expect(within(standing).getByText("Not on the board yet")).toBeInTheDocument();
    expect(within(standing).getByText("To make the board")).toBeInTheDocument();
    expect(within(standing).getByText("$3,589")).toBeInTheDocument();
    expect(within(standing).getByText("$1,411")).toBeInTheDocument();
  });

  it("cheers a teammate on the server, says Cheered, pops once, and a second tap takes it back", async () => {
    renderPage();
    const button = await screen.findByRole("button", { name: "Cheer Edwin Ac-lumor" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    await waitFor(() => expect(within(rowOf("Edwin Ac-lumor")).getByRole("button", { name: "Cheered Edwin Ac-lumor" })).toHaveAttribute("aria-pressed", "true"));
    expect(db.calls.filter((c) => c.fn === "leaderboard_set_cheer")).toEqual([
      { fn: "leaderboard_set_cheer", args: { p_agent_key: EDWIN, p_month: "2026-10-01", p_cheer: true } },
    ]);
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(celebrate).mock.calls[0][0]).toBe("save");
    expect(within(rowOf("Edwin Ac-lumor")).getByText("You cheered")).toBeInTheDocument();

    fireEvent.click(within(rowOf("Edwin Ac-lumor")).getByRole("button", { name: "Cheered Edwin Ac-lumor" }));
    await waitFor(() => expect(within(rowOf("Edwin Ac-lumor")).getByRole("button", { name: "Cheer Edwin Ac-lumor" })).toHaveAttribute("aria-pressed", "false"));
    expect(db.calls.filter((c) => c.fn === "leaderboard_set_cheer").at(-1)?.args).toEqual({ p_agent_key: EDWIN, p_month: "2026-10-01", p_cheer: false });
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(within(rowOf("Edwin Ac-lumor")).queryByText(/cheered/)).not.toBeInTheDocument();
  });

  it("shows who cheered to the whole team, with no button on your own row or a departed agent's", async () => {
    renderPage();
    await screen.findByText("Jontay Taylor");
    expect(within(rowOf("Jontay Taylor")).getByText("Tyler Krejcha and Cari Mullen cheered")).toBeInTheDocument();
    const mine = rowOf("Meja L Maka");
    expect(within(mine).getByText("You")).toBeInTheDocument();
    expect(within(mine).getByText("Edwin Ac-lumor cheered")).toBeInTheDocument();
    expect(within(mine).queryByRole("button")).not.toBeInTheDocument();
    const departed = rowOf("KJ Vaughns");
    expect(within(departed).getByText("Left the team")).toBeInTheDocument();
    expect(within(departed).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the income estimate only on rows the server sent it for", async () => {
    renderPage();
    await screen.findByText("Jontay Taylor");
    expect(within(rowOf("Meja L Maka")).getByText(/est\. income \$6,123/)).toBeInTheDocument();
    expect(within(rowOf("Jontay Taylor")).queryByText(/est\. income/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/est\. income/)).toHaveLength(1);
  });

  it("says a failed cheer failed, with no burst", async () => {
    db.cheerError = { message: "Only agents on the board can be cheered" };
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Cheer Edwin Ac-lumor" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Only agents on the board can be cheered")));
    expect(celebrate).not.toHaveBeenCalled();
    expect(within(rowOf("Edwin Ac-lumor")).getByRole("button", { name: "Cheer Edwin Ac-lumor" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a failed read as an error with Retry, never as an empty board", async () => {
    db.boardError = { message: "statement timeout" };
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(/statement timeout/);
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
    expect(screen.queryByText(/Nobody has reached/)).not.toBeInTheDocument();
  });

  it("says an empty month is filling up, not broken", async () => {
    db.board = payload({ rows: [], me: { month_ap: 0, month_deals: 0, ap: 0, deals: 0, est_earnings: 0 } });
    renderPage();
    expect(await screen.findByText("Nobody has reached $5,000 in October yet")).toBeInTheDocument();
  });

  it("keeps the team board for active agents", async () => {
    db.board = payload({ access: "none", rows: [], me: null });
    renderPage();
    expect(await screen.findByText("The team board is for active agents")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("gives full readers what is not on the board, labelled, never ranked", async () => {
    db.board = payload({ full_reader: true, below_bar_ap: 1411, agency_gap: [{ agency: "Vantage Financial", deals: 6, ap: 7571.28 }] });
    renderPage();
    expect(await screen.findByText("Not on the board: $1,411 in October from agents under $5,000.")).toBeInTheDocument();
    expect(screen.getByText(/Vantage Financial: \$7,571 from 6 deals the agency reported that is not matched to a seller yet\. Not ranked\./)).toBeInTheDocument();
  });

  it("asks the server for the window picked, and keeps it in the URL", async () => {
    renderPage();
    await screen.findByText("Jontay Taylor");
    expect(db.calls.find((c) => c.fn === "leaderboard_team_board")?.args).toEqual({ p_start: "2026-10-01", p_end: "2026-10-30" });
    fireEvent.click(screen.getByRole("radio", { name: "Today" }));
    await waitFor(() => expect(db.calls.filter((c) => c.fn === "leaderboard_team_board").at(-1)?.args).toEqual({ p_start: "2026-10-29", p_end: "2026-10-30" }));
    expect(screen.getByTestId("search")).toHaveTextContent("?window=today");
    expect(screen.getByRole("radio", { name: "Today" })).toHaveAttribute("aria-checked", "true");
  });

  it("moves the window with the arrow keys, with one tab stop on the picked window", async () => {
    renderPage();
    await screen.findByText("Jontay Taylor");
    const month = screen.getByRole("radio", { name: "This month" });
    expect(month).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Today" })).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(month, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "This week" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("radio", { name: "This week" })).toHaveFocus();
    expect(screen.getByTestId("search")).toHaveTextContent("?window=week");
    fireEvent.keyDown(screen.getByRole("radio", { name: "This week" }), { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "This month" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByTestId("search")).toHaveTextContent(/^$/);
  });

  it("opens last month from the URL", async () => {
    renderPage("/dashboard/leaderboard?window=last_month");
    await screen.findByText("Jontay Taylor");
    expect(db.calls.find((c) => c.fn === "leaderboard_team_board")?.args).toEqual({ p_start: "2026-09-01", p_end: "2026-10-01" });
  });

  it("drops the retired views", async () => {
    renderPage();
    await screen.findByText("Jontay Taylor");
    expect(screen.queryByText(/Top Producing Leg/)).not.toBeInTheDocument();
    expect(screen.queryByText("Activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Custom")).not.toBeInTheDocument();
  });

  it("gives agents the sales board only, even when the URL asks for another", async () => {
    renderPage("/dashboard/leaderboard?board=recruiting");
    expect(await screen.findByText("Jontay Taylor")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Recruiting/ })).not.toBeInTheDocument();
    expect(db.calls.some((c) => c.fn === "leaderboard_team_board")).toBe(true);
  });

  it("gives leaders the Recruiting and Referrals boards", async () => {
    auth.effectiveMode = "manager";
    db.apps = [{ referral_recruiter_id: "sam-id", status: "interview", license_status: "unlicensed", contracted_at: "2026-10-10" }];
    renderPage("/dashboard/leaderboard?board=recruiting");
    expect(await screen.findByText("Sam Owner")).toBeInTheDocument();
    expect(screen.getByText("1 contracted ·")).toBeInTheDocument();
    expect(screen.getByText("1 moving forward")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Recruiting/ })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: /Referrals/ })).toBeInTheDocument();
  });
});
