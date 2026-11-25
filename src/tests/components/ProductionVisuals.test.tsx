import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EarningsMixChart, PeriodComparisonBars, ProductionMixChart } from "@/components/dashboard/ProductionVisuals";

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
    expect(screen.getByText("ALP by hierarchy · same selected dates")).toBeInTheDocument();
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
    const { container } = render(<EarningsMixChart direct={1500} override={500} hidden />);
    expect(screen.getByText("Earnings breakdown hidden for presenting")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/1,500|500|75%/);
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
