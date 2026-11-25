import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingLibrary } from "@/components/calltraining/TrainingLibrary";

const auth = vi.hoisted(() => ({ user: { id: "agent-a" } as { id: string } | null, isLoading: false }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

const row = { call_id: "call-a", call_started_at: null, agent_name: "Training agent", disposition: null,
  overall_score: 90, great_call: true, summary: "Authorized training summary", script_score: null };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = <QueryClientProvider client={client}><TrainingLibrary /></QueryClientProvider>;
  const view = render(content);
  return { ...view, update: () => view.rerender(<QueryClientProvider client={client}><TrainingLibrary /></QueryClientProvider>) };
}
beforeEach(() => { auth.user = { id: "agent-a" }; auth.isLoading = false; rpc.mockReset(); });
afterEach(cleanup);

describe("published training library", () => {
  it("does not reuse another account's authorized catalog", async () => {
    rpc.mockResolvedValueOnce({ data: [row], error: null });
    const view = mount();
    await screen.findByText("Authorized training summary");
    auth.user = { id: "agent-b" };
    rpc.mockResolvedValue({ data: [], error: null });
    view.update();
    expect(screen.queryByText("Authorized training summary")).toBeNull();
    await screen.findByText("No calls here yet");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each([null, {}, [null]])("keeps a malformed catalog retryable instead of showing a verified empty library: %j", async data => {
    rpc.mockResolvedValueOnce({ data, error: null }).mockResolvedValue({ data: [row], error: null });
    mount();
    await screen.findByText("The training library did not load");
    expect(screen.queryByText("No calls here yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry training calls" }));
    await screen.findByText("Authorized training summary");
  });

  it("does not read a catalog while signed out", () => {
    auth.user = null;
    mount();
    expect(screen.getByText("Sign in to view training calls.")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not claim an empty library while account access is still loading", () => {
    auth.isLoading = true;
    mount();
    expect(screen.queryByText("No calls here yet")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
