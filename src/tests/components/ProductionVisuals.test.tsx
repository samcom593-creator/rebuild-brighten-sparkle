import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EarningsMixChart, MonthPaceChart, PeriodComparisonBars, ProductionMixChart } from "@/components/dashboard/ProductionVisuals";

describe("production visuals use supplied scoped results", () => {
  it("compares hierarchy ALP on one scale while preserving exact amounts and policy counts", () => {
    const { container } = render(<ProductionMixChart rows={[
      { label: "Direct team", ap: 2400, policies: 3 },
      { label: "Agency B", ap: 600, policies: 1 },
    ]} />);
    const rows = within(screen.getByRole("list", { name: "Production by hierarchy chart" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Direct team$2,4003 policies");
    expect(rows[1]).toHaveTextContent("Agency B$6001 policy");
    const bars = container.querySelectorAll(".production-mix-chart__track > span");
    expect(bars[0]).toHaveStyle({ width: "100%" });
    expect(bars[1]).toHaveStyle({ width: "25%" });
    expect(rows[0]).toHaveTextContent("80.0% of shown ALP");
    expect(screen.getByText("ALP by hierarchy · same selected dates")).toBeInTheDocument();
  });

  it("ranks actual production in descending order, shares ties and leaves zero without a rank", () => {
    const input = [
      { id: "zero", label: "No production", ap: 0, policies: 0 },
      { id: "second", label: "Second team", ap: 500, policies: 1 },
      { id: "first-a", label: "Same name", ap: 1500, policies: 2 },
      { id: "first-b", label: "Same name", ap: 1500, policies: 3 },
    ];
    const { container } = render(<ProductionMixChart rows={input} />);
    const rows = within(screen.getByRole("list", { name: "Production by hierarchy chart" })).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-rank"))).toEqual(["1", "1", "3", "unranked"]);
    expect(rows[0]).toHaveTextContent("Same name$1,500");
    expect(rows[1]).toHaveTextContent("Same name$1,500");
    expect(rows[2]).toHaveTextContent("Second team$500");
    expect(container.querySelectorAll(".production-mix-chart__track > span")[3]).toHaveStyle({ width: "0%" });
    expect(input[0].id).toBe("zero");
  });

  it("does not draw a visible value for zero production or invent rows for an empty response", () => {
    const { container, rerender } = render(<ProductionMixChart rows={[{ label: "Team", ap: 0, policies: 0 }]} />);
    expect(container.querySelector(".production-mix-chart__track > span")).toHaveStyle({ width: "0%" });
    expect(screen.getByText("No ALP recorded in this window.")).toBeInTheDocument();
    rerender(<ProductionMixChart rows={[]} />);
    expect(screen.getByText("No production in this window.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("hides hierarchy names, dollar amounts and bar geometry in Present mode", () => {
    const { container } = render(<ProductionMixChart hidden rows={[{ label: "Private team", ap: 7350, policies: 9 }]} />);
    expect(screen.getByText("Production breakdown hidden for presenting")).toBeInTheDocument();
    expect(screen.queryByText(/Private team|7,350/)).not.toBeInTheDocument();
    expect(container.querySelector(".production-mix-chart__track")).toBeNull();
  });

  it("does not convert missing or negative production into a zero-valued chart", () => {
    const { container, rerender } = render(<ProductionMixChart rows={[{ label: "Team", ap: Number.NaN, policies: 1 }]} />);
    expect(screen.getByText(/production chart is unavailable/)).toBeInTheDocument();
    expect(container.querySelector(".production-mix-chart__track")).toBeNull();
    rerender(<ProductionMixChart rows={[{ label: "Team", ap: -50, policies: 1 }]} />);
    expect(screen.getByText(/production chart is unavailable/)).toBeInTheDocument();
  });
});

describe("current-month production pace", () => {
  it("keeps posted ALP, the supplied forecast and calendar progress distinct", () => {
    const { container } = render(<MonthPaceChart actual={12000} projected={24000} elapsedDays={15} daysInMonth={30} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/\$12,000 posted month to date against \$24,000 projected at month end/);
    expect(screen.getByRole("img")).toHaveAccessibleName(/estimate, not earned production or a goal/);
    expect(container.querySelector(".production-pace-chart__actual")).toHaveStyle({ width: "50%" });
    expect(container.querySelector(".production-pace-chart__time > span")).toHaveStyle({ width: "50%" });
    expect(screen.getByText("$800 ALP per elapsed calendar day")).toBeInTheDocument();
  });

  it("does not extrapolate a low-confidence forecast beyond the supplied result", () => {
    const { container } = render(<MonthPaceChart actual={3000} projected={3000} elapsedDays={2} daysInMonth={30} />);
    expect(container.querySelector(".production-pace-chart__actual")).toHaveStyle({ width: "100%" });
    expect(screen.getByRole("img")).toHaveAccessibleName(/\$3,000 projected at month end/);
  });

  it("removes amounts, averages and geometry while presenting", () => {
    const { container } = render(<MonthPaceChart actual={12000} projected={24000} elapsedDays={15} daysInMonth={30} hidden />);
    expect(screen.getByText("Production pace hidden for presenting")).toBeInTheDocument();
    expect(container.querySelector(".production-pace-chart")).toBeNull();
    expect(container.textContent).not.toMatch(/12,000|24,000|800|15|30/);
  });

  it("shows true zero without manufacturing progress", () => {
    const { container } = render(<MonthPaceChart actual={0} projected={0} elapsedDays={15} daysInMonth={30} />);
    expect(screen.getByText("No posted ALP yet this month.")).toBeInTheDocument();
    expect(container.querySelector(".production-pace-chart")).toBeNull();
  });

  it.each([
    { actual: Number.NaN, projected: 2000, elapsedDays: 15, daysInMonth: 30 },
    { actual: 2000, projected: 1000, elapsedDays: 15, daysInMonth: 30 },
    { actual: 1000, projected: 2000, elapsedDays: 0, daysInMonth: 30 },
    { actual: 1000, projected: 2000, elapsedDays: 31, daysInMonth: 30 },
  ])("withholds geometry when the pace inputs cannot be verified: %j", (props) => {
    const { container } = render(<MonthPaceChart {...props} />);
    expect(screen.getByText("Production pace is unavailable for this result.")).toBeInTheDocument();
    expect(container.querySelector(".production-pace-chart")).toBeNull();
  });
});

describe("estimated earnings chart", () => {
  it("represents direct and override accurately and identifies both as estimates", () => {
    const { container } = render(<EarningsMixChart direct={1500} override={500} />);
    expect(screen.getByRole("img")).toHaveAccessibleName("Estimated earnings split: direct $1,500, override $500. Estimates, not paid commissions.");
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(container.querySelector(".earnings-mix-chart__direct")).toHaveAttribute("stroke-dasharray", "75 25");
    expect(container.querySelector(".earnings-mix-chart__override")).toHaveAttribute("stroke-dashoffset", "-75");
    expect(screen.getByText("Estimated split · not paid commissions")).toBeInTheDocument();
  });

  it("does not render estimate values or geometry when earnings are hidden", () => {
    const { container } = render(<EarningsMixChart direct={1500} override={500} externalOverride={300} hidden />);
    expect(screen.getByText("Earnings breakdown hidden for presenting")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/1,500|500|300|External override|75%/);
  });

  it("includes a known external override in the same total and renders its third segment", () => {
    const { container } = render(<EarningsMixChart direct={600} override={200} externalOverride={200} />);
    expect(screen.getByRole("img")).toHaveAccessibleName("Estimated earnings split: direct $600, override $200, external override $200. Estimates, not paid commissions.");
    expect(container.querySelector(".earnings-mix-chart__direct")).toHaveAttribute("stroke-dasharray", "60 40");
    expect(container.querySelector(".earnings-mix-chart__override")).toHaveAttribute("stroke-dasharray", "20 80");
    expect(container.querySelector(".earnings-mix-chart__override")).toHaveAttribute("stroke-dashoffset", "-60");
    expect(container.querySelector(".earnings-mix-chart__external")).toHaveAttribute("stroke-dasharray", "20 80");
    expect(container.querySelector(".earnings-mix-chart__external")).toHaveAttribute("stroke-dashoffset", "-80");
    expect(screen.getByText("External override").parentElement).toHaveTextContent("20%");
  });

  it("does not show a zero-earnings state when only an external estimate exists", () => {
    const { container } = render(<EarningsMixChart direct={0} override={0} externalOverride={500} />);
    expect(container.querySelector(".earnings-mix-chart__external")).toHaveAttribute("stroke-dasharray", "100 0");
    expect(screen.getByText("External override").parentElement).toHaveTextContent("100%");
    expect(screen.queryByText("No estimated earnings in this window.")).not.toBeInTheDocument();
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -1])("withholds the split when the external override is unknown or invalid: %s", (externalOverride) => {
    const { container } = render(<EarningsMixChart direct={600} override={200} externalOverride={externalOverride} />);
    expect(screen.getByText(/earnings chart is unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector(".earnings-mix-chart__legend")).toBeNull();
  });

  it("shows a true zero state and does not substitute values for invalid estimates", () => {
    const { rerender } = render(<EarningsMixChart direct={0} override={0} />);
    expect(screen.getByText("No estimated earnings in this window.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    rerender(<EarningsMixChart direct={Number.NaN} override={100} />);
    expect(screen.getByText(/earnings chart is unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("recruiting period comparison bars", () => {
  it("compares the same metric's periods without manufacturing a cohort conversion rate", () => {
    const { container } = render(<PeriodComparisonBars current={2} previous={4} />);
    const bars = container.querySelectorAll("rect");
    expect(bars[1]).toHaveAttribute("width", "50");
    expect(bars[3]).toHaveAttribute("width", "100");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("leaves both bars at zero when there was no activity in either period", () => {
    const { container } = render(<PeriodComparisonBars current={0} previous={0} />);
    const bars = container.querySelectorAll("rect");
    expect(bars[1]).toHaveAttribute("width", "0");
    expect(bars[3]).toHaveAttribute("width", "0");
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("omits the comparison for an unknown or stale source count", () => {
    const { container, rerender } = render(<PeriodComparisonBars current={null} previous={2} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PeriodComparisonBars current={3} previous={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
