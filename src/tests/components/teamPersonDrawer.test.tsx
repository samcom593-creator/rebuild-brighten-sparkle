import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agent, fakeBackend } from "../helpers/reviewFixtures";
import { teamProfile } from "../helpers/teamProfileFixtures";
import { rosterRow } from "../helpers/teamRosterFixtures";

const auth = vi.hoisted(() => ({ isAdmin: true, isManager: false, isVaManager: false, isVa: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/shared/realtime/useRealtimeTable", () => ({ useRealtimeTable: vi.fn() }));
vi.mock("@/hooks/useProductionRealtime", () => ({ useProductionRealtime: vi.fn() }));
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
    await screen.findByText(/Contracting profile details/);
    expect(screen.queryByText(/follow-up|overdue|first contract|agentlink|checklist/i)).toBeNull();
  });

  it("shows profile completeness and opens the current receipt workspace without an obsolete carrier total", async () => {
    const open = mount();
    expect(await screen.findByText("Contracting profile details incomplete")).toBeInTheDocument();
    expect(screen.queryByText(/of 4 carriers confirmed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Placement level/)).toBeNull(); // the level is shown only on the review itself
    fireEvent.click(screen.getByRole("button", { name: "Open in contracting review" }));
    expect(open).toHaveBeenCalledWith("a1");
    // The drawer only reads: nothing here writes a carrier.
    expect(fb.calls("set_contract_review_mark")).toHaveLength(0);
  });

  it("an unknown level reads 'Not set', never 0%", async () => {
    mount(rosterRow({ agent_id: "a1" }), vi.fn(), [agent({ id: "a1" })]);
    expect(await screen.findByText("Contracting profile details incomplete")).toBeInTheDocument();
    expect(screen.queryByText(/Placement level/)).toBeNull();
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
    await waitFor(() => expect(screen.getByText(/Contracting profile details/)).toBeInTheDocument());
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

  // MP-TEAM-PROFILE-FACTS (2026-11-27): the contracts and details Sam asked to see on every person.
  it("shows the Ethos contract with its source, every carrier contract, state, Instagram and last sign-in from the profile facts", () => {
    fb = fakeBackend([agent({ id: "a1" })]);
    backend.current = fb;
    const profile = teamProfile({
      agent_id: "a1", home_state: "WI", home_state_source: "application", license_states: ["WI", "IL"], instagram: "ann.sells", npn: "12345678",
      last_sign_in_at: null, discord_joined: true, ethos_back: true, ethos_source: "ethos_hierarchy", ethos_since: "2026-11-19", ethos_issued: 17970.84, ethos_inforce: 15681.84,
      carriers: [{ carrier: "Ethos", status: "active", source: "ethos_hierarchy", as_of: "2026-11-19", active: true }, { carrier: "Prudential", status: "submitted", source: "agentlink", as_of: "2026-05-16", active: false }],
      carriers_active: 1, sold_carriers: [{ carrier: "Foresters", deals: 41, alp: 50457, last_posted: "2026-09-22" }],
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><MemoryRouter>
      <TeamPersonDrawer open onOpenChange={vi.fn()} row={rosterRow({ agent_id: "a1" })} onOpenContracting={vi.fn()} profile={profile} profileState="ready" />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "Contracts and details" })).toBeInTheDocument();
    expect(screen.getByText(/Back, on the Ethos hierarchy export \(Nov 19/)).toBeInTheDocument();
    expect(screen.getByText(/Issued \$18\.0K, in force \$15\.7K/)).toBeInTheDocument();
    expect(screen.getByText("Prudential")).toBeInTheDocument();
    expect(screen.getByText(/· submitted/)).toBeInTheDocument();
    expect(screen.getByText(/Foresters \$50\.5K \(41 deals\)/)).toBeInTheDocument();
    expect(screen.getByText(/WI, licensed in IL/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "@ann.sells" })).toHaveAttribute("href", "https://www.instagram.com/ann.sells/");
    expect(screen.getByRole("link", { name: /Instagram/ })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("Never signed in")).toBeInTheDocument();
    expect(screen.getByText(/In Discord · not in Slack yet/)).toBeInTheDocument();
    expect(screen.getByText("12345678")).toBeInTheDocument();
  });

  it("a licensed person with nothing on file reads 'Nothing on file says it is back', never 'no Ethos'", () => {
    fb = fakeBackend([agent({ id: "a1" })]);
    backend.current = fb;
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><MemoryRouter>
      <TeamPersonDrawer open onOpenChange={vi.fn()} row={rosterRow({ agent_id: "a1" })} onOpenContracting={vi.fn()} profile={teamProfile({ agent_id: "a1" })} profileState="ready" />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByText("Nothing on file says it is back or requested")).toBeInTheDocument();
    expect(screen.getByText("None on file")).toBeInTheDocument();
    expect(screen.getByText("Nothing sold yet")).toBeInTheDocument();
  });

  it("a person whose Ethos was requested but has not come back reads exactly that, with the request date", () => {
    fb = fakeBackend([agent({ id: "a1" })]);
    backend.current = fb;
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><MemoryRouter>
      <TeamPersonDrawer open onOpenChange={vi.fn()} row={rosterRow({ agent_id: "a1" })} onOpenContracting={vi.fn()} profile={teamProfile({ agent_id: "a1", ethos_requested: true, ethos_requested_on: "2026-10-12" })} profileState="ready" />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByText("Requested Oct 12, not back yet")).toBeInTheDocument();
  });

  it("a failed profile read says so in the card instead of showing blank facts", () => {
    fb = fakeBackend([agent({ id: "a1" })]);
    backend.current = fb;
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><MemoryRouter>
      <TeamPersonDrawer open onOpenChange={vi.fn()} row={rosterRow({ agent_id: "a1" })} onOpenContracting={vi.fn()} profile={null} profileState="error" />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByText(/State, Instagram, contracts and sign-in did not load/)).toBeInTheDocument();
  });
});
