/**
 * /admin/recruit-funnel (WP8, 2026-11-10). The page's one promise is that it never turns an
 * answer the data cannot give into a number: a first-deal cell inside a dark production window
 * reads "unprovable" with the deals it can see as a floor, never 0%; a stage whose writer is
 * dead is named as unknown, not zero; and the inflow alarm says "dropped" when the view says so.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  cohort: [] as Array<Record<string, unknown>>,
  inflow: null as null | Record<string, unknown>,
  relations: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (relation: string) => {
      db.relations.push(relation);
      return {
        select: () => ({
          order: () => Promise.resolve({ data: relation === "v_recruit_funnel_cohort" ? db.cohort : [], error: null }),
          maybeSingle: () => Promise.resolve({ data: relation === "v_inflow_alert" ? db.inflow : null, error: null }),
        }),
      };
    },
  },
}));

import RecruitFunnel from "@/pages/admin/RecruitFunnel";

const base = {
  channel: "(all)",
  reached_contacted: 3, reached_interview: 3, reached_licensing: null, reached_licensed: 3, reached_contracted: 2, reached_first_deal: 0,
  human_contacted: 1, booked_people: 3, booking_rows: 4, attended: 0, hired_any: 2, hired_logged_in: 2,
  med_days_applied_to_contacted: null, med_days_applied_to_interview: 0.1, med_days_hired_to_first_deal: null,
  deal90_state: "unprovable", deal90_rate: null, deal90_yes: 0,
  hire_deal60_state: "unprovable", hire_deal60_rate: null, hire_deal60_yes: 0,
  production_truth_degraded: true, truth_suspect_since: "2026-09-28", degraded_origins: "agentcloud_producer:DARK",
  source_dead_contacted: true, source_dead_attended: true, source_dead_licensing: false, source_dead_licensed: false, source_dead_contracted: false,
  snapshot_at: "2026-11-10T21:14:22Z",
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RecruitFunnel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  db.relations = [];
  db.cohort = [
    { ...base, cohort_month: "2026-08-01", lane: "licensed", applications: 3, deal60_state: "unprovable", deal60_rate: null, deal60_yes: 1 },
    { ...base, cohort_month: "2026-06-01", lane: "licensed", applications: 20, deal60_state: "measured", deal60_rate: 0.05, deal60_yes: 1,
      deal90_state: "measured", deal90_rate: 0.1, deal90_yes: 2, hire_deal60_state: "measured", hire_deal60_rate: 0.167, hire_deal60_yes: 1 },
    { ...base, cohort_month: "2026-06-01", lane: "unlicensed", applications: 103, reached_licensing: 4, deal60_state: "measured", deal60_rate: 0, deal60_yes: 0, hired_any: 0 },
    { ...base, cohort_month: "2026-06-01", lane: "licensed", channel: "ig", applications: 5, deal60_state: "measured", deal60_rate: 0.2, deal60_yes: 1 },
  ];
  db.inflow = {
    as_of: "2026-08-17", last_full_week_start: "2026-08-10", last_4wk_total: 39, last_4wk_avg: 9.75, trailing_12wk_avg: 27.42,
    ratio: 0.356, baseline_26wk_avg: 23.3, ratio_vs_26wk: 0.418, verdict: "drop",
    weekly_last_16: [{ week: "2026-07-20", n: 11 }, { week: "2026-07-27", n: 9 }],
    channel_drops: [{ channel: "social-media", last_4wk: 24, trailing_12wk_per_4wk: 66.3 }],
  };
});

describe("RecruitFunnel", () => {
  it("reads only the two admin-gated views", async () => {
    renderPage();
    await screen.findByText("Aug 2026");
    expect(new Set(db.relations)).toEqual(new Set(["v_recruit_funnel_cohort", "v_inflow_alert"]));
  });

  // Columns: month, applications, the 6 steps after Applied, Talked to, Booked, then the three
  // first-deal cells (<=60d, <=90d, hire -> deal 60d).
  const rateCells = (row: HTMLElement) => {
    const cells = Array.from(row.querySelectorAll("td")) as HTMLElement[];
    expect(cells).toHaveLength(13);
    return { d60: cells[10], d90: cells[11], hire60: cells[12] };
  };

  it("an unprovable first-deal window shows the floor it can see, never a percentage", async () => {
    renderPage();
    const row = (await screen.findByText("Aug 2026")).closest("tr") as HTMLElement;
    const { d60, d90, hire60 } = rateCells(row);
    expect(within(d60).getByText("unprovable")).toBeTruthy();
    expect(within(d60).getByText("1+ seen")).toBeTruthy();
    for (const cell of [d60, d90, hire60]) expect(cell.textContent ?? "").not.toMatch(/\d%/);
  });

  it("a measured cohort shows its rate, and the default channel is the all-channels rollup", async () => {
    renderPage();
    const row = (await screen.findByText("Jun 2026")).closest("tr") as HTMLElement;
    const { d60, d90, hire60 } = rateCells(row);
    expect(d60.textContent).toBe("5%");
    expect(d90.textContent).toBe("10%");
    expect(hire60.textContent).toBe("16.7%");
    // the ig-only row (20%) stays behind the channel picker
    expect(screen.getAllByText("Jun 2026")).toHaveLength(1);
  });

  it("names dark production and dead stage writers as unknown, not zero", async () => {
    renderPage();
    await screen.findByText("Aug 2026");
    expect(screen.getByText(/Production is dark for agentcloud_producer:DARK since 2026-09-28/)).toBeTruthy();
    expect(screen.getByText(/read these as unknown, not zero: Contacted/)).toBeTruthy();
  });

  it("says the inflow dropped when the alarm says drop", async () => {
    renderPage();
    expect(await screen.findByText("inflow dropped")).toBeTruthy();
    expect(screen.getByText(/social-media \(24 in 4 weeks, was 66.3\)/)).toBeTruthy();
  });

  it("switching lanes shows that lane's cohorts only", async () => {
    renderPage();
    await screen.findByText("Aug 2026");
    fireEvent.click(screen.getByRole("tab", { name: "Not licensed" }));
    expect(screen.queryByText("Aug 2026")).toBeNull();
    const row = screen.getByText("Jun 2026").closest("tr") as HTMLElement;
    expect(within(row).getByText("no hires")).toBeTruthy();
  });
});
