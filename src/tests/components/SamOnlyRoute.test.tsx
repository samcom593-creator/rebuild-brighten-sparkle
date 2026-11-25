import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SamOnlyRoute } from "@/components/SamOnlyRoute";

const state = vi.hoisted(() => ({
  auth: { user: { id: "sam", email: "sam.com593@gmail.com" } as { id: string; email: string } | null, session: { expires_at: 123 }, isAdmin: true, isLoading: false },
  preview: false,
  rpc: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ isPreviewing: state.preview }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
vi.mock("@/components/ui/page-skeleton", () => ({ PageSkeleton: () => <p>Checking owner access</p> }));

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter><SamOnlyRoute><p>Private owner data</p></SamOnlyRoute></MemoryRouter></QueryClientProvider>;
  return { ...render(tree()), tree };
}
beforeEach(() => {
  state.auth = { user: { id: "sam", email: "sam.com593@gmail.com" }, session: { expires_at: 123 }, isAdmin: true, isLoading: false };
  state.preview = false;
  state.rpc.mockReset().mockResolvedValue({ data: true, error: null });
});

describe("Sam's private route boundary", () => {
  it("does not mount private content before the server confirms the session", async () => {
    let resolve!: (value: { data: boolean; error: null }) => void;
    state.rpc.mockReturnValue(new Promise(done => { resolve = done; }));
    renderGate();
    expect(screen.queryByText("Private owner data")).not.toBeInTheDocument();
    expect(screen.getByText("Checking owner access")).toBeInTheDocument();
    await act(async () => resolve({ data: true, error: null }));
    expect(await screen.findByText("Private owner data")).toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledWith("is_sam");
  });

  it.each([false, null, "true"])("fails closed when is_sam returns %s", async data => {
    state.rpc.mockResolvedValue({ data, error: null });
    renderGate();
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have access");
    expect(screen.queryByText("Private owner data")).not.toBeInTheDocument();
  });

  it("fails closed on a server error", async () => {
    state.rpc.mockResolvedValue({ data: null, error: new Error("offline") });
    renderGate();
    expect(await screen.findByRole("alert")).toHaveTextContent("Owner access could not be checked");
    expect(screen.queryByText("Private owner data")).not.toBeInTheDocument();
  });

  it.each(["other-admin", "agent", "preview", "loading"])("never requests or mounts owner data for %s", kind => {
    if (kind === "other-admin") state.auth.user = { id: "other", email: "other@example.test" };
    if (kind === "agent") state.auth.isAdmin = false;
    if (kind === "preview") state.preview = true;
    if (kind === "loading") state.auth.isLoading = true;
    renderGate();
    expect(screen.queryByText("Private owner data")).not.toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("hides confirmed data immediately when the account changes", async () => {
    const view = renderGate();
    await screen.findByText("Private owner data");
    state.auth.user = { id: "different-admin", email: "other@example.test" };
    view.rerender(view.tree());
    expect(screen.queryByText("Private owner data")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("You do not have access");
  });

  it("does not let a late previous-account result open the next account", async () => {
    let resolve!: (value: { data: boolean; error: null }) => void;
    state.rpc.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = renderGate();
    await waitFor(() => expect(state.rpc).toHaveBeenCalled());
    state.auth.user = { id: "different-admin", email: "other@example.test" };
    view.rerender(view.tree());
    await act(async () => resolve({ data: true, error: null }));
    expect(screen.queryByText("Private owner data")).not.toBeInTheDocument();
  });
});
