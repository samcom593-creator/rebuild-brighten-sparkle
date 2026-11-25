import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { ProductionDemoContext } from "@/hooks/useDemoNumberFields";
import { ProductionDemoStore } from "@/lib/productionDemo";

const state = vi.hoisted(() => ({
  auth: { user: { id: "admin-a" } as { id: string } | null, isAdmin: true, isLoading: false },
  preview: false,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ isPreviewing: state.preview }) }));
import { ImoByAgency } from "@/components/dashboard/ImoByAgency";

type Reply = { data: unknown; error: null };
type Read = { viewer: string; source: string; args?: unknown; signal?: AbortSignal; filters: unknown[][] };
type Channel = { table: string; removed: boolean; deliver: (payload: unknown) => void };
const reads: Read[] = [];
const channels: Channel[] = [];
const pending = new Map<string, Promise<void>>();
const start = "2026-11-01";
const end = "2026-11-25";

function rows(viewer: string) {
  return [{ agency: `Agency ${viewer}`, is_primary: false, policies: 10, alp: viewer === "admin-a" ? 12300 : 7800, alp_mtd: 4200, policies_mtd: 3, policies_30d: 5, alp_30d: 6400, owner_override_pct: 0, est_owner_override_alp: 0, est_owner_override_mtd: 0, est_owner_override_30d: 0 }];
}
function chainFor(source: string, args?: unknown) {
  const read: Read = { source, args, viewer: state.auth.user!.id, filters: [] };
  reads.push(read);
  const data = source === "imo_by_agency_period" || source === "v_imo_by_agency" ? rows(read.viewer) : [];
  const reply = () => (pending.get(read.viewer) ?? Promise.resolve()).then(() => ({ data, error: null } as Reply));
  const chain = {
    select: () => chain,
    eq: (...values: unknown[]) => { read.filters.push(["eq", ...values]); return chain; },
    gte: (...values: unknown[]) => { read.filters.push(["gte", ...values]); return chain; },
    lt: (...values: unknown[]) => { read.filters.push(["lt", ...values]); return chain; },
    lte: (...values: unknown[]) => { read.filters.push(["lte", ...values]); return chain; },
    order: () => chain,
    abortSignal: (signal: AbortSignal) => { read.signal = signal; return chain; },
    then: (fulfilled: (value: Reply) => unknown, rejected?: (error: unknown) => unknown) => reply().then(fulfilled, rejected),
  };
  return chain;
}
function delay(viewer: string) {
  let finish!: () => void;
  pending.set(viewer, new Promise<void>(done => { finish = done; }));
  return finish;
}
function mount({ copies = 1, summary = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  let store = new ProductionDemoStore(state.auth.user?.id ?? "signed-out", null);
  const node = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProductionDemoContext.Provider value={store}>
          {Array.from({ length: copies }, (_, index) => <ImoByAgency key={`copy-${index}`} {...(summary ? {} : { start, end, windowLabel: "Month to date" })} />)}
        </ProductionDemoContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client, node, store, useStore: (next: ProductionDemoStore) => { store = next; }, ...render(node()) };
}

beforeEach(() => {
  state.auth = { user: { id: "admin-a" }, isAdmin: true, isLoading: false };
  state.preview = false;
  pending.clear(); reads.length = 0; channels.length = 0;
  vi.mocked(supabase.from).mockReset();
  vi.mocked(supabase.from).mockImplementation((source: string) => chainFor(source) as never);
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.rpc).mockImplementation((source: string, args?: unknown) => chainFor(source, args) as never);
  vi.mocked(supabase.channel).mockReset();
  vi.mocked(supabase.channel).mockImplementation(() => {
    const channel: Channel = { table: "", removed: false, deliver: () => undefined };
    channels.push(channel);
    const chain = {
      marker: channel,
      on: (_event: string, options: { table: string }, callback: (payload: unknown) => void) => { channel.table = options.table; channel.deliver = callback; return chain; },
      subscribe: () => chain,
    };
    return chain as never;
  });
  vi.mocked(supabase.removeChannel).mockReset();
  vi.mocked(supabase.removeChannel).mockImplementation(channel => {
    (channel as unknown as { marker: Channel }).marker.removed = true;
    return Promise.resolve("ok");
  });
});
afterEach(() => { vi.useRealTimers(); });

