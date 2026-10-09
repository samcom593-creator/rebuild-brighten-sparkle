import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ms, person, rosterRow } from "../helpers/teamContractingFixtures";
import { RosterProductionList, RosterWorkList } from "@/components/team/RosterRows";

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
const byAgent = (...p: ReturnType<typeof person>[]) => new Map(p.map((x) => [x.agent_id, x] as const));

describe("working roster: contracting read states", () => {
  const rows = [rosterRow()];
  const map = byAgent(person({ milestones: [ms("aflac", "done"), ms("ethos", "done"), ms("first_contract", "done"), ms("agentlink", "done")], p1: false, p1_rank: null }));

  it("a failed contracting read says so in every row and never claims everyone is done", () => {
    wrap(<RosterWorkList rows={rows} byAgent={map} selectedId={null} onOpen={vi.fn()} read="error" />);
    expect(screen.getByText("Status unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/all 4 done/i)).toBeNull();
  });

  it("a read still loading says loading, not done", () => {
    wrap(<RosterWorkList rows={rows} byAgent={new Map()} selectedId={null} onOpen={vi.fn()} read="loading" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText(/all \d done/i)).toBeNull();
  });

  it("a successful read with every milestone ticked says all done", () => {
    wrap(<RosterWorkList rows={rows} byAgent={map} selectedId={null} onOpen={vi.fn()} read="ok" />);
    expect(screen.getByText("All 4 done")).toBeInTheDocument();
  });
});

describe("working roster: rows", () => {
  const overdue = person({ agent_id: "a1", display_name: "Ann Lee" });
  const waiting = rosterRow({ agent_id: "a2", full_name: "Bo Kim", license_status: "unlicensed", phone: null, email: null });

  it("writes overdue milestones with their state in words and lists the quiet ones plainly", () => {
    wrap(<RosterWorkList rows={[rosterRow()]} byAgent={byAgent(overdue)} selectedId={null} onOpen={vi.fn()} read="ok" />);
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText(/Aflac · overdue 3 days/)).toBeInTheDocument();
    expect(within(row).getByText(/First contract · overdue 1 day/)).toBeInTheDocument();
    expect(within(row).getByText(/Open: Ethos/)).toBeInTheDocument();
  });

  it("shows the next action, follow-up status, owner and last contact without opening anything", () => {
    wrap(<RosterWorkList rows={[rosterRow()]} byAgent={byAgent(overdue)} selectedId={null} onOpen={vi.fn()} read="ok" />);
    const row = screen.getAllByRole("row")[1];
    const nextCell = within(row).getByText("Next action").closest('[role="cell"]') as HTMLElement;
    expect(within(nextCell).getByText("Call")).toBeInTheDocument(); // the next action, not the contact link in the person cell
    expect(within(nextCell).getByText("No follow-up set")).toBeInTheDocument();
    expect(within(row).getByText("Mia Manager")).toBeInTheDocument();
    expect(within(row).getByText("Never contacted")).toBeInTheDocument();
  });

  it("does not time or flag someone contracting does not apply to yet", () => {
    wrap(<RosterWorkList rows={[waiting]} byAgent={new Map()} selectedId={null} onOpen={vi.fn()} read="ok" />);
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Starts after licensing")).toBeInTheDocument();
    expect(within(row).queryByText(/overdue/i)).toBeNull();
  });

  it("offers Call only when there is a phone number, and says plainly when there is none", () => {
    wrap(<RosterWorkList rows={[rosterRow(), waiting]} byAgent={byAgent(overdue)} selectedId={null} onOpen={vi.fn()} read="ok" />);
    expect(screen.getByRole("link", { name: "Call Ann Lee" })).toHaveAttribute("href");
    expect(screen.queryByRole("link", { name: "Call Bo Kim" })).toBeNull();
    expect(screen.getByText("No phone on file")).toBeInTheDocument();
  });

  it("keeps every row's Details control reachable and opens the right person", () => {
    const onOpen = vi.fn();
    wrap(<RosterWorkList rows={[rosterRow(), waiting]} byAgent={byAgent(overdue)} selectedId="a2" onOpen={onOpen} read="ok" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Open details for Bo Kim" })[0]);
    expect(onOpen).toHaveBeenCalledWith("a2");
    expect(screen.getAllByRole("button", { name: "Open details for Bo Kim" })[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button", { name: "Open details for Ann Lee" })[0]).toHaveAttribute("aria-expanded", "false");
  });

  it("renders the rows in exactly the order it is given, so the sort the page chose is the sort on screen", () => {
    const rows = ["Zed", "Amy", "Bob"].map((n, i) => rosterRow({ agent_id: `r${i}`, full_name: n }));
    wrap(<RosterWorkList rows={rows} byAgent={new Map()} selectedId={null} onOpen={vi.fn()} read="ok" />);
    const names = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("link")[0].textContent);
    expect(names).toEqual(["Zed", "Amy", "Bob"]);
  });

  it("badges a placeholder seat and offers no contact actions for it", () => {
    wrap(<RosterWorkList rows={[rosterRow({ agent_id: "g1", full_name: "GHOST seat", is_sync_only: true, phone: null, email: null })]} byAgent={new Map()} selectedId={null} onOpen={vi.fn()} read="ok" />);
    expect(screen.getByText("Sync only")).toBeInTheDocument();
    expect(screen.queryByText("No phone on file")).toBeNull();
  });
});

describe("production roster", () => {
  it("carries today's sale state, streak, aligned money columns and a never-sold state", () => {
    const rows = [
      rosterRow({ agent_id: "s1", full_name: "Sold Today", today_deals: 2, today_alp: 3200, selling_streak_days: 4, mtd_alp: 10200, mtd_deals: 4, l30_alp: 17300, lifetime_alp: 17300, lifetime_deals: 8, last_posted_date: "2026-10-09" }),
      rosterRow({ agent_id: "n1", full_name: "Never Sold" }),
    ];
    wrap(<RosterProductionList rows={rows} selectedId={null} onOpen={vi.fn()} />);
    expect(screen.getByText("Sold today")).toBeInTheDocument();
    expect(screen.getByText("4-day streak")).toBeInTheDocument();
    expect(screen.getByText("$10.2K")).toBeInTheDocument();
    expect(screen.getByText("No sale today")).toBeInTheDocument();
    expect(screen.getByText("Never sold")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toContain("Month ALP");
  });

  it("leaves Call and Email to the drawer so each row stays one line", () => {
    wrap(<RosterProductionList rows={[rosterRow()]} selectedId={null} onOpen={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /call ann lee/i })).toBeNull();
  });
});
