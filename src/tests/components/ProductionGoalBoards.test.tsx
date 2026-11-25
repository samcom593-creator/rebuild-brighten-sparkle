import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { GoalProgressRail } from "@/components/ui/kpi-stat";
import { ManagerGoalBoardView } from "@/components/dashboard/ManagerGoalBoard";
import { Target20kBoardView } from "@/components/dashboard/Target20kPaceWidget";

type GoalBoard = ComponentProps<typeof ManagerGoalBoardView>["board"];
type PaceRow = ComponentProps<typeof Target20kBoardView>["rows"][number];

const goalBoard = (): GoalBoard => ({
  period_label: "November 2026", period_start: "2026-11-01",
  total_team_goal: 20000, total_team_actual: 12000,
  total_projected_sam_override: 2000, total_projected_mgr_income: 6000,
  managers: [{
    agent_id: "synthetic-manager", name: "Example Manager", has_goal: true,
    period_label: "November 2026", upcoming: false, ended: false, own_pct: 80,
    days_remaining: 15, frac: 0.5, biz_days_remaining: 10,
    personal_ap_actual: 2000, team_ap_actual: 12000, team_deals_actual: 6,
    team_members: 18, recruit_actual: 2, team_ap_goal: 20000, recruit_goal: 5,
    projected_mgr_income: 1600, projected_total_income: 6000,
    projected_sam_override: 2000, pace_pct: 120, needed_per_day: 800,
    projected_eom: 24000, status: "ahead", avg_deal_size: 2000,
    deals_to_goal: 10, deals_remaining: 4, deals_per_week: 2,
    deals_per_day: 0.4, ap_per_day: 800, recruits_needed: 3, ap_per_recruit: 4000,
  }],
});

const paceRow = (agent_id: string, ap: number): PaceRow => ({
  agent_id, name: `Producer ${agent_id}`, license_status: null, hired: null,
  deals_mtd: ap > 0 ? 4 : 0, ap_mtd: ap, deals_no_policy_mtd: 1,
  ap_at_risk_mtd: 500, ap_to_20k: Math.max(0, 20000 - ap),
  projected_eom_ap: ap * 2, pace_verdict: ap >= 20000 ? "hit_20k" : ap > 0 ? "on_pace_20k" : "zero_mtd",
});

