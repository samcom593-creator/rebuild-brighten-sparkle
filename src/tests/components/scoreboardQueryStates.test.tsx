import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { ScopedProductionScoreboard, type ScoreboardData } from "@/components/dashboard/ScopedProductionScoreboard";

vi.mock("@/shared/realtime/useRealtimeTable", () => ({ useRealtimeTable: () => undefined }));
vi.mock("@/hooks/useProductionRealtime", () => ({ useProductionRealtime: () => undefined }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "sam" }, isManager: false }) }));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-10-27" }));

const key = ["scoped-production-scoreboard", "2026-10-01", "2026-10-28"];
const board = {
  has_producer_profile: true, scope_label: "My hierarchy", by_agent: [],
  personal: { ap: 12345, policies: 3 },
  direct_team: { ap: 0, policies: 0, agents: 0 },
  recursive_team: { ap: 0, policies: 0, agents: 0 }, imo: null,
  comp: { unknown_levels_in_scope: 0, viewer_pct: 100 },
  earnings: { estimated: 12345, direct: 12345, override: 0, team_estimated: 12345 },
  reconciliation: { duplicate_candidate_groups: 0 },
} as ScoreboardData;

beforeEach(() => {
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.rpc).mockImplementation((() => Promise.resolve({ data: null, error: null })) as never);
});

function mount(cached?: ScoreboardData) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  if (cached) client.setQueryData(key, cached);
  render(<QueryClientProvider client={client}><MemoryRouter><ScopedProductionScoreboard /></MemoryRouter></QueryClientProvider>);
  return client;
}

it("keeps confirmed totals through a failed refresh, labels their age, and recovers on Retry", async () => {
  const client = mount(board);
  expect(screen.getAllByText("$12,345").length).toBeGreaterThan(0);
  // Drive an actual TanStack refresh through both attempts (the component retries once).
  vi.mocked(supabase.rpc).mockImplementation(((name: string) => Promise.resolve(
    name === "scoped_production_scoreboard" ? { data: null, error: new Error("Network error") } : { data: null, error: null },
  )) as never);
  await act(async () => { await client.refetchQueries({ queryKey: key, exact: true }); });
  expect(screen.getByText(/Showing data as of/)).toHaveTextContent("The latest refresh failed");
  expect(screen.getAllByText("$12,345").length).toBeGreaterThan(0);
  expect(screen.queryByText(/login is not linked/)).not.toBeInTheDocument();
  vi.mocked(supabase.rpc).mockImplementation(((name: string) => Promise.resolve({
    data: name === "scoped_production_scoreboard" ? board : null, error: null,
  })) as never);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByText(/The latest refresh failed/)).not.toBeInTheDocument());
  client.clear();
}, 10000);

it("shows loading without zero totals or a missing-profile claim", () => {
  vi.mocked(supabase.rpc).mockImplementation((() => new Promise(() => {})) as never);
  const client = mount();
  expect(screen.getByText("Loading production totals")).toBeInTheDocument();
  expect(screen.queryByText("$0")).not.toBeInTheDocument();
  expect(screen.queryByText(/login is not linked/)).not.toBeInTheDocument();
  client.clear();
});

it("does not claim a missing profile when the server returns no scoreboard", async () => {
  const client = mount();
  expect(await screen.findByText("Production totals are unavailable")).toBeInTheDocument();
  expect(screen.queryByText(/login is not linked/)).not.toBeInTheDocument();
  expect(screen.queryByText("$0")).not.toBeInTheDocument();
  client.clear();
});

it("shows a first-load error without invented totals", async () => {
  vi.mocked(supabase.rpc).mockImplementation(((name: string) => Promise.resolve({
    data: null, error: name === "scoped_production_scoreboard" ? new Error("Network error") : null,
  })) as never);
  const client = mount();
  expect(await screen.findByText("Production totals could not load.", {}, { timeout: 6000 })).toBeInTheDocument();
  expect(screen.queryByText("$0")).not.toBeInTheDocument();
  expect(screen.queryByText(/login is not linked/)).not.toBeInTheDocument();
  client.clear();
}, 10000);
