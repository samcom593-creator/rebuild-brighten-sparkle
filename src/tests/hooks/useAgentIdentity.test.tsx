/**
 * useAgentIdentity (F17): one cached answer per login; a failed read is an
 * error state with agentId null, never "none".
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth: { user: { id: string } | null; isLoading: boolean } = { user: { id: "user-1" }, isLoading: false };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

type Result = { data: unknown; error: unknown };
const db: { results: Result[]; calls: number } = { results: [], calls: 0 };
vi.mock("@/integrations/supabase/client", () => {
  function from() {
    const q: Record<string, unknown> = {};
    const chain = () => () => q;
    Object.assign(q, {
      select: chain(), eq: chain(), is: chain(), not: chain(), order: chain(), limit: chain(),
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        db.calls += 1;
        const r = db.results.shift() ?? { data: [], error: null };
        return Promise.resolve(r).then(resolve, reject);
      },
    });
    return q;
  }
  return { supabase: { from } };
});

import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { agentIdentityQueryKey } from "@/lib/agentIdentity";

const liveRow = (id: string) => ({
  id, user_id: "user-1", agent_code: "A1", display_name: "Test Agent", status: "active",
  is_inactive: false, is_deactivated: false, created_at: "2026-01-01T00:00:00Z", canonical_agent_id: null,
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  auth.user = { id: "user-1" };
  auth.isLoading = false;
  db.results = [];
  db.calls = 0;
});

describe("useAgentIdentity", () => {
  it("resolves the live row, exposes agentId, and caches under the shared key for 60s", async () => {
    db.results = [{ data: [liveRow("agent-1")], error: null }];
    const client = makeClient();
    const { result } = renderHook(() => useAgentIdentity(), { wrapper: wrapperFor(client) });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.identity).toBeUndefined();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.identity?.status).toBe("resolved");
    expect(result.current.agentId).toBe("agent-1");
    expect(result.current.isError).toBe(false);
    expect(result.current.userId).toBe("user-1");
    const cached = client.getQueryCache().find({ queryKey: agentIdentityQueryKey("user-1") });
    expect((cached?.options as { staleTime?: unknown } | undefined)?.staleTime).toBe(60_000);
  });

  it("a failed read is an error with agentId null, never none", async () => {
    db.results = [{ data: null, error: { message: "permission denied for table agents", code: "42501" } }];
    const { result } = renderHook(() => useAgentIdentity(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.identity).toEqual({ status: "error", message: "You do not have permission to view this." });
    expect(result.current.agentId).toBeNull();
    expect(result.current.isError).toBe(true);
  });

  it("no row of any kind is none", async () => {
    db.results = [{ data: [], error: null }, { data: [], error: null }];
    const { result } = renderHook(() => useAgentIdentity(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.identity).toEqual({ status: "none" });
    expect(result.current.agentId).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it("waits for auth without reading, and reports a signed-out session as an error rather than none", async () => {
    auth.user = null;
    auth.isLoading = true;
    const loading = renderHook(() => useAgentIdentity(), { wrapper: wrapperFor(makeClient()) });
    expect(loading.result.current.isLoading).toBe(true);
    expect(loading.result.current.identity).toBeUndefined();

    auth.isLoading = false;
    const out = renderHook(() => useAgentIdentity(), { wrapper: wrapperFor(makeClient()) });
    expect(out.result.current.isLoading).toBe(false);
    expect(out.result.current.identity).toEqual({ status: "error", message: "Not signed in." });
    expect(out.result.current.agentId).toBeNull();
    expect(db.calls).toBe(0);
  });

  it("refetch re-reads after a failure", async () => {
    db.results = [{ data: null, error: { message: "boom", code: "XX000" } }];
    const { result } = renderHook(() => useAgentIdentity(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    db.results = [{ data: [liveRow("agent-2")], error: null }];
    result.current.refetch();
    await waitFor(() => expect(result.current.agentId).toBe("agent-2"));
    expect(result.current.identity?.status).toBe("resolved");
  });
});
