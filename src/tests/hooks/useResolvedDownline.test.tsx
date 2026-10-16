/**
 * useResolvedDownline (F10 / F17): the manager's team comes from the resolved
 * row; a failed or malformed read is an error with no ids, never [].
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIdentity, AgentIdentityRow } from "@/lib/agentIdentity";

const auth: { user: { id: string } | null } = { user: { id: "user-1" } };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { useResolvedDownline } from "@/hooks/useResolvedDownline";

const row = (id: string): AgentIdentityRow => ({
  id,
  user_id: "user-1",
  agent_code: "M1",
  display_name: "Test Manager",
  status: "active",
  is_inactive: false,
  is_deactivated: false,
  created_at: "2026-01-01T00:00:00Z",
  canonical_agent_id: null,
});
const resolved: AgentIdentity = { status: "resolved", agentId: "manager-1", row: row("manager-1") };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  auth.user = { id: "user-1" };
  rpc.mockReset();
});

describe("useResolvedDownline", () => {
  it("reads the team under the resolved row with get_downline_agent_ids", async () => {
    rpc.mockResolvedValue({ data: [{ agent_id: "manager-1" }, { agent_id: "agent-2" }], error: null });
    const { result } = renderHook(() => useResolvedDownline(resolved, true), { wrapper });
    expect(result.current.isWaiting).toBe(true);
    expect(result.current.ids).toBeUndefined();
    await waitFor(() => expect(result.current.isWaiting).toBe(false));
    expect(result.current.ids).toEqual(["manager-1", "agent-2"]);
    expect(result.current.isError).toBe(false);
    expect(result.current.source).toBe("root");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_downline_agent_ids", { p_root_agent_id: "manager-1" });
  });

  it("a failed read is an error with no ids, never an empty team", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } });
    const { result } = renderHook(() => useResolvedDownline(resolved, true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.ids).toBeUndefined();
    expect(result.current.isWaiting).toBe(false);
    expect(result.current.error).toMatchObject({ code: "57014" });
  });

  it("a malformed answer is an error too", async () => {
    rpc.mockResolvedValue({ data: { agent_id: "manager-1" }, error: null });
    const { result } = renderHook(() => useResolvedDownline(resolved, true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.ids).toBeUndefined();
  });

  it("falls back to the server's own lookup when the resolver failed, and reports that source", async () => {
    rpc.mockResolvedValue({ data: [{ agent_id: "manager-1" }], error: null });
    const failed: AgentIdentity = { status: "error", message: "Network request failed." };
    const { result } = renderHook(() => useResolvedDownline(failed, true), { wrapper });
    await waitFor(() => expect(result.current.ids).toEqual(["manager-1"]));
    expect(result.current.source).toBe("server");
    expect(rpc).toHaveBeenCalledWith("my_downline_agent_ids");
  });

  it("reads nothing for an ambiguous login, a login with no row, or while identity loads", () => {
    const ambiguous: AgentIdentity = { status: "ambiguous", candidates: [row("a"), row("b")] };
    for (const identity of [ambiguous, { status: "none" } as AgentIdentity, undefined]) {
      const { result } = renderHook(() => useResolvedDownline(identity, true), { wrapper });
      expect(result.current.isWaiting).toBe(false);
      expect(result.current.ids).toBeUndefined();
      expect(result.current.isError).toBe(false);
      expect(result.current.source).toBe("none");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reads nothing when the viewer's scope is not a team, or when signed out", () => {
    const off = renderHook(() => useResolvedDownline(resolved, false), { wrapper });
    expect(off.result.current.isWaiting).toBe(false);
    expect(off.result.current.ids).toBeUndefined();
    auth.user = null;
    const signedOut = renderHook(() => useResolvedDownline(resolved, true), { wrapper });
    expect(signedOut.result.current.isWaiting).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
