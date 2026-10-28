import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

// Synthetic options only: one admin inviting under themself, no carriers.
const calls = vi.hoisted(() => [] as Array<{ fn: string; args?: Record<string, unknown> }>);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "invitation_mint_options") {
        return Promise.resolve({
          data: {
            is_admin: true, is_manager: true, caller_agent_id: "agent-self", cap_pct: 100, can_offer_comp: true,
            comp_levels: [50, 60], roles: ["hired_manager"],
            uplines: [{ id: "00000000-0000-4000-8000-0000000000aa", name: "Test Admin", agency_key: "apex", is_self: true }],
            carriers: [],
          },
          error: null,
        });
      }
      if (fn === "create_invitation") {
        return Promise.resolve({ data: { id: "inv-1", kind: "hire", path: "/hire/test-token", expires_at: "2026-11-04T00:00:00Z" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import { InviteAgentForm } from "@/components/invitations/InviteAgentForm";

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InviteAgentForm />
    </QueryClientProvider>,
  );
}

const createCalls = () => calls.filter((c) => c.fn === "create_invitation");

afterEach(() => {
  calls.length = 0;
});

describe("InviteAgentForm team note", () => {
  it("a note that stops fitting once the contracting fields are typed is flagged and blocks the invitation, never trimmed", async () => {
    renderForm();
    const noteInput = (await screen.findByLabelText(/Team note/)) as HTMLInputElement;

    // With no contracting fields the whole 200-character note limit is the note's.
    fireEvent.change(noteInput, { target: { value: "n".repeat(190) } });
    expect(screen.getByText("10 characters left")).toBeTruthy();

    // The contracting line then takes 72 of those characters, so 128 remain and 62 are over.
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Mary Ann" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Smith" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "(256) 975-6155" } });
    fireEvent.change(screen.getByLabelText(/^NPN/), { target: { value: "12345678" } });
    expect(noteInput.value).toHaveLength(190);
    expect(noteInput.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("The note is 62 characters too long");

    // Create is refused until the note fits; nothing reaches the server.
    fireEvent.click(screen.getByTestId("create-invitation"));
    await waitFor(() => expect((screen.getByTestId("create-invitation") as HTMLButtonElement).disabled).toBe(true));
    expect(createCalls()).toHaveLength(0);

    // Shortening the note clears the flag; the saved note carries the contracting line and the whole note.
    fireEvent.change(noteInput, { target: { value: "Met at the Tuesday seminar" } });
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect((screen.getByTestId("create-invitation") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("create-invitation"));
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    const args = createCalls()[0].args ?? {};
    expect(args.p_recipient_name).toBe("Mary Ann Smith");
    expect(args.p_recipient_phone).toBe("(256) 975-6155");
    expect(args.p_notes).toBe("Contracting: First=Mary Ann; Last=Smith; Phone=2569756155; NPN=12345678\nMet at the Tuesday seminar");
  });

  it("a note typed after the fields is capped by the room left, so it can never go over", async () => {
    renderForm();
    fireEvent.change(await screen.findByLabelText("First name"), { target: { value: "Jo" } });
    const noteInput = (await screen.findByLabelText(/Team note/)) as HTMLInputElement;
    // "Contracting: First=Jo" is 21 characters plus the newline: 178 remain.
    expect(noteInput.getAttribute("maxlength")).toBe("178");
    fireEvent.change(noteInput, { target: { value: "n".repeat(170) } });
    expect(screen.getByText("8 characters left")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
