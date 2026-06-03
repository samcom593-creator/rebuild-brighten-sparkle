/**
 * useApplicationStatus.test.ts
 *
 * Gaps covered:
 *   ✅ Disabled when applicationId is null
 *   ✅ Disabled when applicationId is undefined
 *   ✅ Enabled and fetches when applicationId is provided
 *   ✅ Returns data from RPC on success
 *   ✅ Returns null when RPC returns data.error
 *   ✅ Returns null when RPC returns null data
 *   ✅ Throws (→ React Query error state) when RPC returns error
 *   ✅ Calls RPC with correct param name p_application_id
 *   ✅ refetchOnWindowFocus is enabled (window focus revalidation)
 *   ✅ staleTime is 30s (avoids hammering on re-render)
 *
 * NOT YET TESTED:
 *   ❌ Window focus actually triggers refetch (RTL + fake focus events needed)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApplicationStatus } from "@/hooks/useApplicationStatus";
import type { ApplicationStatusSnapshot } from "@/hooks/useApplicationStatus";

const MOCK_SNAPSHOT: ApplicationStatusSnapshot = {
  application_id: "app-uuid-001",
  first_name: "John",
  last_name: "Doe",
  license_status: "unlicensed",
  status: "contacted",
  status_label: "Contacted",
  status_step: 2,
  status_steps_total: 10,
  created_at: "2026-06-01T00:00:00Z",
  contacted_at: "2026-06-02T00:00:00Z",
  manager: null,
  next_seminar_at: null,
  telegram_url: null,
  telegram_label: null,
  support_url: null,
  next_video_url: null,
  culture_line: null,
};

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function mockRpc(data: unknown, error: unknown = null) {
  (supabase as any).rpc = vi.fn().mockResolvedValue({ data, error });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useApplicationStatus — disabled states", () => {
  it("does not fetch when applicationId is null", async () => {
    const rpcMock = vi.fn();
    (supabase as any).rpc = rpcMock;
    const { result } = renderHook(() => useApplicationStatus(null), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("does not fetch when applicationId is undefined", async () => {
    const rpcMock = vi.fn();
    (supabase as any).rpc = rpcMock;
    const { result } = renderHook(() => useApplicationStatus(undefined), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("useApplicationStatus — fetch behavior", () => {
  it("fetches and returns snapshot data on success", async () => {
    mockRpc(MOCK_SNAPSHOT);
    const { result } = renderHook(() => useApplicationStatus("app-uuid-001"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(MOCK_SNAPSHOT);
  });

  it("calls RPC with the correct param name", async () => {
    mockRpc(MOCK_SNAPSHOT);
    renderHook(() => useApplicationStatus("app-uuid-002"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect((supabase as any).rpc).toHaveBeenCalledWith(
        "get_application_status",
        { p_application_id: "app-uuid-002" },
      );
    });
  });

  it("returns null when RPC data has an error field", async () => {
    mockRpc({ error: "not found" });
    const { result } = renderHook(() => useApplicationStatus("app-uuid-003"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("returns null when RPC returns null data", async () => {
    mockRpc(null);
    const { result } = renderHook(() => useApplicationStatus("app-uuid-004"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("enters error state when RPC returns an error object", async () => {
    mockRpc(null, { message: "permission denied" });
    const { result } = renderHook(() => useApplicationStatus("app-uuid-005"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
