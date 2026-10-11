import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { create } from "zustand";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), openAgent: vi.fn(), admin: true }));
const useStore = create<{ commandPaletteOpen: boolean; setCommandPaletteOpen: (open: boolean) => void }>((set) => ({
  commandPaletteOpen: true, setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}));
vi.mock("@/shared/store/uiStore", () => ({ useUIStore: (selector: Parameters<typeof useStore>[0]) => useStore(selector) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "viewer" }, isAdmin: mocks.admin, isLoading: false, effectiveMode: "admin" }) }));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ isPreviewing: false }) }));
vi.mock("@/stores/agentProfileDrawer", () => ({ useAgentProfileDrawer: (selector: (s: { openAgent: typeof mocks.openAgent }) => unknown) => selector({ openAgent: mocks.openAgent }) }));
import { CommandPalette } from "@/components/command/CommandPalette";
const agent = { id: "agent-42", name: "Alex Rivera", email: "alex@example.test", stage: "training" };
const result = { data: { ok: true, agents: [agent], applicants: [{ id: "app-17", name: "Jordan Rivera", email: "jordan@example.test", status: "rejected" }] }, error: null };
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function mount() { render(<MemoryRouter><CommandPalette /><Location /></MemoryRouter>); }
function input(value: string) { fireEvent.change(screen.getByRole("combobox"), { target: { value } }); }
beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue(result); mocks.openAgent.mockClear(); mocks.admin = true;
  useStore.setState({ commandPaletteOpen: true });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Shared people search", () => {
  it("shows scoped recent people on opening, ahead of quick links, and opens the exact agent", async () => {
    mount();
    await screen.findByText("Alex Rivera");
    expect(mocks.rpc).toHaveBeenCalledWith("search_people", { p_q: "", p_limit: 4 });
    expect(screen.getAllByRole("option")[0].textContent).toContain("Alex Rivera");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(mocks.openAgent).toHaveBeenCalledWith("agent-42");
    expect(useStore.getState().commandPaletteOpen).toBe(false);
  });
  it("preserves applicant identity even for a closed application", async () => {
    mount(); fireEvent.click(await screen.findByText("Jordan Rivera"));
    expect(screen.getByTestId("location").textContent).toContain("person=app-17");
  });
  it("shows failures even with page matches and retries thrown network errors", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("offline")); mount();
    await screen.findByRole("alert");
    expect(screen.getByText("Quick links")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Alex Rivera");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("ignores late responses from an earlier search", async () => {
    let resolveOld!: (v: typeof result) => void;
    mocks.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    mount(); await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    mocks.rpc.mockResolvedValue({ data: { ok: true, agents: [{ ...agent, name: "New Person" }], applicants: [] }, error: null });
    input("new"); await screen.findByText("New Person");
    await act(async () => { resolveOld(result); });
    expect(screen.queryByText("Alex Rivera")).toBeNull();
  });
  it("does not fetch people for a plain agent or one-character query", async () => {
    mocks.admin = false; mount(); await act(async () => {});
    expect(mocks.rpc).not.toHaveBeenCalled();
    cleanup(); mocks.admin = true; mount(); input("a");
    await screen.findByText("Type at least two characters to find someone.");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("clears a closed search and supports Command K", async () => {
    mount(); input("rivera"); await screen.findByText("Alex Rivera");
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(useStore.getState().commandPaletteOpen).toBe(false);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByRole("combobox")).toHaveValue("");
  });
});
