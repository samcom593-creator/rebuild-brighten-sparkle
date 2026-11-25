import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildRecruitingActivity, RecruitingActivityChart } from "@/components/dashboard/RecruitingActivityChart";
import { conversionCount, type ConversionKind, type ConversionPayload, type ConversionPerson } from "@/lib/homeConversions";

const person = (kind: ConversionKind, on: string | null, period: "current" | "prior" = "current"): ConversionPerson => ({
  kind, on, period, name: "Not shown on chart", at: "2026-11-01T01:00:00Z", application_id: null, agent_id: null,
});
const payload = (start: string, end: string, people: ConversionPerson[] = []): ConversionPayload => ({
  today: end, as_of: `${end}T16:00:00Z`, week_start: start, prior_week_start: start,
  month_start: start, xcel_report_on: end,
  range: { start, end, prior_start: start, prior_end: start }, people,
});

describe("recruiting activity uses the existing dated counts", () => {
  it("uses server business dates, excludes the prior period and reconciles each series to its tile", () => {
    const data = payload("2026-10-27", "2026-10-29", [
      person("applied", "2026-10-27"), person("applied", "2026-10-29"),
      person("applied", "2026-10-26", "prior"),
      person("interview_booked", "2026-10-28"), person("hired", "2026-10-29"),
      person("selling", "2026-10-28"),
    ]);
    const chart = buildRecruitingActivity(data)!;
    expect(chart.buckets.map((bucket) => bucket.start)).toEqual(["2026-10-27", "2026-10-28", "2026-10-29"]);
    expect(chart.series.map((series) => series.counts)).toEqual([[1, 0, 1], [0, 1, 0], [0, 0, 1]]);
    for (const series of chart.series) {
      expect(series.counts!.reduce((sum, count) => sum + count, 0)).toBe(conversionCount(data, series.kind));
    }
  });

  it("groups long ranges into explicit seven-day totals without dropping a partial final interval", () => {
    const chart = buildRecruitingActivity(payload("2026-08-01", "2026-10-03", [
      person("applied", "2026-08-01"), person("applied", "2026-08-07"),
      person("applied", "2026-08-08"), person("applied", "2026-10-03"),
    ]))!;
    expect(chart.bucketDays).toBe(7);
    expect(chart.buckets).toHaveLength(10);
    expect(chart.buckets[0]).toEqual({ start: "2026-08-01", end: "2026-08-07" });
    expect(chart.buckets[chart.buckets.length - 1]).toEqual({ start: "2026-10-03", end: "2026-10-03" });
    expect(chart.series[0].counts).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("never draws future days as measured zeros", () => {
    const data = { ...payload("2026-10-28", "2026-10-30", [person("hired", "2026-10-29")]), today: "2026-10-29" };
    const chart = buildRecruitingActivity(data)!;
    expect(chart.end).toBe("2026-10-29");
    expect(chart.buckets).toHaveLength(2);
    expect(chart.series[2].counts).toEqual([0, 1]);
  });

  it.each([null, "2026-10-26", "2026-02-30"])("withholds an incomplete series instead of turning its unreadable date %s into zero", (on) => {
    const data = payload("2026-10-27", "2026-10-29", [person("applied", on), person("hired", "2026-10-29")]);
    const chart = buildRecruitingActivity(data)!;
    expect(chart.series[0].total).toBe(1);
    expect(chart.series[0].counts).toBeNull();
    expect(chart.series[2].counts).toEqual([0, 0, 1]);
    const { container } = render(<RecruitingActivityChart payload={data} />);
    expect(screen.getByText("Dates unavailable")).toBeInTheDocument();
    expect(container.querySelector('[data-kind="applied"]')).toBeNull();
    expect(container.querySelector('[data-kind="hired"]')).not.toBeNull();
  });

  it("does not manufacture a timeline from fixed windows, an invalid range or no response", () => {
    expect(buildRecruitingActivity(null)).toBeNull();
    expect(buildRecruitingActivity({ ...payload("2026-10-27", "2026-10-29"), range: null })).toBeNull();
    expect(buildRecruitingActivity(payload("2026-10-29", "2026-10-27"))).toBeNull();
    expect(buildRecruitingActivity(payload("2020-01-01", "2026-10-29"))).toBeNull();
    const { container } = render(<RecruitingActivityChart payload={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a measured zero state and exposes exact counts without any person's identity", () => {
    const { container, rerender } = render(<RecruitingActivityChart payload={payload("2026-10-27", "2026-10-29")} />);
    expect(screen.getByText("No recruiting activity recorded in these dates.")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    rerender(<RecruitingActivityChart payload={payload("2026-10-27", "2026-10-29", [person("applied", "2026-10-28")])} />);
    fireEvent.click(screen.getByText("View counts by date"));
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(within(rows[2]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["1", "0", "0"]);
    expect(container.textContent).not.toContain("Not shown on chart");
    expect(screen.queryByText("No recruiting activity recorded in these dates.")).toBeNull();
  });
});