describe("ImoByAgency authorization and cache scope", () => {
  it.each(["signed out", "agent", "loading", "preview"])("does not query, subscribe, or register demo fields for %s", mode => {
    if (mode === "signed out") state.auth.user = null;
    if (mode === "agent") state.auth.isAdmin = false;
    if (mode === "loading") state.auth.isLoading = true;
    if (mode === "preview") state.preview = true;
    const view = mount();
    expect(view.container).toBeEmptyDOMElement();
    expect(reads).toEqual([]);
    expect(channels).toEqual([]);
    expect(view.store.getSnapshot().scopes).toEqual([]);
    expect(view.client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("binds all three reads to the real viewer and preserves the end-exclusive production window", async () => {
    const view = mount();
    expect(await screen.findByText("Agency admin-a")).toBeInTheDocument();
    expect(reads).toHaveLength(3);
    expect(reads.every(read => read.signal instanceof AbortSignal)).toBe(true);
    expect(reads.find(read => read.source === "imo_by_agency_period")?.args).toEqual({ p_start: start, p_end: end });
    expect(reads.find(read => read.source === "production_external_daily_snapshots")?.filters).toContainEqual(["lt", "business_date", end]);
    expect(view.client.getQueryCache().getAll().map(query => query.queryKey)).toEqual(expect.arrayContaining([
      ["vantage-api-production", "admin-a", start, end],
      ["imo-by-agency", "admin-a", start, end],
      ["production-attribution-exceptions", "admin-a", start, end],
    ]));
    expect(channels.map(channel => channel.table)).toEqual(["deals", "agentlink_book", "production_external_daily_snapshots", "production_external_deals"]);
  });

  it("keeps the summary view and inclusive current-day snapshot path available", async () => {
    const view = mount({ summary: true });
    expect(await screen.findByText("Agency admin-a")).toBeInTheDocument();
    expect(reads.some(read => read.source === "v_imo_by_agency")).toBe(true);
    expect(reads.some(read => read.source === "imo_by_agency_period")).toBe(false);
    expect(reads.find(read => read.source === "production_external_daily_snapshots")?.filters.some(filter => filter[0] === "lte")).toBe(true);
    expect(view.client.getQueryData(["imo-by-agency", "admin-a", "summary", "summary"])).toEqual(rows("admin-a"));
  });

  it("removes cached figures, subscriptions and registered demo fields during role preview", async () => {
    const view = mount();
    await screen.findByText("Agency admin-a");
    expect(view.store.getSnapshot().scopes).toHaveLength(1);
    state.preview = true;
    view.rerender(view.node());
    expect(view.container).toBeEmptyDOMElement();
    expect(channels.every(channel => channel.removed)).toBe(true);
    expect(view.store.getSnapshot().scopes).toEqual([]);
    expect(reads).toHaveLength(3);
  });

  it("does not display a prior admin's cache while a different admin's data is pending", async () => {
    const view = mount();
    await screen.findByText("Agency admin-a");
    const finish = delay("admin-b");
    state.auth.user = { id: "admin-b" };
    view.useStore(new ProductionDemoStore("admin-b", null));
    view.rerender(view.node());
    expect(screen.queryByText("Agency admin-a")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading agency totals");
    expect(channels.slice(0, 4).every(channel => channel.removed)).toBe(true);
    await act(async () => finish());
    expect(await screen.findByText("Agency admin-b")).toBeInTheDocument();
    expect(screen.queryByText("Agency admin-a")).not.toBeInTheDocument();
    expect(view.client.getQueryData(["imo-by-agency", "admin-b", start, end])).toEqual(rows("admin-b"));
  });

  it("cancels prior-account reads and ignores late results after a role downgrade", async () => {
    const finish = delay("admin-a");
    const view = mount();
    await waitFor(() => expect(reads).toHaveLength(3));
    const signals = reads.map(read => read.signal!);
    state.auth.isAdmin = false;
    view.rerender(view.node());
    expect(signals.every(signal => signal.aborted)).toBe(true);
    await act(async () => finish());
    expect(view.container).toBeEmptyDOMElement();
    expect(view.client.getQueryData(["imo-by-agency", "admin-a", start, end])).toBeUndefined();
  });

  it("keeps demo edits local to the displayed fields without altering query cache data", async () => {
    const view = mount();
    await screen.findByText("Agency admin-a");
    const scope = view.store.getSnapshot().scopes[0];
    const field = scope.fields.find(item => item.key.endsWith(":alp"))!;
    act(() => { expect(view.store.save([{ scopeKey: scope.scopeKey, key: field.key, value: 24000 }]).ok).toBe(true); });
    expect(screen.getByRole("status")).toHaveTextContent("Demo figures");
    expect(screen.getAllByText("$24,000")).toHaveLength(2);
    expect(view.client.getQueryData(["imo-by-agency", "admin-a", start, end])).toEqual(rows("admin-a"));
    expect(reads).toHaveLength(3);
  });

  it("coalesces write bursts and reuses a pending heavy read across duplicate mounts without invalidating another viewer", async () => {
    const view = mount({ copies: 2 });
    expect(await screen.findAllByText("Agency admin-a")).toHaveLength(2);
    expect(reads).toHaveLength(3);
    view.client.setQueryData(["imo-by-agency", "admin-b", start, end], rows("admin-b"));
    view.client.setQueryData(["vantage-api-production", "admin-b", start, end], []);
    const finish = delay("admin-a");
    vi.useFakeTimers();
    const emit = () => {
      for (const channel of channels.filter(channel => channel.table === "deals" && !channel.removed)) {
        for (let index = 0; index < 11; index += 1) channel.deliver({ eventType: "INSERT", new: null, old: null });
      }
    };
    emit();
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(reads.filter(read => read.source === "imo_by_agency_period")).toHaveLength(2);
    expect(reads.filter(read => read.source === "production_external_daily_snapshots")).toHaveLength(2);
    emit();
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(reads.filter(read => read.source === "imo_by_agency_period")).toHaveLength(2);
    expect(reads.filter(read => read.source === "production_external_daily_snapshots")).toHaveLength(2);
    expect(reads.slice(3).every(read => !read.signal?.aborted)).toBe(true);
    expect(view.client.getQueryState(["imo-by-agency", "admin-b", start, end])?.isInvalidated).toBe(false);
    expect(view.client.getQueryState(["vantage-api-production", "admin-b", start, end])?.isInvalidated).toBe(false);
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(0); });
  });
});
