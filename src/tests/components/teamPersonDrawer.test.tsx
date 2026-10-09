import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeQuery, ms, person, rosterRow, status } from "../helpers/teamContractingFixtures";

const auth = { isAdmin: true, isManager: false, isVaManager: false, isVa: false };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const db = vi.hoisted(() => ({ events: { data: [] as unknown[], error: null as { message: string } | null }, agents: { data: [] as unknown[] } }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "in"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(table === "agent_contract_checkoff_events" ? db.events : { data: db.agents.data, error: null }).then(res, rej);
    return q;
  };
  return { supabase: { from: (t: string) => chain(t), rpc: () => Promise.resolve({ data: [], error: null }) } };
});

import { TeamPersonDrawer } from "@/components/team/TeamPersonDrawer";

const toggle = vi.fn();
const checkoff = { toggle, isPending: () => false } as never;
function open(over: Record<string, unknown> = {}) {
  const p = person();
  const props = {
    open: true, onOpenChange: vi.fn(), person: p, row: rosterRow(), canTick: true, scrollTo: null, checkoff,
    tc: fakeQuery({ data: status([p]), byAgent: new Map([[p.agent_id, p]]) }), ...over,
  };
  const utils = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><TeamPersonDrawer {...(props as unknown as React.ComponentProps<typeof TeamPersonDrawer>)} /></MemoryRouter></QueryClientProvider>);
  return { ...utils, props };
}
beforeEach(() => { vi.clearAllMocks(); db.events = { data: [], error: null }; db.agents = { data: [] }; });

describe("person drawer", () => {
  it("is the one home for the checklist, follow-up plan, history and production, in a single dialog", () => {
    open();
    expect(screen.getAllByRole("dialog")).toHaveLength(1); // the follow-up form is inline, never a second modal on top
    for (const name of ["Contracting", "Contact and follow-up", "Follow-up plan", "Recent changes", "Onboarding", "Production"]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
  });

  it("ticks a milestone through the audited toggle with what the screen believes the current state is", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /^Ethos for Ann Lee: not due yet/ }));
    expect(toggle).toHaveBeenCalledWith("a1", "ethos", false, "Ann Lee");
    fireEvent.click(screen.getByRole("button", { name: /^AgentLink for Ann Lee: done/ }));
    expect(toggle).toHaveBeenCalledWith("a1", "agentlink", true, "Ann Lee"); // reopening a done milestone
  });

  it("shows a read-only checklist to a role that may not tick", () => {
    open({ canTick: false });
    expect(screen.queryByRole("button", { name: /^Ethos for Ann Lee/ })).toBeNull();
    expect(screen.getByText(/you can see this checklist but not change it/i)).toBeInTheDocument();
  });

  it("states that check-offs are manual, not carrier-verified", () => {
    open();
    expect(screen.getByText(/checked by hand by Test Staffer/i)).toBeInTheDocument();
    expect(screen.queryByText(/carrier.verified|verified by/i)).toBeNull();
  });

  it("a failed contracting read says so with Retry instead of an empty checklist", () => {
    const refetch = vi.fn(() => Promise.resolve(undefined));
    open({ person: undefined, tc: fakeQuery({ isError: true, refetch }) });
    const section = screen.getByRole("region", { name: "Contracting" });
    expect(within(section).getByRole("alert")).toHaveTextContent(/contracting status unavailable/i);
    fireEvent.click(within(section).getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says contracting does not apply, without inventing a checklist, for someone not licensed", () => {
    const row = rosterRow({ license_status: "unlicensed" });
    open({ person: undefined, row, tc: fakeQuery({ data: status([]) }) });
    expect(screen.getByText(/does not apply to this person yet \(not licensed\)/i)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Follow-up plan" })).toBeNull();
  });

  it("never offers a dead Call button when there is no phone number", () => {
    open({ row: rosterRow({ phone: null }) });
    expect(screen.queryByRole("link", { name: /^call$/i })).toBeNull();
    expect(screen.getByText(/no phone on file/i)).toBeInTheDocument();
  });

  it("tapping Call does not record a contact, it only offers to; the outcome is recorded separately", () => {
    open();
    fireEvent.click(screen.getByRole("link", { name: /^call$/i }));
    expect(screen.getByText(/calling does not record a contact/i)).toBeInTheDocument();
  });
});

describe("person drawer: change history", () => {
  it("lists who changed which milestone, when, from the audit table", async () => {
    db.events = { data: [{ id: 1, contract_key: "aflac", action: "checked", acted_by: "u1", acted_at: "2026-10-08T15:00:00Z" }, { id: 2, contract_key: "ethos", action: "unchecked", acted_by: null, acted_at: "2026-10-08T14:00:00Z" }], error: null };
    db.agents = { data: [{ user_id: "u1", display_name: "Test Staffer" }] };
    open();
    await waitFor(() => expect(screen.getByText(/checked off by Test Staffer/)).toBeInTheDocument());
    expect(screen.getByText(/reopened/)).toBeInTheDocument();
  });

  it("says plainly when nothing has been recorded", async () => {
    open();
    expect(await screen.findByText(/no changes recorded yet/i)).toBeInTheDocument();
  });

  it("a failed history read is reported with Retry and never shown as 'no changes'", async () => {
    db.events = { data: [], error: { message: "denied" } };
    open();
    expect(await screen.findByText(/change history unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/no changes recorded yet/i)).toBeNull();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
