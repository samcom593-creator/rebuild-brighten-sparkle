import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rowsHook, summaryHook, rowsRefetch, summaryRefetch, directoryHook } = vi.hoisted(() => ({
  rowsHook: vi.fn(), summaryHook: vi.fn(), rowsRefetch: vi.fn(), summaryRefetch: vi.fn(), directoryHook: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true, isManager: false }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: directoryHook }));
vi.mock("@/hooks/useContractRecords", async (original) => ({
  ...await original<typeof import("@/hooks/useContractRecords")>(),
  useContractRows: rowsHook, useContractSummary: summaryHook,
}));
vi.mock("@/hooks/useContractReview", () => ({ useContractReview: () => ({ roster: { carriers: [] }, query: { isLoading: false, isError: false } }) }));
vi.mock("@/components/contracting/ContractingIntakeAdmin", () => ({ ContractingIntakeAdmin: () => <div>Intake history</div> }));
vi.mock("@/components/contracting/ContractingRequestsBoard", () => ({ ContractingRequestsBoard: () => <div>Request receipts</div> }));
vi.mock("@/components/contracting-review/ContractingReviewWorkspace", () => ({ ContractingReviewWorkspace: () => <div>Carrier review workspace</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import CarrierContracts from "@/pages/CarrierContracts";
import { CONTRACT_RECORD_PAGE_SIZE } from "@/hooks/useContractRecords";
import { CONTRACTING_LINK_URL, CONTRACTING_PROFILE_URL } from "@/lib/contractingLinks";

const writeText = vi.fn().mockResolvedValue(undefined);
const result = (data: unknown, extra = {}) => ({ data, isLoading: false, isError: false, ...extra });
const record = (index: number) => ({ id: `contract-${index}`, agent_id: `agent-${index}`, agent_name: `Producer ${index}`, carrier_name: "Fixture carrier", status: "active", writing_number: `W${index}`, contract_number: null });

beforeEach(() => {
  rowsHook.mockReset(); summaryHook.mockReset(); rowsRefetch.mockReset(); summaryRefetch.mockReset(); writeText.mockClear();
  directoryHook.mockReturnValue({ data: [], isLoading: false, isError: false, error: null });
  rowsHook.mockReturnValue(result([], { refetch: rowsRefetch }));
  summaryHook.mockReturnValue(result({ total: 0 }, { refetch: summaryRefetch }));
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

function renderPage(path = "/dashboard/contracting/documents") {
  render(<MemoryRouter initialEntries={[path]}><CarrierContracts /></MemoryRouter>);
}

describe("contract management workflow", () => {
  it("surfaces a carrier-directory failure instead of an empty carrier list", () => {
    const retry = vi.fn();
    directoryHook.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("Unavailable"), refetch: retry });
    renderPage("/dashboard/contracting/carriers");
    expect(screen.getByRole("alert")).toHaveTextContent("The carrier directory did not load.");
    expect(screen.getByText("Carrier count unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No active carriers")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry carrier directory" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it("surfaces a records failure and retries both queries without claiming there are no records", () => {
    rowsHook.mockReturnValue(result(undefined, { isError: true, refetch: rowsRefetch }));
    summaryHook.mockReturnValue(result(undefined, { isError: true, refetch: summaryRefetch }));
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("The contract records did not load.");
    expect(screen.getByText("Record count unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No contract records match")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next records" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry contract records" }));
    expect(rowsRefetch).toHaveBeenCalledTimes(1);
    expect(summaryRefetch).toHaveBeenCalledTimes(1);
  });

  it("reaches record 201, links its producer, and resets to the first page for a new search", async () => {
    summaryHook.mockImplementation((_scope: string, search: string) => result({ total: search ? 1 : 201 }, { refetch: summaryRefetch }));
    rowsHook.mockImplementation((_scope: string, _status: string, search: string, page: number) => result(
      search ? [record(7)] : page === 0 ? Array.from({ length: CONTRACT_RECORD_PAGE_SIZE }, (_, i) => record(i + 1)) : [record(201)],
      { refetch: rowsRefetch },
    ));
    renderPage();
    expect(screen.getByText("Page 1 · 200 records shown")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous records" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next records" }));
    expect(await screen.findByText("Page 2 · 1 records shown")).toBeInTheDocument();
    expect(rowsHook).toHaveBeenLastCalledWith("agency", "all", "", 1);
    expect(screen.getByRole("link", { name: "Producer 201" })).toHaveAttribute("href", "/dashboard/profile?agentId=agent-201");
    expect(screen.getByRole("button", { name: "Next records" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Search contract records" }), { target: { value: "W7" } });
    await waitFor(() => expect(rowsHook).toHaveBeenLastCalledWith("agency", "all", "W7", 0));
    expect(screen.getByText("Page 1 · 1 records shown")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous records" })).toBeDisabled();
  });

  it("keeps the carrier portal, signed-in profile and team-growth destinations distinct", async () => {
    renderPage("/dashboard/contracting");
    // Staff can copy either destination immediately; the signed-in agent supplies
    // their own details on the destination page, never in this handoff card.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy MGN portal link" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy agent profile link" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Copy MGN portal link" }));
    await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(1, CONTRACTING_LINK_URL));
    fireEvent.click(screen.getByRole("button", { name: "Copy agent profile link" }));
    await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(2, CONTRACTING_PROFILE_URL));
    expect(CONTRACTING_PROFILE_URL).not.toBe(CONTRACTING_LINK_URL);
    expect(screen.getByRole("link", { name: "Grow my team" })).toHaveAttribute("href", "/dashboard/grow");
    expect(screen.getByRole("link", { name: "Ethos submissions" })).toHaveAttribute("href", "/dashboard/grow");
    expect(screen.getByRole("link", { name: "Requests" })).toHaveAttribute("href", "/dashboard/contracting/requests");
    expect(screen.getByText(/MGN opens the carrier portal/)).toHaveTextContent("Galaxy profile link collects the signed-in agent's details for review");
  });
});
