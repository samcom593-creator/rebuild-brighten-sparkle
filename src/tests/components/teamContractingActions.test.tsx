import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { person } from "../helpers/teamContractingFixtures";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: [{ user_id: "u1", name: "Owner One", roles: ["manager"] }], error: null }) },
}));
const api = vi.hoisted(() => ({
  logContactOutcome: vi.fn(async (_id: string, _o: string) => ({ ok: true })),
  saveFollowup: vi.fn(async (_id: string, _patch: Record<string, unknown>) => ({ ok: true })),
}));
vi.mock("@/lib/teamContracting", async (orig) => ({ ...(await orig<typeof import("@/lib/teamContracting")>()), logContactOutcome: api.logContactOutcome, saveFollowup: api.saveFollowup }));

import { ContactOutcomeButtons } from "@/components/team/ContactOutcome";
import { ContractingFollowupForm } from "@/components/team/ContractingFollowupForm";

function withClient(ui: React.ReactElement) {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  return { invalidate, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}
beforeEach(() => { vi.clearAllMocks(); });

describe("recording a contact outcome", () => {
  it("saves one outcome per tap sequence even when tapped twice, then refreshes", async () => {
    const onLogged = vi.fn();
    const { invalidate } = withClient(<ContactOutcomeButtons agentId="a1" name="Ann Lee" queryKey={["k"]} onLogged={onLogged} />);
    const btn = screen.getByRole("button", { name: "Voicemail" });
    // Both taps land before React re-renders, so the disabled attribute cannot help: only the synchronous guard can.
    act(() => { btn.click(); btn.click(); });
    expect(api.logContactOutcome).toHaveBeenCalledTimes(1);
    expect(api.logContactOutcome).toHaveBeenCalledWith("a1", "voicemail");
    await waitFor(() => expect(onLogged).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["k"] });
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Voicemail"));
  });

  it("a rejected save is reported, does not refresh and does not pretend it worked", async () => {
    api.logContactOutcome.mockResolvedValueOnce({ ok: false, error: "not allowed" } as never);
    const onLogged = vi.fn();
    const { invalidate } = withClient(<ContactOutcomeButtons agentId="a1" name="Ann Lee" queryKey={["k"]} onLogged={onLogged} />);
    fireEvent.click(screen.getByRole("button", { name: "Talked" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("not allowed")));
    expect(onLogged).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    // and the buttons are usable again for a retry
    expect(screen.getByRole("button", { name: "Talked" })).not.toBeDisabled();
  });
});

describe("saving a follow-up plan", () => {
  it("saves exactly what was entered, once, and refreshes the contracting read", async () => {
    const { invalidate } = withClient(<ContractingFollowupForm person={person()} queryKey={["k"]} />);
    fireEvent.change(screen.getByLabelText(/next follow-up date/i), { target: { value: "2026-10-12" } });
    fireEvent.change(screen.getByLabelText(/next step/i), { target: { value: "  Resend the packet  " } });
    fireEvent.change(screen.getByLabelText(/waiting on/i), { target: { value: "carrier" } });
    fireEvent.change(screen.getByLabelText(/blocker/i), { target: { value: "carrier_issue" } });
    const save = screen.getByRole("button", { name: /save follow-up/i });
    act(() => { save.click(); save.click(); });
    expect(api.saveFollowup).toHaveBeenCalledTimes(1);
    expect(api.saveFollowup).toHaveBeenCalledWith("a1", { follow_up_on: "2026-10-12", owner_user_id: null, waiting_on: "carrier", blocker: "carrier_issue", next_action: "Resend the packet" });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["k"] }));
  });

  it("clears a field by saving it empty, and says saving a plan does not complete anything", async () => {
    const { invalidate } = withClient(<ContractingFollowupForm person={person({ followup: { last_at: null, last_outcome: null, call_count: 0, next_on: "2026-10-12", next_action: "Old", waiting_on: "agent", blocker: "login_access", due_now: false } })} queryKey={["k"]} />);
    expect(screen.getByText(/does not mark anything contacted and does not complete a milestone/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/next follow-up date/i), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/next step/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save follow-up/i }));
    expect(api.saveFollowup).toHaveBeenCalledWith("a1", expect.objectContaining({ follow_up_on: null, next_action: null }));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("a rejected save is reported and does not refresh as though it had saved", async () => {
    api.saveFollowup.mockResolvedValueOnce({ ok: false, error: "scope" } as never);
    const { invalidate } = withClient(<ContractingFollowupForm person={person()} queryKey={["k"]} />);
    fireEvent.click(screen.getByRole("button", { name: /save follow-up/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("scope")));
    expect(toast.success).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
