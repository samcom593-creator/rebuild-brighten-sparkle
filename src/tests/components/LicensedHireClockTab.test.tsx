/**
 * Licensed hire clock (WP5, 2026-11-10).
 *
 * Production truth has DARK origins (v_production_origin_freshness: agentcloud_producer and external_daily_gap dark,
 * discord_external dying). A licensed recruit with no deal on record must therefore read "Unprovable", never
 * "No deal", or the clock would page Sam about measurement darkness as if it were a hire failing. These tests pin
 * that rule in the pure helper and in the rendered tab, plus the contracting wording ("No contracting record").
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HireClockRow } from "@/lib/hireClock";

const db = vi.hoisted(() => ({ rows: [] as unknown[], error: null as null | { message: string } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        order: () => Promise.resolve({ data: table === "v_licensed_hire_clock" ? db.rows : [], error: db.error }),
      };
      return chain;
    },
  },
}));

import { LicensedHireClockTab } from "@/components/team/LicensedHireClockTab";
import { contractingText, firstDealCell } from "@/lib/hireClock";

function row(over: Partial<HireClockRow> = {}): HireClockRow {
  return {
    agent_id: "a1", first_name: "Dana", hired_at: "2026-10-20T15:00:00Z", days_since_hire: 21, manager_first_name: "Samuel",
    owner_source: "manager", has_npn: true, contract_profile_present: false, marks: {}, marked_count: 0,
    required_carriers: [], required_missing: null, contracting_state: "no_record", onboarding_call_booked_at: null,
    onboarding_call_held: false, dialer_first_dial_at: null, dials_14d: 0, dials_total: 0, has_open_seat: false,
    lead_grant_at: null, first_deal_at: null, production_truth_degraded: true, dark_origins: ["agentcloud_producer", "external_daily_gap"],
    first_deal_state: "unprovable", next_checkpoint: null, next_checkpoint_at: null, stalled: true,
    next_action: "Get a carrier contract on file", ...over,
  };
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><LicensedHireClockTab /></QueryClientProvider>);
}

beforeEach(() => {
  db.rows = [];
  db.error = null;
});

describe("firstDealCell", () => {
  it("reads Unprovable, naming the dark origins, when there is no deal and truth is degraded", () => {
    const cell = firstDealCell(row());
    expect(cell.text).toBe("Unprovable");
    expect(cell.title).toContain("agentcloud_producer");
  });
  it("reads No deal yet only when every origin is live", () => {
    expect(firstDealCell(row({ first_deal_state: "none", production_truth_degraded: false, dark_origins: [] })).text).toBe("No deal yet");
  });
  it("shows the date when a deal exists in any source", () => {
    expect(firstDealCell(row({ first_deal_state: "has_deal", first_deal_at: "2026-10-25T12:00:00Z" })).tone).toBe("good");
  });
});

describe("contractingText", () => {
  it("says no contracting record when nothing is marked", () => {
    expect(contractingText(row())).toBe("No contracting record");
  });
  it("names missing required carriers once Sam has set the list", () => {
    expect(contractingText(row({ contracting_state: "partial", marks: { ethos: "2026-11-01" }, required_missing: ["chubb", "ahl"] }))).toBe("Missing Chubb, AHL");
  });
});

describe("LicensedHireClockTab", () => {
  it("renders Unprovable (never 'No deal') and the dark-truth note while an origin is dark", async () => {
    db.rows = [row()];
    renderTab();
    expect(await screen.findByText("Dana")).toBeInTheDocument();
    expect(screen.getByText("Unprovable")).toBeInTheDocument();
    expect(screen.queryByText("No deal yet")).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("agentcloud_producer");
    expect(screen.getByText("No contracting record")).toBeInTheDocument();
  });

  it("shows an error instead of an empty, on-track-looking list when the read fails", async () => {
    db.error = { message: "permission denied" };
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("did not load");
  });
});
