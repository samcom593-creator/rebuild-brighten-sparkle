import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { looseSupabase } from "@/lib/looseSupabase";
import { producerWorkspaceFixture } from "@/tests/helpers/producerWorkspaceFixture";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-a" } }) }));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-11-24" }));
vi.mock("@/hooks/useProductionRealtime", () => ({ useProductionRealtime: () => undefined }));
import { useProducerWorkspace } from "@/hooks/useProducerWorkspace";

const rpc = vi.mocked(looseSupabase.rpc);
beforeEach(() => { rpc.mockReset(); });
describe("producer workspace identity", () => {
  it("rejects a valid-looking response for another producer", async () => {
    rpc.mockResolvedValue({ data: { ...producerWorkspaceFixture(), agent_id: "other-producer" }, error: null } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useProducerWorkspace("producer-a"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toMatch(/could not be verified for this producer/);
  });
});
