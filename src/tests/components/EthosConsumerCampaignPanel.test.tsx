import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
import { EthosConsumerCampaignPanel } from "@/components/leads/EthosConsumerCampaignPanel";

const preview = {
  ok: true, counts: { eligible: 1 }, already_queued: 0,
  eligible: [{ lead_id: "lead-1", email: "pat@example.com", first_name: "Pat", state: "WI", audience_token: "review-token" }],
  campaign: { sends_enabled: false, approved_at: null }, message: { subject: "Coverage", text: "A coverage invitation" },
};
beforeEach(() => { invoke.mockReset(); });
describe("consumer campaign review", () => {
  it("uses the selected import batch, queues only selected preview IDs, and keeps disabled sends unavailable", async () => {
    invoke.mockResolvedValueOnce({ data: preview, error: null }).mockResolvedValueOnce({ data: { ok: true, queued: 1, already_present: 0, delivery_ids: ["delivery-1"] }, error: null });
    render(<EthosConsumerCampaignPanel sourceBatchId="batch-1" />);
    expect(screen.queryByLabelText("Consumer import batch")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview eligible consumers" }));
    await screen.findByText("pat@example.com");
    fireEvent.click(screen.getByLabelText("Select pat@example.com"));
    fireEvent.click(screen.getByRole("button", { name: "Queue 1 selected" }));
    await screen.findByText(/1 queued, 0 already recorded/);
    expect(invoke).toHaveBeenLastCalledWith("ethos-consumer-campaign", { body: expect.objectContaining({ source_batch_id: "batch-1", action: "queue", selections: [{ lead_id: "lead-1", audience_token: "review-token" }] }) });
    expect(screen.queryByRole("button", { name: /Send .*reviewed invitations/ })).not.toBeInTheDocument();
  });
  it("changing batches discards the old preview and selection", async () => {
    invoke.mockResolvedValue({ data: preview, error: null });
    const view=render(<EthosConsumerCampaignPanel sourceBatchId="batch-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview eligible consumers" })); await screen.findByText("pat@example.com");
    view.rerender(<EthosConsumerCampaignPanel sourceBatchId="batch-2" />);
    expect(screen.queryByText("pat@example.com")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview eligible consumers" }));
    await waitFor(()=>expect(invoke).toHaveBeenLastCalledWith("ethos-consumer-campaign", { body: expect.objectContaining({ source_batch_id: "batch-2" }) }));
  });
  it("a late response from the old batch cannot restore a stale audience", async () => {
    let resolve!: (value: unknown) => void;
    invoke.mockReturnValue(new Promise((r)=>{resolve=r;}));
    const view=render(<EthosConsumerCampaignPanel sourceBatchId="batch-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview eligible consumers" }));
    view.rerender(<EthosConsumerCampaignPanel sourceBatchId="batch-2" />);
    await act(async()=>resolve({ data: preview, error: null }));
    expect(screen.queryByText("pat@example.com")).not.toBeInTheDocument();
  });

  it("requires a new review after the selected recipients change", async () => {
    const enabled = { ...preview, campaign: { sends_enabled: true, approved_at: "2026-11-24T00:00:00Z" }, eligible: [...preview.eligible, { lead_id: "lead-2", email: "alex@example.com", first_name: "Alex", state: "WI", audience_token: "second-token" }] };
    invoke.mockResolvedValueOnce({ data: enabled, error: null })
      .mockResolvedValueOnce({ data: { ok: true, queued: 1, already_present: 0, delivery_ids: ["delivery-1"] }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, queued: 1, already_present: 0, delivery_ids: ["delivery-2"] }, error: null });
    render(<EthosConsumerCampaignPanel sourceBatchId="batch-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview eligible consumers" }));
    await screen.findByText("pat@example.com");
    fireEvent.click(screen.getByLabelText("Select pat@example.com"));
    const reviewed = screen.getByLabelText("I reviewed this message and the selected eligible consumers.");
    fireEvent.click(reviewed);
    fireEvent.click(screen.getByRole("button", { name: "Queue 1 selected" }));
    await screen.findByText(/1 queued, 0 already recorded/);
    expect(screen.getByRole("button", { name: "Send 1 reviewed invitations" })).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Select pat@example.com"));
    fireEvent.click(screen.getByLabelText("Select alex@example.com"));
    expect(reviewed).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Queue 1 selected" }));
    await screen.findByText(/1 queued, 0 already recorded/);
    expect(screen.getByRole("button", { name: "Send 1 reviewed invitations" })).toBeDisabled();
    expect(invoke.mock.calls.every(([, { body }]) => body.action !== "dispatch")).toBe(true);
  });

  it("does not restore an old queue receipt after sending settings change", async () => {
    let finishQueue!: (value: unknown) => void;
    const settings = { ok: true, campaign: { sends_enabled: false }, scope: [] };
    invoke.mockImplementation((_name, { body }) => {
      if (body.action === "queue") return new Promise((r) => { finishQueue = r; });
      return Promise.resolve({ data: body.action === "preview" ? preview : settings, error: null });
    });
    render(<EthosConsumerCampaignPanel sourceBatchId="batch-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview eligible consumers" }));
    await screen.findByText("pat@example.com");
    fireEvent.click(screen.getByLabelText("Select pat@example.com"));
    fireEvent.click(screen.getByRole("button", { name: "Queue 1 selected" }));
    expect(screen.getByLabelText("Select pat@example.com")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Licensed states and sending settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enable reviewed sends" }));
    await waitFor(() => expect(screen.queryByText("pat@example.com")).not.toBeInTheDocument());
    await act(async () => finishQueue({ data: { ok: true, queued: 1, already_present: 0, delivery_ids: ["old-delivery"] }, error: null }));
    expect(screen.queryByText(/1 queued, 0 already recorded/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send .*reviewed invitations/ })).not.toBeInTheDocument();
  });
});