describe("saved-goal progress", () => {
  it("uses the saved target and period pace without rounding a near miss into completion", () => {
    const { container } = render(<GoalProgressRail actual={19920} target={20000} paceFraction={0.5} label="Example goal" />);
    const bar = screen.getByRole("progressbar", { name: "Example goal" });
    expect(bar).toHaveAttribute("aria-valuenow", "19920");
    expect(bar).toHaveAttribute("aria-valuemax", "20000");
    expect(bar).toHaveAttribute("aria-valuetext", "$19,920 of $20,000 ALP; 99% of goal");
    expect(container.querySelector(".goal-progress__fill")).toHaveStyle({ width: "99.6%" });
    expect(container.querySelector(".goal-progress__today")).toHaveStyle({ left: "50%" });
    expect(screen.queryByText("100% of goal")).not.toBeInTheDocument();
  });

  it("keeps above-goal results exact while bounding only the bar geometry", () => {
    const { container } = render(<GoalProgressRail actual={25000} target={20000} label="Example goal" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20000");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "$25,000 of $20,000 ALP; 125% of goal");
    expect(container.querySelector(".goal-progress__fill")).toHaveStyle({ width: "100%" });
    expect(container.querySelector(".goal-progress__today")).toBeNull();
  });

  it.each([
    { actual: null, target: 20000 },
    { actual: 1000, target: 0 },
    { actual: Number.NaN, target: 20000 },
    { actual: -1, target: 20000 },
  ])("withholds geometry for missing or invalid inputs: %j", (values) => {
    const { container } = render(<GoalProgressRail {...values} label="Example goal" />);
    expect(screen.getByText("Goal progress unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(container.querySelector(".goal-progress__fill")).toBeNull();
  });
});

describe("manager goal presentation", () => {
  it("keeps period hires separate from roster size and labels goal-income estimates", () => {
    render(<MemoryRouter><ManagerGoalBoardView board={goalBoard()} /></MemoryRouter>);
    const row = screen.getByRole("article", { name: "Example Manager goal" });
    expect(within(row).getByText("New hires in goal period").parentElement).toHaveTextContent("2 / 5 goal");
    expect(within(row).getByText("Team members").parentElement).toHaveTextContent("18");
    expect(within(row).getByText("Manager est. income at goal")).toBeInTheDocument();
    expect(screen.getByText("November 2026 · saved goals")).toBeInTheDocument();
    expect(screen.queryByText("Demo figures")).not.toBeInTheDocument();
    expect(row.querySelector("details")).not.toHaveAttribute("open");
  });

  it("omits today's marker for future or completed saved periods", () => {
    const board = goalBoard();
    board.managers[0].upcoming = true;
    const { container, rerender } = render(<MemoryRouter><ManagerGoalBoardView board={board} isDemo /></MemoryRouter>);
    expect(container.querySelector(".goal-progress__today")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Demo figures");
    board.managers[0].upcoming = false;
    board.managers[0].ended = true;
    rerender(<MemoryRouter><ManagerGoalBoardView board={board} /></MemoryRouter>);
    expect(container.querySelector(".goal-progress__today")).toBeNull();
  });

  it("does not create actual production or a progress bar for an unmatched goal", () => {
    const board = goalBoard();
    board.managers[0] = { ...board.managers[0], agent_id: null, unmatched: true, status: "unmatched" };
    render(<MemoryRouter><ManagerGoalBoardView board={board} /></MemoryRouter>);
    const row = screen.getByRole("article", { name: "Example Manager goal" });
    expect(row).toHaveTextContent("$20,000");
    expect(row).not.toHaveTextContent("$12,000");
    expect(within(row).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(row).queryByRole("link", { name: /Open/ })).not.toBeInTheDocument();
  });
});

describe("$20K board presentation", () => {
  it("labels subtotals as shown rows and ranks real ALP with shared ties and unranked zeros", () => {
    const rows = [paceRow("zero", 0), paceRow("b", 12000), paceRow("a", 12000), paceRow("c", 5000)];
    render(<Target20kBoardView rows={rows} />);
    const ranked = within(screen.getByRole("list", { name: "Producer pace rankings" })).getAllByRole("listitem");
    expect(ranked.map((row) => row.querySelector(".target-pace-board__rank")?.getAttribute("aria-label"))).toEqual(["Rank 1", "Rank 1", "Rank 3", "No production rank"]);
    expect(ranked[0]).toHaveTextContent("Producer a");
    expect(screen.getByText("Shown agents · MTD").parentElement).toHaveTextContent("$29,000");
    expect(screen.getByText(/up to 100 agents shown/)).toBeInTheDocument();
    expect(rows[0].agent_id).toBe("zero");
    expect(screen.getAllByRole("progressbar")).toHaveLength(4);
    for (const bar of screen.getAllByRole("progressbar")) expect(bar).toHaveAttribute("aria-valuemax", "20000");
  });

  it("keeps missing figures unavailable instead of creating a zero or rank", () => {
    const row = { ...paceRow("unknown", 0), ap_mtd: Number.NaN, deals_mtd: Number.NaN };
    const { container } = render(<Target20kBoardView rows={[row]} isDemo />);
    expect(screen.getByText("Shown agents · MTD").parentElement).toHaveTextContent("—");
    expect(screen.getByText("posted deals").parentElement).toHaveTextContent("— posted deals");
    expect(screen.getByLabelText("No production rank")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Demo figures");
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("retains a true empty state without manufacturing producers", () => {
    render(<Target20kBoardView rows={[]} />);
    expect(screen.getByText("No production data yet for this month.")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
