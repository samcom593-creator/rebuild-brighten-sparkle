/**
 * ProductionMetricsCard (F33), rendered. The pure grading lives in src/lib/productionMetrics.ts and is covered by
 * src/tests/lib/productionMetrics.test.ts; this file proves what a manager actually sees: a failed or empty read is
 * named in plain English with its RPC in parentheses, no figure falls back to 0, and Retry is offered exactly when the
 * strip names a source to retry.
 */
import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductionMetricsCard } from "@/components/dashboard/ProductionMetricsCard";
import {
  ROSTER_PARTS, sourceError,
  type MetricSource, type ProductionMetricSnapshot, type RosterDerived, type TodayProductionSnapshot,
} from "@/lib/productionMetrics";

const summary: ProductionMetricSnapshot = { total: 95, active: 68, inactive: 27, terminated: 0, producing_mtd: 31, mtd_alp: 184_250, book_last_posted: "2026-10-14" };
const derived: RosterDerived = { teamSize: 67, newHires30dNoSale: 4 };
const todayRow: TodayProductionSnapshot = { today_alp: 2_582, today_policies: 1, selling_streak_days: 3, business_date: "2026-10-15" };

const ready = <T,>(value: T | null, extra: Partial<MetricSource<T>> = {}): MetricSource<T> => ({ status: "ready", value, stale: false, error: null, asOf: null, ...extra });
const failed = <T,>(error: unknown): MetricSource<T> => ({ status: "error", value: null, stale: false, error, asOf: null });

const figureValue = (label: string) => {
  const term = screen.getByText(label, { selector: "dt" });
  const values = Array.from(term.parentElement?.querySelectorAll("dd") ?? []);
  return values.map((node) => node.textContent);
};

describe("ProductionMetricsCard", () => {
  it("names the roster part that failed, keeps the summary figures, and never shows a fake zero", () => {
    const onRetry = vi.fn();
    const contactsDenied = sourceError(ROSTER_PARTS.contacts, { message: "permission denied for function crm_agent_contacts", code: "42501" });
    render(<ProductionMetricsCard segments={ready(summary)} roster={failed(contactsDenied)} today={ready(todayRow)} onRetry={onRetry} />);

    expect(figureValue("Team size")).toEqual(["Unavailable", "from the team roster"]);
    expect(figureValue("New hires, no sale")).toEqual(["Unavailable", "from the team roster"]);
    expect(figureValue("Producing this month")).toEqual(["31"]);
    expect(screen.getAllByText("from the team roster")[0].getAttribute("title")).toBe("crm_agent_roster");
    expect(Array.from(document.querySelectorAll("dd")).some((node) => node.textContent === "0")).toBe(false);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "Not loaded: the team roster, because agent contact details (crm_agent_contacts) could not be read. You do not have permission to view this.",
    );
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers Retry when the summary came back with no row, the case that used to show an inert button", () => {
    const onRetry = vi.fn();
    render(<ProductionMetricsCard segments={ready<ProductionMetricSnapshot>(null)} roster={ready(derived)} today={ready(todayRow)} onRetry={onRetry} />);

    expect(figureValue("Producing this month")).toEqual(["Unavailable", "from the team summary"]);
    expect(figureValue("Team size")).toEqual(["67"]);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Not loaded: the team summary (crm_roster_segments) came back empty.");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps an earlier roster on screen and says the refresh failed, naming the part", () => {
    const pulseDown = sourceError(ROSTER_PARTS.salesPulse, { message: "TypeError: Failed to fetch", code: "" });
    render(
      <ProductionMetricsCard
        segments={ready(summary)}
        roster={ready(derived, { stale: true, error: pulseDown, asOf: Date.UTC(2026, 9, 15, 19, 30) })}
        today={ready(todayRow)}
        onRetry={() => undefined}
      />,
    );

    expect(figureValue("Team size")).toEqual(["67"]);
    expect(screen.queryByRole("alert")).toBeNull();
    const notice = screen.getAllByRole("status").find((node) => node.textContent?.includes("Showing the team roster"));
    expect(notice?.textContent).toContain("Showing the team roster (crm_agent_roster) as of ");
    expect(notice?.textContent).toContain(
      "The latest refresh failed because today's sales by agent (crm_agent_sales_pulse) could not be read. Network error. Check your connection and retry.",
    );
  });

  it("shows today's line as unavailable with no policy count or streak when that read failed", () => {
    render(<ProductionMetricsCard segments={ready(summary)} roster={ready(derived)} today={failed(new Error("Failed to fetch"))} />);

    expect(screen.getByText("Sold Today: Unavailable")).toBeTruthy();
    expect(screen.queryByText(/polic(y|ies)/)).toBeNull();
    expect(screen.queryByText(/selling streak/)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Not loaded: today's production (crm_today_production) could not be read.");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows no notice and no Retry when every read completed", () => {
    render(<ProductionMetricsCard segments={ready(summary)} roster={ready(derived)} today={ready(todayRow)} onRetry={() => undefined} />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(figureValue("Team size")).toEqual(["67"]);
    expect(figureValue("Month-to-date ALP")).toEqual(["$184.3K", "through 2026-10-14"]);
  });
});

// The page is too hook-heavy to mount here, so its two F33 wiring rules are pinned on its source, the same way
// AgentCloudParity pins other DashboardCRM contracts.
describe("My Team page wiring (DashboardCRM.tsx)", () => {
  const page = fs.readFileSync(path.resolve(__dirname, "../../pages/DashboardCRM.tsx"), "utf8");

  it("retries every source the strip names, by the rule that names them", () => {
    expect(page).toContain("if (sourceNeedsRetry(rosterSource)) void rosterQuery.refetch();");
    expect(page).toContain("if (sourceNeedsRetry(segmentsSource)) void rosterSegmentsQuery.refetch();");
    expect(page).toContain("if (sourceNeedsRetry(todaySource)) void todayProductionQuery.refetch();");
    expect(page).toContain("onRetry={retryListedSources}");
    expect(page).not.toMatch(/if \((rosterQuery|rosterSegmentsQuery|todayProductionQuery)\.isError\) void/);
  });

  it("tags every roster part's failure with that part's own RPC", () => {
    expect(page).toContain("(ROSTER_PARTS.roster, rosterResult)");
    expect(page).toContain("(ROSTER_PARTS.salesPulse, pulseResult)");
    expect(page).toContain("(ROSTER_PARTS.contacts, contactResult)");
    expect(page).toContain("(ROSTER_PARTS.freeLeads, freeLeadsResult)");
    expect(page).not.toMatch(/throw (roster|pulse|contact|freeLeads)Result\.error/);
  });
});
