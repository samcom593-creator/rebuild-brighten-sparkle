import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, rpc } = vi.hoisted(() => ({ auth: { user: { id: "owner-one" } as { id: string } | null }, rpc: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { useContractRows, useContractSummary } from "@/hooks/useContractRecords";

beforeEach(() => { rpc.mockReset(); auth.user = { id: "owner-one" }; });

describe("contract record account boundaries", () => {
  it("loads each login's records independently and never displays the prior account during the new read", async () => {
    const pending: Array<(value: unknown) => void> = [];
    rpc.mockImplementation((name: string) => {
      if (auth.user?.id === "owner-two") return new Promise((resolve) => { pending.push(resolve); });
      return Promise.resolve({ data: name === "apex_contracts_list" ? [{ id: "contract-one", agent_name: "First owner" }] : { total: 1 }, error: null });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = renderHook(() => ({ rows: useContractRows("mine", "all", "", 0), summary: useContractSummary("mine", "") }), { wrapper });
    await waitFor(() => expect(view.result.current.rows.data?.[0].agent_name).toBe("First owner"));
    expect(view.result.current.summary.data?.total).toBe(1);
    auth.user = { id: "owner-two" }; view.rerender();
    expect(view.result.current.rows.data).toBeUndefined();
    expect(view.result.current.summary.data).toBeUndefined();
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => {
      pending[0]({ data: [{ id: "contract-two", agent_name: "Second owner" }], error: null });
      pending[1]({ data: { total: 2 }, error: null });
    });
    await waitFor(() => expect(view.result.current.rows.data?.[0].agent_name).toBe("Second owner"));
    expect(view.result.current.summary.data?.total).toBe(2);
    expect(client.getQueryData(["apex-contracts-list", "owner-one", "mine", "all", "", 0])).toEqual([expect.objectContaining({ agent_name: "First owner" })]);
    expect(client.getQueryData(["apex-contracts-list", "owner-two", "mine", "all", "", 0])).toEqual([expect.objectContaining({ agent_name: "Second owner" })]);
  });

  it("does not request private records without a signed-in user", () => {
    auth.user = null;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => ({ rows: useContractRows("mine", "all", "", 0), summary: useContractSummary("mine", "") }), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
