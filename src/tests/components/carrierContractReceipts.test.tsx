import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, rpc, toast } = vi.hoisted(() => ({
  auth: { user: { id: "manager-1" }, isAdmin: true, isManager: false },
  rpc: vi.fn(), toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("sonner", () => ({ toast }));

import { CarrierContractsPanel } from "@/components/team/CarrierContractsPanel";

const empty = { chubb: false, chubb_at: null, ethos: false, ethos_at: null, ahl: false, ahl_at: null, ahl_exempt: false };
const saved = { ...empty, chubb: true, chubb_at: "2026-11-24T17:30:00Z" };
function mount(readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><CarrierContractsPanel agentId="agent-1" readOnly={readOnly} /></QueryClientProvider>);
  return { client, ...view };
}
beforeEach(() => {
  auth.user = { id: "manager-1" }; auth.isAdmin = true; auth.isManager = false;
  rpc.mockReset().mockResolvedValue({ data: empty, error: null }); toast.success.mockReset(); toast.error.mockReset();
});

describe("carrier receipt tracker", () => {
  it("reads only the selected authorized agent and explains that the tracker is not a complete carrier catalog", async () => {
    mount();
    expect(await screen.findByRole("button", { name: /Chubb/ })).toHaveAttribute("aria-pressed", "false");
    expect(rpc).toHaveBeenCalledWith("team_carrier_contract_status", { p_agent_id: "agent-1" });
    expect(screen.getByText(/does not list every available carrier/)).toBeInTheDocument();
    expect(screen.queryByText(/Combine|AFLAC|GTO|GTL/)).not.toBeInTheDocument();
  });
  it("does not invent false marks after null data and retries the read", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load");
    expect(screen.queryByRole("button", { name: /Chubb/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry carrier contracts" }));
    expect(await screen.findByRole("button", { name: /Chubb/ })).toHaveAttribute("aria-pressed", "false");
  });
  it("shows an AHL exemption as an exempt row with no write button", async () => {
    rpc.mockResolvedValue({ data: { ...empty, ahl_exempt: true }, error: null });
    mount();
    expect(await screen.findByText("Not in this hierarchy")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /American Home Life/ })).not.toBeInTheDocument();
  });
  it("keeps saved state while a write is pending, blocks repeats, then renders the server receipt date", async () => {
    let resolveWrite!: (value: { data: typeof saved; error: null }) => void;
    rpc.mockImplementation((name: string) => name === "set_team_carrier_contract" ? new Promise((resolve) => { resolveWrite = resolve; }) : Promise.resolve({ data: empty, error: null }));
    mount();
    const button = await screen.findByRole("button", { name: /Chubb/ });
    fireEvent.click(button); fireEvent.click(button);
    expect(button).toBeDisabled(); expect(button).toHaveAttribute("aria-pressed", "false");
    expect(rpc.mock.calls.filter(([name]) => name === "set_team_carrier_contract")).toEqual([["set_team_carrier_contract", { p_agent_id: "agent-1", p_carrier: "chubb", p_received: true }]]);
    expect(toast.success).not.toHaveBeenCalled();
    await act(async () => { resolveWrite({ data: saved, error: null }); });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveTextContent("2026");
    expect(toast.success).toHaveBeenCalledWith("Chubb: marked received");
  });
  it.each([null, { ...empty }])("does not toast success or alter saved state when a write response cannot confirm the requested mark", async (data) => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "set_team_carrier_contract" ? data : empty, error: null }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Chubb/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Chubb/ })).toHaveAttribute("aria-pressed", "false");
  });
  it("keeps a read-only summary read-only", async () => {
    mount(true);
    const button = await screen.findByRole("button", { name: /Chubb/ });
    expect(button).toBeDisabled(); fireEvent.click(button);
    expect(rpc.mock.calls.some(([name]) => name === "set_team_carrier_contract")).toBe(false);
  });
  it("does not read or render receipt controls for a role outside the existing gate", () => {
    auth.isAdmin = false;
    mount();
    expect(rpc).not.toHaveBeenCalled(); expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
