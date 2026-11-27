/**
 * My Team > Bring back (src/components/team/BringBackList.tsx, MP-TEAM-BRING-BACK 2026-11-27): the people off the
 * roster who hold a contract, in groups, with the let-go people behind a toggle, a state filter in the URL, and a
 * Back on the roster button that is the inverse of Hide from roster and reports only what the row says afterwards.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isAdmin: true, isManager: false, isVaManager: false, isVa: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-11-27" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  rpcError: null as string | null,
  agents: new Map<string, { is_inactive: boolean }>(),
  updates: [] as Array<{ id: unknown; values: Record<string, unknown> }>,
  settings: [] as Array<{ key: string; value: string }>,
}));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let values: Record<string, unknown> | null = null;
    let id: unknown = null;
    const chain = {
      select: () => chain,
      update: (v: Record<string, unknown>) => { values = v; return chain; },
      in: () => chain,
      eq: (_col: string, v: unknown) => {
        id = v;
        if (values && table === "agents") { db.updates.push({ id: v, values }); const row = db.agents.get(String(v)); if (row && "is_inactive" in values) row.is_inactive = Boolean(values.is_inactive); }
        return chain;
      },
      maybeSingle: () => Promise.resolve({ data: table === "agents" ? db.agents.get(String(id)) ?? null : null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: table === "system_settings" ? db.settings : [], error: null }).then(resolve, reject),
    };
    return chain;
  };
  const rpc = async (name: string) => {
    if (name !== "crm_bring_back_candidates") return { data: null, error: { message: `unexpected rpc ${name}` } };
    return db.rpcError ? { data: null, error: { message: db.rpcError } } : { data: db.rows, error: null };
  };
  return { supabase: { from, rpc } };
});

import { BringBackList } from "@/components/team/BringBackList";

const row = (o: Record<string, unknown>) => ({
  person_key: "p", source: "agent", agent_id: "p", full_name: "Pat Person", phone: "+16025550111", email: "pat@example.test", home_state: "WI",
  license: "licensed", standing: "hidden", fired: false, let_go_reason: null, can_restore: true, manager_name: "Mia Manager", ethos_back: false,
  ethos_source: null, ethos_since: null, ethos_issued: 0, ethos_inforce: 0, carriers: [], carriers_active: 0, deals: 0, lifetime_ap: 0, last_deal: null,
  last_sign_in_at: null, instagram: null, last_call_outcome: null, last_call_at: null, last_active_on: null, comp_level: null,
  ethos_requested: false, ethos_requested_on: null, ...o,
});
const ROWS = [
  row({ person_key: "e1", source: "ethos_person", agent_id: null, full_name: "Eve Ethos", standing: "no_account", can_restore: false, ethos_back: true, ethos_source: "ethos_hierarchy", ethos_issued: 17970.84, ethos_inforce: 15681.84, carriers: [{ carrier: "Ethos", status: "active", source: "ethos_hierarchy", as_of: "2026-11-19", active: true }], carriers_active: 1, home_state: null, comp_level: "L4" }),
  row({ person_key: "h1", agent_id: "h1", full_name: "Hal Hidden", standing: "hidden", deals: 11, lifetime_ap: 22000, last_deal: "2026-06-20", last_active_on: "2026-06-20", carriers: [{ carrier: "Aflac", status: "active", source: "agentlink", as_of: null, active: true }], carriers_active: 1 }),
  row({ person_key: "i1", agent_id: "i1", full_name: "Ina Inactive", standing: "inactive", home_state: "TX", last_active_on: "2026-01-13", deals: 2, lifetime_ap: 3000, last_deal: "2026-01-13" }),
  row({ person_key: "l1", agent_id: "l1", full_name: "Lou Letgo", standing: "let_go", fired: true, can_restore: false, let_go_reason: "no_show", ethos_back: true, ethos_source: "review_mark", carriers_active: 1 }),
];

const onRestored = vi.fn();
function mount(path = "/dashboard/team?view=bring-back") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><BringBackList onRestored={onRestored} /></MemoryRouter></QueryClientProvider>);
}
const names = (groupLabel: string) => within(screen.getByRole("list", { name: groupLabel })).getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent?.split(/Hidden from roster|No account here|Marked inactive|Let go/)[0]?.trim());

beforeEach(() => {
  Object.assign(auth, { isAdmin: true, isManager: false });
  db.rows = ROWS.map((r) => ({ ...r }));
  db.rpcError = null;
  db.agents = new Map([["h1", { is_inactive: true }], ["i1", { is_inactive: true }]]);
  db.updates = [];
  db.settings = [{ key: "discord_invite_url", value: "https://discord.gg/x" }];
  onRestored.mockClear();
  Object.values(toast).forEach((f) => f.mockClear());
});

describe("Bring back", () => {
  it("lists the people off the roster in groups with their contracts, and keeps the people Sam let go off until asked", async () => {
    mount();
    expect(await screen.findByText("Eve Ethos")).toBeInTheDocument();
    expect(names("Hold your Ethos contract, no account here")).toEqual(["Eve Ethos"]);
    expect(names("Hidden from the roster")).toEqual(["Hal Hidden"]);
    expect(names("Marked inactive")).toEqual(["Ina Inactive"]);
    expect(screen.queryByText("Lou Letgo")).toBeNull();
    expect(screen.getByText(/3 people/)).toBeInTheDocument();
    expect(screen.getByText("Ethos back, $18.0K issued, $15.7K in force")).toBeInTheDocument();
    expect(screen.getByText("Contracts: Aflac")).toBeInTheDocument();
    expect(screen.getByText("Sold $22.0K here, last deal 160 days ago")).toBeInTheDocument();
    expect(screen.getByText(/Comp L4/)).toBeInTheDocument();
    // The let-go toggle names its count and brings them in with their reason.
    fireEvent.click(screen.getByRole("button", { name: /Show people I let go/ }));
    expect(await screen.findByText("Lou Letgo")).toBeInTheDocument();
    expect(screen.getByText(/Let go \(no show\)/)).toBeInTheDocument();
    expect(screen.getByText(/4 people/)).toBeInTheDocument();
  });

  it("the state filter lives in the URL and 'No state on file' is its own choice", async () => {
    mount("/dashboard/team?view=bring-back&state=TX");
    expect(await screen.findByText("Ina Inactive")).toBeInTheDocument();
    expect(screen.queryByText("Hal Hidden")).toBeNull();
    expect(screen.getByTestId("bring-back-caption")).toHaveTextContent(/1 person in Texas/);
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(await screen.findByText("Hal Hidden")).toBeInTheDocument();
    expect(screen.getByTestId("bring-back-caption")).toHaveTextContent(/^3 people/);
  });

  it("Back on the roster clears is_inactive for that person only and reports what the row says afterwards", async () => {
    mount();
    await screen.findByText("Hal Hidden");
    expect(screen.queryByRole("button", { name: "Put Eve Ethos back on the roster" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Put Hal Hidden back on the roster" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Hal Hidden is back on the roster."));
    expect(db.updates).toEqual([{ id: "h1", values: { is_inactive: false } }]);
    expect(onRestored).toHaveBeenCalledTimes(1);
    // A person marked inactive goes back under Not active, and the toast says so.
    fireEvent.click(screen.getByRole("button", { name: "Put Ina Inactive back on the roster" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ina Inactive is back on the roster, under Not active until their status is set."));
  });

  it("a change that does not land is reported as not landed, never as back", async () => {
    db.agents.set("h1", { is_inactive: true });
    mount();
    await screen.findByText("Hal Hidden");
    // The read-back still says hidden: the mock's update only flips rows it knows, so remove it first.
    db.agents.delete("h1");
    fireEvent.click(screen.getByRole("button", { name: "Put Hal Hidden back on the roster" }));
    await waitFor(() => expect(toast.message).toHaveBeenCalledWith(expect.stringMatching(/could not be read back/)));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a failed read says the list did not load and shows nobody in its place; a viewer who cannot manage gets no restore button", async () => {
    db.rpcError = "timeout";
    mount();
    expect(await screen.findByText("The bring-back list did not load")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("a viewer who cannot manage sees the people but no Back on the roster or Invite", async () => {
    Object.assign(auth, { isAdmin: false, isManager: false });
    mount();
    expect(await screen.findByText("Hal Hidden")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /back on the roster/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Invite/ })).toBeNull();
  });
});
