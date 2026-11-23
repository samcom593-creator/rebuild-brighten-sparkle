import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LeadStatePrompt } from "@/components/dashboard/LeadStatePrompt";
import { addState, stateName } from "@/lib/leadStatePrompt";

type Reply = { data: unknown; error: { message: string } | null };
const rpc = vi.mocked(supabase.rpc as unknown as (fn: string, args?: Record<string, unknown>) => Promise<Reply>);

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("LeadStatePrompt", () => {
  it("renders nothing for someone whose state is on file", async () => {
    rpc.mockResolvedValue({ data: { needs_state: false }, error: null });
    const { container } = wrap(<LeadStatePrompt />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("my_leads_state_prompt"));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the read fails: an offer is never an error banner", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { container } = wrap(<LeadStatePrompt />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("asks the question, saves the chosen states, and says how many leads landed", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "my_leads_state_prompt"
        ? { data: { needs_state: true }, error: null }
        : { data: { ok: true, leads: { decision: "granted", leads: 25 } }, error: null });
    wrap(<LeadStatePrompt />);
    expect(await screen.findByText("Your leads are ready. Which state are you licensed in?")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Get my leads" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByTestId("lead-state-select"), { target: { value: "WI" } });
    fireEvent.change(screen.getByTestId("lead-state-select"), { target: { value: "MN" } });
    expect(screen.getByRole("button", { name: "Remove Wisconsin" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Minnesota" }));

    fireEvent.click(screen.getByRole("button", { name: "Get my leads" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("my_leads_set_state", { p_states: ["WI"] }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("25 leads are in My Leads now."));
  });

  it("a refused save says so and keeps the question on screen", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "my_leads_state_prompt"
        ? { data: { needs_state: true }, error: null }
        : { data: null, error: { message: "Choose the state you are licensed in." } });
    wrap(<LeadStatePrompt />);
    fireEvent.change(await screen.findByTestId("lead-state-select"), { target: { value: "AZ" } });
    fireEvent.click(screen.getByRole("button", { name: "Get my leads" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByTestId("lead-state-prompt")).toBeInTheDocument();
  });
});

describe("leadStatePrompt helpers", () => {
  it("adds a state once, in the order chosen, and ignores junk", () => {
    expect(addState([], "wi")).toEqual(["WI"]);
    expect(addState(["WI"], "WI")).toEqual(["WI"]);
    expect(addState(["WI"], "MN")).toEqual(["WI", "MN"]);
    expect(addState(["WI"], "")).toEqual(["WI"]);
    expect(addState(["WI"], "ZZ")).toEqual(["WI"]);
  });

  it("names a state, and returns the code for one it does not list", () => {
    expect(stateName("AZ")).toBe("Arizona");
    expect(stateName("ZZ")).toBe("ZZ");
  });
});
