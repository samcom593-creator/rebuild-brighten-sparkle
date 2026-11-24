import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
import { EthosConsumerSettings } from "@/components/leads/EthosConsumerSettings";

beforeEach(() => { invoke.mockReset(); });
describe("consumer campaign owner settings", () => {
  it("starts empty and saves explicit evidence before enabling without sending", async () => {
    const changed = vi.fn();
    const empty = { ok: true, campaign: { sends_enabled: false }, scope: [] };
    const recorded = { ...empty, scope: [{ state: "WI", license_status: "active", license_evidence_ref: "Regulator record 123", license_expires_at: "2030-12-31T00:00:00Z", ethos_eligible: true, ethos_evidence_ref: "Ethos eligibility record 456" }] };
    invoke.mockResolvedValueOnce({ data: empty, error: null })
      .mockResolvedValueOnce({ data: { ok: true, sent: 0 }, error: null })
      .mockResolvedValueOnce({ data: recorded, error: null })
      .mockResolvedValueOnce({ data: { ok: true, sent: 0 }, error: null })
      .mockResolvedValueOnce({ data: { ...recorded, campaign: { sends_enabled: true } }, error: null });
    render(<EthosConsumerSettings onChanged={changed} />);
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Licensed states and sending settings" }));
    await screen.findByText("No states recorded. Consumer emails remain blocked.");
    expect(screen.getByLabelText("Licensed state code")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save state evidence" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Licensed state code"), { target: { value: "wi" } });
    fireEvent.change(screen.getByLabelText("License expiration date"), { target: { value: "2030-12-31" } });
    fireEvent.change(screen.getByLabelText("Active life-license evidence reference"), { target: { value: "Regulator record 123" } });
    fireEvent.change(screen.getByLabelText("Ethos state/product eligibility evidence reference"), { target: { value: "Ethos eligibility record 456" } });
    expect(screen.getByRole("button", { name: "Save state evidence" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I checked the named evidence and its expiration for this state."));
    fireEvent.click(screen.getByRole("button", { name: "Save state evidence" }));
    await screen.findByText("WI: License and Ethos evidence recorded");
    expect(invoke).toHaveBeenCalledWith("ethos-consumer-campaign", { body: expect.objectContaining({ action: "save_scope", state: "WI", license_evidence_ref: "Regulator record 123", license_expires_at: "2030-12-31T00:00:00Z", ethos_evidence_ref: "Ethos eligibility record 456", evidence_reviewed: true }) });
    fireEvent.click(screen.getByRole("button", { name: "Enable reviewed sends" }));
    await screen.findByText("Sending enabled");
    expect(invoke).toHaveBeenCalledWith("ethos-consumer-campaign", { body: expect.objectContaining({ action: "set_enabled", enabled: true }) });
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls.every(([, { body }]) => body.action !== "dispatch")).toBe(true);
  });

  it("shows an access failure without exposing editable settings", async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: "Only the verified campaign owner can access this audience." }, error: null });
    render(<EthosConsumerSettings onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Licensed states and sending settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the verified campaign owner");
    expect(screen.queryByRole("button", { name: "Save state evidence" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable reviewed sends" })).not.toBeInTheDocument();
  });

  it("clears previously editable settings after an access failure and supports a fresh read", async () => {
    const changed = vi.fn();
    const empty = { ok: true, campaign: { sends_enabled: false }, scope: [] };
    invoke.mockResolvedValueOnce({ data: empty, error: null })
      .mockResolvedValueOnce({ data: { ok: false, error: "Owner access is no longer available" }, error: null })
      .mockResolvedValueOnce({ data: empty, error: null });
    render(<EthosConsumerSettings onChanged={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Licensed states and sending settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enable reviewed sends" }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent("Owner access is no longer available");
    expect(screen.queryByRole("button", { name: "Enable reviewed sends" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save state evidence" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry state evidence" }));
    await screen.findByText("No states recorded. Consumer emails remain blocked.");
    expect(invoke).toHaveBeenLastCalledWith("ethos-consumer-campaign", { body: expect.objectContaining({ action: "settings" }) });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
