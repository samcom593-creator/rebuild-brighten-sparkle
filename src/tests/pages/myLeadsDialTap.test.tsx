/**
 * My Leads dial taps (MP-ONBOARD-ANCHOR-PKG2, 2026-11-12).
 *
 * The dialer was canceled for non-payment on 2026-11-10; agents dial from the call links in My Leads. Clicking a
 * call link must record one dial tap for that lead (my_lead_dial_tap) and must not stop the link: the anchor keeps
 * its href, so the browser still opens tel: / Google Voice.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpcArgs: [] as Array<{ fn: string; args: unknown }> }));

vi.mock("@/components/callcenter/CallCenterVoiceRecorder", () => ({ CallCenterVoiceRecorder: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => {
      db.rpcArgs.push({ fn, args });
      if (fn === "my_lead_bundles") {
        return Promise.resolve({
          data: [{
            item_id: "item-1", bundle_id: "b-1", bundle_name: "Starter pack · Nevin · Nov 12", bundle_note: null,
            format: "client_leads", phone10: "6025550142", first_name: "Pat", last_name: "Lee", email: null,
            state: "AZ", age: 61, quality_tier: "A", quality_reason: null, attrs: { pool: "marketing" },
            attempts: null, last_dialed_at: null, last_disposition: null, status: "new", status_note: null,
            status_at: null, granted_at: "2026-11-12T16:15:00Z", callable_now: true, callable_at: null,
          }],
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true, recorded: true }, error: null });
    },
  },
}));

import MyLeads from "@/pages/MyLeads";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MyLeads />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("My Leads call link", () => {
  beforeEach(() => {
    db.rpcArgs.length = 0;
  });

  it("records a dial tap for that lead and keeps the link's href", async () => {
    renderPage();
    const link = await screen.findByTestId("lead-call-link");
    expect(link.getAttribute("href")).toBeTruthy();
    fireEvent.click(link);
    await waitFor(() =>
      expect(db.rpcArgs).toContainEqual({ fn: "my_lead_dial_tap", args: { p_item_id: "item-1" } }),
    );
    expect(db.rpcArgs.filter((c) => c.fn === "my_lead_dial_tap")).toHaveLength(1);
  });

  it("work mode's Call button records the tap too", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Work leads/ }));
    const call = await screen.findByTestId("work-mode-call-link");
    fireEvent.click(call);
    await waitFor(() =>
      expect(db.rpcArgs).toContainEqual({ fn: "my_lead_dial_tap", args: { p_item_id: "item-1" } }),
    );
  });
});
