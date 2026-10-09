import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { rosterRow } from "../helpers/teamRosterFixtures";
import { RosterProductionList } from "@/components/team/RosterRows";

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("production roster: rows", () => {
  const waiting = rosterRow({ agent_id: "a2", full_name: "Bo Kim", license_status: "unlicensed", phone: null, email: null });

  it("carries no contracting status, overdue wording or follow-up on any row", () => {
    wrap(<RosterProductionList rows={[rosterRow(), waiting]} selectedId={null} onOpen={vi.fn()} />);
    expect(screen.queryByText(/overdue|behind|follow-up|next action|first contract|agentlink/i)).toBeNull();
  });

  it("keeps every row's Details control reachable and opens the right person", () => {
    const onOpen = vi.fn();
    wrap(<RosterProductionList rows={[rosterRow(), waiting]} selectedId="a2" onOpen={onOpen} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Open details for Bo Kim" })[0]);
    expect(onOpen).toHaveBeenCalledWith("a2");
    expect(screen.getAllByRole("button", { name: "Open details for Bo Kim" })[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button", { name: "Open details for Ann Lee" })[0]).toHaveAttribute("aria-expanded", "false");
  });

  it("renders the rows in exactly the order it is given, so the sort the page chose is the sort on screen", () => {
    const rows = ["Zed", "Amy", "Bob"].map((n, i) => rosterRow({ agent_id: `r${i}`, full_name: n }));
    wrap(<RosterProductionList rows={rows} selectedId={null} onOpen={vi.fn()} />);
    const names = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("link")[0].textContent);
    expect(names).toEqual(["Zed", "Amy", "Bob"]);
  });

  it("badges a placeholder seat", () => {
    wrap(<RosterProductionList rows={[rosterRow({ agent_id: "g1", full_name: "GHOST seat", is_sync_only: true, phone: null, email: null })]} selectedId={null} onOpen={vi.fn()} />);
    expect(screen.getByText("Sync only")).toBeInTheDocument();
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
