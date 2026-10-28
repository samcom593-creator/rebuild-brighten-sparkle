/**
 * Invitations list (council findings 28, 34, 39): cards under lg and a table from lg up, both
 * with one labelled "More" menu per row and no icon-only controls; Revoke is two-step; the
 * server's "superseded" reads as "Replaced"; an agency key this client does not know prints as
 * its own words, never "Unknown"; contracting values open in a dialog in full with 44px Copy
 * buttons; Copy link records a share and never sends anything.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<{ fn: string; args?: Record<string, unknown> }>);
const db = vi.hoisted(() => ({
  rows: [] as unknown[],
  counts: { total: 0, pending: 0, accepted: 0, expired: 0, revoked: 0, superseded: 0 },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "list_invitations") return Promise.resolve({ data: { counts: db.counts, rows: db.rows, limit: 500 }, error: null });
      if (fn === "invitation_link") return Promise.resolve({ data: { ok: true, path: "/hire/tok-1" }, error: null });
      if (fn === "record_invitation_share") return Promise.resolve({ data: { ok: true, status: "pending" }, error: null });
      if (fn === "revoke_invitation") return Promise.resolve({ data: { ok: true }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import { ConfirmProvider } from "@/hooks/useConfirm";
import { InvitationsTable } from "@/components/invitations/InvitationsTable";
import type { InvitationRow } from "@/components/invitations/invitationApi";

function row(over: Partial<InvitationRow> & { id: string; status: InvitationRow["status"] }): InvitationRow {
  return {
    kind: "hire", notes: null, recipient_name: null, recipient_email: null, target_role: "hired_licensed",
    target_manager_id: "u1", upline_name: "Samuel James", agency_key: "apex", offered_comp_pct: 80,
    carrier_exceptions: [], created_at: "2026-10-20T15:00:00Z", created_by_name: "Samuel James",
    expires_at: "2026-11-04T15:00:00Z", used_at: null, accepted_agent_name: null, revoked_at: null,
    superseded_at: null, share_count: 0, last_shared_at: null,
    ...over,
  };
}

const pending = row({
  id: "inv-1", status: "pending", recipient_name: "Mary Ann Smith", recipient_email: "mary@example.test",
  notes: "Contracting: First=Mary Ann; Last=Smith; Phone=2569756155; NPN=12345678", share_count: 2,
});
const accepted = row({ id: "inv-2", status: "accepted", recipient_name: "Pat Lee", recipient_email: "pat@example.test", used_at: "2026-10-22T15:00:00Z", accepted_agent_name: "Pat Lee" });
const replaced = row({ id: "inv-3", status: "superseded", recipient_name: "Jo Carter", superseded_at: "2026-10-23T15:00:00Z" });
const revoked = row({ id: "inv-4", status: "revoked", recipient_name: "Al Diaz", revoked_at: "2026-10-24T15:00:00Z" });

function renderTable() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <InvitationsTable />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

const card = (id: string) => within(screen.getByTestId(`invite-card-${id}`));
const tableRow = (id: string) => within(screen.getByTestId(`invite-row-${id}`));
const openMenu = (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: "Enter" });
const menuItems = async () => within(await screen.findByRole("menu")).getAllByRole("menuitem").map((m) => m.textContent?.trim());
const closeMenu = async () => {
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
};
const revokeCalls = () => calls.filter((c) => c.fn === "revoke_invitation");

beforeEach(() => {
  calls.length = 0;
  db.rows = [pending, accepted, replaced, revoked];
  db.counts = { total: 4, pending: 1, accepted: 1, expired: 0, revoked: 1, superseded: 1 };
  // Radix positions menus with ResizeObserver, which jsdom does not ship.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});

describe("InvitationsTable", () => {
  it("shows every invitation as a card under lg and a table row from lg, with the status in words and the agency in its own words", async () => {
    renderTable();
    await screen.findByTestId("invite-card-inv-1");

    expect(screen.getByTestId("invite-cards").className).toMatch(/\blg:hidden\b/);
    expect(screen.getByTestId("invite-table").className).toMatch(/\bhidden\b/);
    expect(screen.getByTestId("invite-table").className).toMatch(/\blg:block\b/);

    expect(card("inv-1").getByText("Mary Ann Smith")).toBeInTheDocument();
    expect(card("inv-1").getByText("mary@example.test")).toBeInTheDocument();
    expect(card("inv-1").getByText("Pending")).toBeInTheDocument();
    expect(card("inv-1").getByText("Agent · licensed · under Samuel James (Apex) · 80% comp")).toBeInTheDocument();
    expect(card("inv-1").getByText("Expires Nov 4, 2026")).toBeInTheDocument();
    expect(card("inv-1").getByText("Created Oct 20, 2026 by Samuel James")).toBeInTheDocument();
    expect(card("inv-1").getByText("Shared 2 times")).toBeInTheDocument();
    expect(card("inv-2").queryByText(/^Shared/)).toBeNull();

    // The server says "superseded"; the person reads "Replaced", in the pill and in the date line.
    expect(card("inv-3").getByText("Replaced")).toBeInTheDocument();
    expect(card("inv-3").getByText("Replaced Oct 23, 2026")).toBeInTheDocument();
    expect(tableRow("inv-3").getByText("Replaced")).toBeInTheDocument();
    expect(screen.queryByText(/superseded/i)).toBeNull();

    // "apex" is not one of the two keys the client knows; it still prints as a name, never "Unknown".
    expect(tableRow("inv-1").getByText("Apex")).toBeInTheDocument();
    expect(screen.queryByText("Unknown")).toBeNull();

    // No control under 44px and no icon-only button: every button says what it does.
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toMatch(/\bh-11\b/);
      expect(button.textContent?.trim()).not.toBe("");
    }
  });

  it("puts every action in one labelled More menu per row; a closed invitation keeps only Contracting info", async () => {
    renderTable();
    await screen.findByTestId("invite-card-inv-1");

    openMenu(card("inv-1").getByRole("button", { name: "More actions for Mary Ann Smith" }));
    expect(await menuItems()).toEqual(["Contracting info", "Copy link", "Email draft", "Replace link", "Revoke link"]);
    await closeMenu();

    openMenu(card("inv-2").getByRole("button", { name: "More actions for Pat Lee" }));
    expect(await menuItems()).toEqual(["Contracting info"]);
    await closeMenu();

    openMenu(card("inv-4").getByRole("button", { name: "More actions for Al Diaz" }));
    expect(await menuItems()).toEqual(["Contracting info", "Replace link"]);
    await closeMenu();

    // The table carries the same menu for the same row.
    openMenu(tableRow("inv-1").getByRole("button", { name: "More actions for Mary Ann Smith" }));
    expect(await menuItems()).toEqual(["Contracting info", "Copy link", "Email draft", "Replace link", "Revoke link"]);
  });

  it("revokes in two steps: Cancel writes nothing, Revoke link writes once", async () => {
    renderTable();
    await screen.findByTestId("invite-card-inv-1");

    openMenu(card("inv-1").getByRole("button", { name: "More actions for Mary Ann Smith" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Revoke link" }));
    const first = await screen.findByRole("alertdialog");
    expect(within(first).getByText("Revoke this link?")).toBeInTheDocument();
    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(revokeCalls()).toHaveLength(0);

    openMenu(card("inv-1").getByRole("button", { name: "More actions for Mary Ann Smith" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Revoke link" }));
    const second = await screen.findByRole("alertdialog");
    fireEvent.click(within(second).getByRole("button", { name: "Revoke link" }));
    await waitFor(() => expect(revokeCalls()).toHaveLength(1));
    expect(revokeCalls()[0].args).toEqual({ p_id: "inv-1" });
  });

  it("Copy link fetches the link, copies it and records a share — it sends nothing", async () => {
    renderTable();
    await screen.findByTestId("invite-card-inv-1");

    openMenu(card("inv-1").getByRole("button", { name: "More actions for Mary Ann Smith" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(calls.some((c) => c.fn === "record_invitation_share")).toBe(true));
    expect(calls.find((c) => c.fn === "invitation_link")?.args).toEqual({ p_id: "inv-1" });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/hire/tok-1`);
    expect(calls.find((c) => c.fn === "record_invitation_share")?.args).toEqual({ p_id: "inv-1", p_channel: "copy" });
    expect(calls.map((c) => c.fn)).not.toContain("send_invitation");
  });

  it("opens the contracting info in a dialog with each value in full and a 44px Copy per value", async () => {
    renderTable();
    await screen.findByTestId("invite-card-inv-1");

    openMenu(card("inv-1").getByRole("button", { name: "More actions for Mary Ann Smith" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Contracting info" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Contracting info")).toBeInTheDocument();
    expect(within(dialog).getByText("(256) 975-6155")).toBeInTheDocument();
    expect(within(dialog).getByText("12345678")).toBeInTheDocument();
    expect(within(dialog).getByText("mary@example.test")).toBeInTheDocument();
    for (const label of ["Copy first name", "Copy last name", "Copy email", "Copy phone", "Copy NPN"]) {
      expect(within(dialog).getByRole("button", { name: label }).className).toMatch(/\bh-11\b/);
    }
  });

  it("the History view counts every state in the same words", async () => {
    renderTable();
    await screen.findByTestId("invite-card-inv-1");
    const historyTab = screen.getByRole("tab", { name: /^History/ });
    expect(historyTab.className).toMatch(/\bh-11\b/);
    fireEvent.click(historyTab);
    const counts = await screen.findByTestId("invitation-counts");
    expect(counts.textContent).toBe("1 pending · 1 accepted · 0 expired · 1 revoked · 1 replaced");
  });
});
