/**
 * The scoreboard reads the production snapshot (mv_production_comp_truth), refreshed by a 5-minute
 * job, while Total IMO by agency reads live data. It now refetches when truth_refresh_state's
 * 'production' row reports the snapshot refreshed (dirty=false), and ignores the dirty-mark a new
 * deal writes before the snapshot has caught up (PL-REVIEW-P2, 2026-10-16).
 */
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

type Handler = (payload: { eventType: string; new: unknown; old: unknown }) => void;
const rt = vi.hoisted(() => ({ subs: [] as Array<{ table: string; filter?: string; event?: string; handler: Handler }> }));
vi.mock("@/shared/realtime/useRealtimeTable", () => ({
  useRealtimeTable: (opts: { table: string; filter?: string; event?: string }, handler: Handler) => {
    rt.subs.push({ table: opts.table, filter: opts.filter, event: opts.event, handler });
  },
}));
vi.mock("@/hooks/useProductionRealtime", () => ({ useProductionRealtime: () => undefined }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "sam" }, isAdmin: true, isManager: false }) }));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-10-16" }));

import { ScopedProductionScoreboard } from "@/components/dashboard/ScopedProductionScoreboard";

const boardCalls = () => vi.mocked(supabase.rpc).mock.calls.filter((c) => String(c[0]) === "scoped_production_scoreboard").length;

beforeEach(() => {
  rt.subs.length = 0;
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.rpc).mockImplementation((() => Promise.resolve({ data: null, error: null })) as never);
});

describe("scoreboard and the production snapshot", () => {
  it("refetches when the snapshot refreshes, not when a deal only marks it dirty", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ScopedProductionScoreboard /></MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(boardCalls()).toBe(1));
    const sub = rt.subs.filter((s) => s.table === "truth_refresh_state").at(-1);
    expect(sub).toMatchObject({ filter: "name=eq.production", event: "UPDATE" });

    sub!.handler({ eventType: "UPDATE", new: { name: "production", dirty: true }, old: null });
    await new Promise((r) => setTimeout(r, 30));
    expect(boardCalls()).toBe(1);

    sub!.handler({ eventType: "UPDATE", new: { name: "production", dirty: false }, old: null });
    await waitFor(() => expect(boardCalls()).toBe(2));
  });
});
