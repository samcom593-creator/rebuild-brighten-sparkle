import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useMyDownline } from "@/hooks/useMyDownline";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "viewer" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async () => ({ data: null, error: { message: "Request failed" } }) } }));
describe("downline failure", () => {
  it("keeps a failed lookup distinct from an empty team", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(useMyDownline, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
