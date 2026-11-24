/**
 * My Leads: recordings and the pipeline (MP-LEAD-MANAGER-RM, 2026-11-24).
 *
 * Before this, a recording was only attached to its lead by the NEXT result tap. Measured that day: 4,641 leads had
 * been handed out and exactly one recording had ever been kept. A recording is now saved the moment its upload
 * finishes, the AI summary is added to the same row when it arrives, and a lead goes into the agent's own client
 * pipeline with one tap.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  leads: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));

// The recorder stands in as two buttons: "upload done" and "summary done", in whichever order a test taps them.
vi.mock("@/components/callcenter/CallCenterVoiceRecorder", () => ({
  CallCenterVoiceRecorder: (p: { onAudioSaved?: (path: string) => void; onSummaryComplete?: (s: unknown) => void }) => (
    <div>
      <button type="button" onClick={() => p.onAudioSaved?.("callcenter/2026-11-24/rec-1.webm")}>fake upload done</button>
      <button type="button" onClick={() => p.onSummaryComplete?.({ briefSummary: "Wants a call back Friday" })}>fake summary done</button>
    </div>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      db.calls.push({ fn, args: args ?? {} });
      if (fn === "my_lead_bundles") return Promise.resolve({ data: db.leads.map((l) => ({ ...l })), error: null });
      if (fn === "my_lead_source_history") return Promise.resolve({ data: [{ observation_id: "observation-1", policy_number: "TEST-ONLY-1", carrier: "Synthetic Carrier", ownership_claim: "supplier_reported", supplier_amount: 100, amount_cadence: "unknown" }, { observation_id: "observation-2", policy_number: "TEST-ONLY-2", carrier: "Synthetic Carrier", ownership_claim: "supplier_reported" }], error: null });
      if (fn === "my_lead_to_pipeline") return Promise.resolve({ data: { client_id: "c-1", created: true }, error: null });
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  },
}));

import MyLeads from "@/pages/MyLeads";

const lead = (n: number, over: Record<string, unknown> = {}) => ({
  item_id: `item-${n}`, bundle_id: "b-1", bundle_name: "Starter pack", bundle_note: null, format: "client_leads",
  phone10: `60255501${String(n).padStart(2, "0")}`, first_name: `Lead${n}`, last_name: "Test", email: null, state: "AZ",
  age: 60, quality_tier: "F", quality_reason: "Fresh", attrs: { pool: "dialer" }, attempts: null, last_dialed_at: null,
  last_disposition: null, status: "new", status_note: null, status_at: null, granted_at: "2026-11-12T16:15:00Z",
  callable_now: true, callable_at: null, ...over,
});
function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><MyLeads /></MemoryRouter></QueryClientProvider>);
}
const saved = () => db.calls.filter((c) => c.fn === "lead_item_add_recording");

describe("My Leads recordings and pipeline", () => {
  beforeEach(() => { db.calls.length = 0; db.leads = [lead(1), lead(2)]; });

  it("saves a recording to its lead the moment the upload finishes, with no result tapped", async () => {
    renderPage();
    await screen.findAllByTestId("lead-row");
    fireEvent.click(screen.getByRole("button", { name: /Record the call/ }));
    fireEvent.click(screen.getByText("fake upload done"));
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0].args).toMatchObject({ p_item: "item-1", p_path: "callcenter/2026-11-24/rec-1.webm", p_summary: null });
    expect(db.calls.some((c) => c.fn === "lead_bundle_item_log")).toBe(false);
  });

  it("adds the summary to the same recording when it arrives after the upload", async () => {
    renderPage();
    await screen.findAllByTestId("lead-row");
    fireEvent.click(screen.getByRole("button", { name: /Record the call/ }));
    fireEvent.click(screen.getByText("fake upload done"));
    fireEvent.click(screen.getByText("fake summary done"));
    await waitFor(() => expect(saved()).toHaveLength(2));
    expect(saved()[1].args).toMatchObject({ p_item: "item-1", p_path: "callcenter/2026-11-24/rec-1.webm", p_summary: { briefSummary: "Wants a call back Friday" } });
  });

  it("keeps a summary that lands before the upload, and saves both together", async () => {
    renderPage();
    await screen.findAllByTestId("lead-row");
    fireEvent.click(screen.getByRole("button", { name: /Record the call/ }));
    fireEvent.click(screen.getByText("fake summary done"));
    expect(saved()).toHaveLength(0); // nothing to attach a summary to yet
    fireEvent.click(screen.getByText("fake upload done"));
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0].args.p_summary).toEqual({ briefSummary: "Wants a call back Friday" });
  });

  it("puts a lead into the agent's pipeline with one tap and will not offer it twice", async () => {
    renderPage();
    await screen.findAllByTestId("lead-row");
    const btn = screen.getByTestId("lead-to-pipeline");
    expect(btn.textContent).toContain("Add to my pipeline");
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId("lead-to-pipeline").textContent).toContain("In your pipeline"));
    expect(db.calls.filter((c) => c.fn === "my_lead_to_pipeline")).toEqual([{ fn: "my_lead_to_pipeline", args: { p_item: "item-1" } }]);
    expect((screen.getByTestId("lead-to-pipeline") as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers no pipeline button on a do-not-call lead", async () => {
    db.leads = [lead(1, { status: "do_not_call" })];
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^All/ }));
    await screen.findAllByTestId("lead-row");
    expect(screen.queryByTestId("lead-to-pipeline")).toBeNull();
  });

  it("shows a later suppression reason and blocks calling and pipeline creation even while status remains new", async () => {
    db.leads = [lead(1, { attrs: { pool: "marketing", true_dnc: true, blocked: true }, callable_now: true })];
    renderPage();
    expect(await screen.findByTestId("lead-holds")).toBeTruthy();
    expect(screen.queryByTestId("calling-hours-closed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Held/ }));
    await screen.findAllByTestId("lead-row");
    expect(screen.queryByTestId("lead-call-link")).toBeNull();
    expect(screen.queryByTestId("lead-to-pipeline")).toBeNull();
    expect(screen.getByText(/555.*Do not call/)).toBeTruthy();
  });

  it("shows multiple supplier observations and saves a next action without fabricating policy verification", async () => {
    renderPage();
    await screen.findAllByTestId("lead-row");
    fireEvent.click(screen.getByRole("button", { name: /Full info/ }));
    expect(await screen.findByText("TEST-ONLY-1")).toBeTruthy();
    expect(await screen.findByText("TEST-ONLY-2")).toBeTruthy();
    expect(screen.getByText(/Source dates and status do not verify an active policy/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Next action"), { target: { value: "Confirm the source policy details" } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    await waitFor(() => expect(db.calls.find((c) => c.fn === "lead_bundle_followup_set")?.args).toEqual({ p_item: "item-1", p_callback_at: null, p_next_action: "Confirm the source policy details" }));
  });

});
