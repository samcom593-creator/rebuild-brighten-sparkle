import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agent, fakeBackend } from "../helpers/reviewFixtures";
import { rosterRow } from "../helpers/teamRosterFixtures";

const auth = vi.hoisted(() => ({ isAdmin: true, isManager: false, isVaManager: false, isVa: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/shared/realtime/useRealtimeTable", () => ({ useRealtimeTable: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
const backend = vi.hoisted(() => ({ current: null as null | { rpc: (n: string, a?: Record<string, unknown>) => Promise<unknown> } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (n: string, a?: Record<string, unknown>) => backend.current!.rpc(n, a) } }));

import { TeamPersonDrawer } from "@/components/team/TeamPersonDrawer";

let fb: ReturnType<typeof fakeBackend>;
const mount = (row = rosterRow({ agent_id: "a1" }), onOpenContracting = vi.fn(), agents = [agent({ id: "a1", marked: ["aflac", "ethos"], level: { pct: 70, source: null, effective_from: null, updated_at: null } })]) => {
  fb = fakeBackend(agents);
  backend.current = fb;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><TeamPersonDrawer open onOpenChange={vi.fn()} row={row} onOpenContracting={onOpenContracting} /></MemoryRouter></QueryClientProvider>);
  return onOpenContracting;
};

beforeEach(() => Object.assign(auth, { isAdmin: true, isManager: false, isVaManager: false, isVa: false }));

describe("person drawer", () => {
  it("is one dialog with contact, onboarding and production, and no contracting checklist or follow-up plan", async () => {
    mount();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Production" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Onboarding" })).toBeInTheDocument();
    await screen.findByText(/carriers confirmed/);
    expect(screen.queryByText(/follow-up|overdue|first contract|agentlink|checklist/i)).toBeNull();
  });

  it("says where contracting stands (carriers confirmed, level) and sends you to the review to change it", async () => {
    const open = mount();
    expect(await screen.findByText(/2 of 4 carriers confirmed/)).toBeInTheDocument();
    expect(screen.getByText(/Placement level 70%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in contracting review" }));
    expect(open).toHaveBeenCalledWith("a1");
    // The drawer only reads: nothing here writes a carrier.
    expect(fb.calls("set_contract_review_mark")).toHaveLength(0);
  });

  it("an unknown level reads 'Not set', never 0%", async () => {
    mount(rosterRow({ agent_id: "a1" }), vi.fn(), [agent({ id: "a1" })]);
    expect(await screen.findByText(/Placement level Not set/)).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).toBeNull();
  });

  it("a failed review read says so with Retry instead of implying nothing is confirmed", async () => {
    fb = fakeBackend([agent({ id: "a1" })]);
    fb.state.rosterError = "timeout";
    backend.current = fb;
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><MemoryRouter><TeamPersonDrawer open onOpenChange={vi.fn()} row={rosterRow({ agent_id: "a1" })} onOpenContracting={vi.fn()} /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/i);
    expect(screen.queryByText(/carriers confirmed/)).toBeNull();
    fb.state.rosterError = null;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText(/carriers confirmed/)).toBeInTheDocument());
  });

  it("says a person outside the review is not in it, without inventing a status", async () => {
    mount(rosterRow({ agent_id: "someone-else" }), vi.fn(), [agent({ id: "a1" })]);
    expect(await screen.findByText(/Not part of the contracting review/)).toBeInTheDocument();
  });

  it("shows no contracting section to a role that cannot read it", () => {
    Object.assign(auth, { isAdmin: false });
    mount();
    expect(screen.queryByRole("heading", { name: "Contracting" })).toBeNull();
    expect(fb.calls("contract_review_roster")).toHaveLength(0);
  });

  it("never offers a dead Call button when there is no phone number", () => {
    mount(rosterRow({ agent_id: "a1", phone: null }));
    expect(screen.queryByRole("link", { name: /^call$/i })).toBeNull();
    expect(screen.getByText("No phone on file")).toBeInTheDocument();
  });
});
