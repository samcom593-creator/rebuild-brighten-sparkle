/** DialerSeatsPanel (MP-SEATS-1, 2026-11-19): who holds a dialer seat, whether they dial, and what the automation did. */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ auth: { isAdmin: true }, calls: [] as string[], reply: { data: null as unknown, error: null as unknown } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => env.auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (fn: string) => { env.calls.push(fn); return Promise.resolve(env.reply); } } }));

import { DialerSeatsPanel, holderState, type DialerSeats, type SeatHolder } from "@/components/dashboard/DialerSeatsPanel";

const holder = (name: string, over: Partial<SeatHolder> = {}): SeatHolder => ({
  uid: `u-${name}`, account: name, name, licence: "Agent", signed_in: "an hour ago", last_active: "1 seconds ago", inactive: false,
  agent_name: null, calls_today: 0, last_call_at: null, ...over,
});
const seats = (over: Partial<DialerSeats> = {}): DialerSeats => ({
  generated_at: new Date().toISOString(), snapshot_at: new Date().toISOString(),
  seats: { agent_total: 4, agent_assigned: 4, agent_remaining: 0, admin_total: 2, admin_assigned: 1, admin_remaining: 1 },
  holders: [
    holder("claude", { licence: "Admin" }),
    holder("Manager"),
    holder("Obi", { agent_name: "Obiajulu I", calls_today: 108, last_call_at: new Date(Date.now() - 120_000).toISOString() }),
    holder("nate", { calls_today: 36, last_call_at: new Date(Date.now() - 300_000).toISOString() }),
    holder("chudi", { agent_name: "Chudi I" }),
  ],
  week: { snapshots: 40, full_snapshots: 30 }, signed_out_7d: 3, locked_7d: 10,
  actions: [{ at: new Date().toISOString(), action: "lock_banned_account", name: "KJ", reason: "terminated, login banned", ok: true }],
  dormant_logins: [{ uid: 97, name: "jontay", agent_name: "Jontay T", last_call_at: "2026-10-12T00:00:00Z" }],
  unlinked_dialers: [{ dialer_name: "nate", calls_30d: 1142, last_call_at: new Date().toISOString() }],
  automation: { autosignout: true, autolock: true }, ...over,
});
function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DialerSeatsPanel viewerId="admin-viewer" /></QueryClientProvider>);
}

describe("DialerSeatsPanel", () => {
  beforeEach(() => { env.auth.isAdmin = true; env.calls.length = 0; env.reply = { data: seats(), error: null }; });

  it("renders nothing and never asks the database for a non-admin", () => {
    env.auth.isAdmin = false;
    const { container } = renderPanel();
    expect(container.firstChild).toBeNull();
    expect(env.calls).toEqual([]);
  });

  it("states seats in use, how often they are full, and names who is holding a seat without dialing when none are free", async () => {
    renderPanel();
    const head = await screen.findByTestId("seats-headline");
    expect(head.textContent).toContain("4 of 4");
    expect(head.textContent).toContain("0 free");
    expect(head.textContent).toContain("full in 75% of checks");
    const idle = screen.getByTestId("seats-idle");
    expect(idle.textContent).toContain("Manager, chudi have made no calls today");
    expect(idle.textContent).toContain("admin licence is free");
    expect(env.calls).toEqual(["admin_dialer_seats"]);
  });

  it("does not call anyone out while a seat is still free", async () => {
    env.reply = { data: seats({ seats: { agent_total: 4, agent_assigned: 3, agent_remaining: 1, admin_total: 2, admin_assigned: 1, admin_remaining: 1 } }), error: null };
    renderPanel();
    await screen.findByTestId("seats-headline");
    expect(screen.queryByTestId("seats-idle")).toBeNull();
  });

  it("shows what the automation did, the logins nobody dials from, and dialers not linked to an agent", async () => {
    renderPanel();
    expect((await screen.findByTestId("seats-automation")).textContent).toContain("3 dead sessions signed out, 10 logins locked");
    expect(screen.getByText(/login locked/)).toBeTruthy();
    expect(screen.getByTestId("seats-dormant").textContent).toContain("Jontay T");
    expect(screen.getByTestId("seats-unlinked").textContent).toContain("nate (1142 calls in 30 days)");
  });

  it("says OFF in capitals when a switch is off", async () => {
    env.reply = { data: seats({ automation: { autosignout: false, autolock: true } }), error: null };
    renderPanel();
    expect((await screen.findByTestId("seats-automation")).textContent).toContain("Sign-out is OFF, lock-out is on");
  });

  it("warns that the picture is old when the last check is over 30 minutes ago", async () => {
    env.reply = { data: seats({ snapshot_at: new Date(Date.now() - 2 * 3_600_000).toISOString() }), error: null };
    renderPanel();
    expect((await screen.findByTestId("seats-stale")).textContent).toContain("puller on the Studio has stopped");
  });

  it("says no check is recorded yet instead of drawing empty seats", async () => {
    env.reply = { data: seats({ seats: null, snapshot_at: null, holders: [] }), error: null };
    renderPanel();
    expect(await screen.findByTestId("seats-none")).toBeTruthy();
    expect(screen.queryByTestId("seats-headline")).toBeNull();
  });

  it("shows the failure with a retry when the read fails", async () => {
    env.reply = { data: null, error: { code: "42501", message: "admin only" } };
    renderPanel();
    await waitFor(() => expect(screen.getByText(/do not have permission/i)).toBeTruthy());
  });
});

describe("holderState", () => {
  it("grades a seat holder by what they are doing", () => {
    expect(holderState(holder("a", { licence: "Admin" })).label).toBe("Admin licence");
    expect(holderState(holder("a", { inactive: true, calls_today: 9 })).label).toBe("Window closed");
    expect(holderState(holder("a")).label).toBe("Holding a seat, no calls today");
    expect(holderState(holder("a", { calls_today: 1 })).label).toBe("1 call today");
    expect(holderState(holder("a", { calls_today: 40 })).label).toBe("40 calls today");
  });
});
