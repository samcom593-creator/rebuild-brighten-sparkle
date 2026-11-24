import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sync: vi.fn(), query: vi.fn(), invalidate: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.query, useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock("@/lib/contractingRequests", async (original) => ({ ...await original<typeof import("@/lib/contractingRequests")>(), syncContractingSheet: mocks.sync }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, warning: mocks.warning, message: mocks.message, error: mocks.error } }));
import { ContractingRequestsBoard } from "@/components/contracting/ContractingRequestsBoard";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockReturnValue({ isLoading: false, isError: false, data: { agents: 0, requests: 0, rows: [], default_advance: null, sheet: { id: null, queued: 0, failed: 0, last_synced_at: null } } });
});
describe("contracting sheet receipts", () => {
  it("reports partial failure even when the sync HTTP result is ok", async () => {
    mocks.sync.mockResolvedValue({ ok: true, processed: 3, synced: 2, failed: 1 });
    render(<MemoryRouter><ContractingRequestsBoard /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Sync sheet now" }));
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledWith("2 sheet writes confirmed; 1 failed. Review the affected requests."));
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("reports zero confirmed writes without claiming every request is in sync", async () => {
    mocks.sync.mockResolvedValue({ ok: true, processed: 0, synced: 0, failed: 0 });
    render(<MemoryRouter><ContractingRequestsBoard /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Sync sheet now" }));
    await waitFor(() => expect(mocks.message).toHaveBeenCalledWith("Sync finished: 0 writes confirmed, 0 checked. Check individual request receipts."));
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
