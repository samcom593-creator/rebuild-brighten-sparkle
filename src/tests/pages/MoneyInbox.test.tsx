import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import MoneyInbox from "@/pages/MoneyInbox";

const auth = vi.hoisted(() => ({ user: { id: "sam", email: "sam.com593@gmail.com" } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));

const update = vi.fn();
const eq = vi.fn();
const order = vi.fn();
const refreshResult = {
  id: "thread-1", display_name: "Client", handle: "+15555550100", is_group: false,
  rank: 1, category: "payment", money_score: 99, money_reasons: ["Payment due"],
  awaiting_reply: true, last_inbound_at: new Date().toISOString(),
  last_inbound_text: "Ready to pay", excerpt: [], draft_reply: null, final_reply: null,
  status: "pending", sent_at: null, send_receipt: null, send_error: null,
  updated_at: "2026-10-28T07:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.user.email = "sam.com593@gmail.com";
  vi.stubGlobal("ResizeObserver", class { observe() { return undefined; } disconnect() { return undefined; } });
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: eq.mockReturnThis(),
    update: update.mockReturnThis(),
    order: order.mockResolvedValue({ data: [refreshResult], error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ id: "thread-1" }], error: null }).then(resolve),
  };
  vi.mocked(supabase.from).mockReturnValue(builder as unknown as ReturnType<typeof supabase.from>);
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/dashboard/money-inbox"]}>
        <Routes>
          <Route path="/dashboard/money-inbox" element={<MoneyInbox />} />
          <Route path="/dashboard" element={<p>Dashboard destination</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Money Inbox approval boundary", () => {
  it("redirects other users without querying private threads", async () => {
    auth.user.email = "other@example.com";
    mount();
    expect(await screen.findByText("Dashboard destination")).toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("requires reply text and queues exactly the edited reply with a version guard", async () => {
    mount();
    const approve = await screen.findByRole("button", { name: "Approve & send" });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "I'll send the invoice now." } });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({
      final_reply: "I'll send the invoice now.", status: "approved", approved_at: expect.any(String),
    });
    expect(eq).toHaveBeenCalledWith("id", "thread-1");
    expect(eq).toHaveBeenCalledWith("status", "pending");
    expect(eq).toHaveBeenCalledWith("updated_at", refreshResult.updated_at);
    await waitFor(() => expect(order).toHaveBeenCalledTimes(2));
  });

  it("mutes with only the authorized muted column and refetches", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Not money" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ muted: true }));
    await waitFor(() => expect(order).toHaveBeenCalledTimes(2));
  });
});
