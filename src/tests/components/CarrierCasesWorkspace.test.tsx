import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { CarrierCaseRow } from "@/lib/contractingCases";

const fetchMock = vi.fn<(agentId?: string) => Promise<CarrierCaseRow[]>>();

vi.mock("@/lib/contractingCasesApi", () => ({
  CARRIER_CASES_QUERY_KEY: ["contracting-carrier-cases"],
  fetchCarrierCases: (agentId?: string) => fetchMock(agentId),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, isVa: false, isVaManager: false, isManager: false }),
}));

import { CarrierCasesWorkspace } from "@/components/contracting/CarrierCasesWorkspace";
import { ReadyToWriteCard } from "@/components/contracting/ReadyToWriteCard";

function base(partial: Partial<CarrierCaseRow>): CarrierCaseRow {
  return {
    agent_id: "a1", agent_name: "Test Agent One", agent_user_id: null, manager_id: null, manager_name: "Mgr",
    license_status: "licensed", npn: "1", al_user_id: 1, match_basis: "agentlink_id", agency_approval: "approved",
    upline_al_id: 2, upline_name: "Up", carrier_name: "Carrier A", carrier_level: "1", al_status: "submitted",
    al_synced_at: "2026-10-05T12:00:00Z", al_lifecycle: "submitted", lifecycle: "submitted", blocker: null,
    blocker_source: null, waiting_on: "carrier", waiting_on_override: null, blocker_override: null, owner_user_id: null,
    owner_name: "Mgr", owner_source: "manager", next_action: null, follow_up_on: null, note: null, carrier_stage: null,
    carrier_stage_at: null, closed_at: null, closed_reason: null, verified_at: null, verification_source: null,
    verified_by: null, evidence_ref: null, manual_verification_conflict: false, state_since: null,
    state_since_is_lower_bound: null, days_in_state: null, presubmit_missing: [], tracking_updated_at: null,
    q_agent_action: false, q_staff_action: false, q_support: false, q_carrier_review: true, q_follow_up_due: false,
    q_ready_to_submit: false, q_verified: false,
    ...partial,
  };
}

function wrap(node: ReactNode, path = "/dashboard/contracting/cases") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => fetchMock.mockReset());

describe("CarrierCasesWorkspace", () => {
  it("states cases and people separately and lists each carrier as its own row", async () => {
    fetchMock.mockResolvedValue([
      base({ carrier_name: "Carrier A" }),
      base({ carrier_name: "Carrier B", al_status: "active", al_lifecycle: "verified_ready_to_write", lifecycle: "verified_ready_to_write",
        verification_source: "AgentLink sync", verified_at: "2026-10-05T12:00:00Z", q_carrier_review: false, q_verified: true, waiting_on: null }),
      base({ agent_id: "a2", agent_name: "Test Agent Two", carrier_name: "Carrier A", al_status: "brand_new_status",
        al_lifecycle: "unknown", lifecycle: "unknown", q_carrier_review: false, q_support: true, waiting_on: "staff" }),
    ]);
    // The page opens on "Needs something", which hides finished carriers; All cases lists every row.
    wrap(<CarrierCasesWorkspace />, "/dashboard/contracting/cases?queue=all");
    await waitFor(() => expect(screen.getByText(/carrier cases across/)).toBeTruthy());
    expect(screen.getByText(/Counts are carrier cases/)).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + 3 cases
    expect(screen.getByText("Unknown (needs review)")).toBeTruthy();
    expect(screen.getByText(/does not recognise/)).toBeTruthy();
    expect(screen.getByText(/^Imported carrier record · last synced/)).toBeTruthy();
    expect(screen.getByText(/imported AgentLink records, last synced/)).toBeTruthy();
  });

  it("opens the queue and search named in the URL", async () => {
    fetchMock.mockResolvedValue([
      base({ carrier_name: "Carrier A" }),
      base({ agent_id: "a2", agent_name: "Test Agent Two", carrier_name: "Carrier B", q_carrier_review: false, q_staff_action: true }),
      base({ agent_id: "a3", agent_name: "Test Agent Three", carrier_name: "Carrier C", q_carrier_review: false, q_staff_action: true }),
    ]);
    wrap(<CarrierCasesWorkspace />, "/dashboard/contracting/cases?queue=staff_action&q=Three");
    await waitFor(() => expect(screen.getByText(/carrier cases across/)).toBeTruthy());
    expect(screen.getByRole("tab", { name: /Staff Action/ }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByLabelText("Search carrier cases") as HTMLInputElement).value).toBe("Three");
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + Test Agent Three
  });

  it("ignores an unknown queue in the URL instead of showing an empty list", async () => {
    fetchMock.mockResolvedValue([base({ carrier_name: "Carrier A" })]);
    wrap(<CarrierCasesWorkspace />, "/dashboard/contracting/cases?queue=not_a_queue");
    await waitFor(() => expect(screen.getByText(/carrier cases across/)).toBeTruthy());
    expect(screen.getByRole("tab", { name: /Needs something/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + the open case
  });

  it("opens on 'Needs something' and hides carriers that are ready to write", async () => {
    fetchMock.mockResolvedValue([
      base({ carrier_name: "Carrier A" }),
      base({ carrier_name: "Carrier B", lifecycle: "verified_ready_to_write", al_lifecycle: "verified_ready_to_write", q_carrier_review: false, q_verified: true, waiting_on: null }),
    ]);
    wrap(<CarrierCasesWorkspace />);
    await waitFor(() => expect(screen.getByText(/carrier cases across/)).toBeTruthy());
    expect(screen.getByRole("tab", { name: /Needs something/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + Carrier A only
  });
});

describe("ReadyToWriteCard", () => {
  it("shows the honest empty state when nothing is verified", async () => {
    fetchMock.mockResolvedValue([base({ carrier_name: "Carrier A" })]);
    wrap(<ReadyToWriteCard agentId="a1" />);
    await waitFor(() => expect(screen.getByText("No carrier verified ready to write yet.")).toBeTruthy());
    expect(screen.getByText(/Not yet writable/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("a1");
  });

  it("lists verified carriers with their source", async () => {
    fetchMock.mockResolvedValue([
      base({ carrier_name: "Carrier B", al_status: "active", lifecycle: "verified_ready_to_write", verified_at: "2026-10-05T12:00:00Z", verification_source: "AgentLink sync" }),
    ]);
    wrap(<ReadyToWriteCard agentId="a1" />);
    await waitFor(() => expect(screen.getByText("Carrier B")).toBeTruthy());
    expect(screen.getByText(/^Imported carrier record · last synced/)).toBeTruthy();
  });
});
