import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import MoneyInbox from "@/pages/MoneyInbox";
const auth = vi.hoisted(() => ({
  user: { id: "sam", email: "sam.com593@gmail.com" },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));
const update = vi.fn(),
  eq = vi.fn();
let updateError: Error | null = null;
const row = {
  id: "one",
  display_name: null,
  handle: "+14697676068",
  source: "imessage",
  topics: ["join_team"],
  priority: 1,
  private: false,
  classified_at: "2026-10-29T00:00:00Z",
  awaiting_reply: true,
  last_inbound_at: "2026-10-29T00:42:00Z",
  last_inbound_text: "Can I join your team?",
  excerpt: [
    { t: "2026-10-29T00:42:00Z", from: "them", text: "Can I join your team?" },
  ],
  draft_reply: "Let’s talk tomorrow.",
  final_reply: null,
  status: "pending",
  sent_at: null,
  send_error: null,
  updated_at: "v1",
  snoozed_until: null,
  send_supported: true,
  source_url: null,
};
let rows = [row];
beforeEach(() => {
  vi.clearAllMocks();
  auth.user.email = "sam.com593@gmail.com";
  rows = [row];
  updateError = null;
  vi.mocked(supabase.from).mockImplementation(((table: string) => ({
    select: vi.fn().mockReturnThis(),
    eq: eq.mockReturnThis(),
    update: update.mockReturnThis(),
    order: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({
          data:
            table === "money_inbox_sources"
              ? [
                  {
                    source: "imessage",
                    connected: true,
                    reason: "Mac ready",
                    checked_at: new Date().toISOString(),
                  },
                ]
              : rows,
          error: null,
        }),
      ),
    then: (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: [{ id: "one" }], error: updateError }).then(
        resolve,
      ),
  })) as unknown as typeof supabase.from);
});
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/dashboard/money-inbox"]}>
        <Routes>
          <Route path="/dashboard/money-inbox" element={<MoneyInbox />} />
          <Route path="/dashboard" element={<p>Dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("Money Inbox", () => {
  it("does not fetch for another user", async () => {
    auth.user.email = "other@example.com";
    mount();
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
  });
  it("shows a formatted unsaved contact and Phoenix date", async () => {
    mount();
    expect(await screen.findByText("(469) 767-6068")).toBeInTheDocument();
    expect(screen.getByText(/Oct 28, 5:42 PM MST/)).toBeInTheDocument();
  });
  it("approves exact edited text with stale-row guards", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Your reply"), {
      target: { value: "Call me tomorrow." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve send" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        final_reply: "Call me tomorrow.",
        status: "approved",
        approved_at: expect.any(String),
      }),
    );
    expect(eq).toHaveBeenCalledWith("updated_at", "v1");
    expect(eq).toHaveBeenCalledWith("status", "pending");
  });
  it("filters private content even if mistakenly returned", async () => {
    rows = [{ ...row, private: true }];
    mount();
    await screen.findByText("No conversations match these filters.");
    expect(screen.queryByText("Can I join your team?")).not.toBeInTheDocument();
  });
  it("shows failed saves and restores the approval action", async () => {
    updateError = new Error("Connection failed");
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Approve send" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection failed",
    );
    expect(
      await screen.findByRole("button", { name: "Approve send" }),
    ).toBeEnabled();
  });
  it("does not offer send for unconnected social send paths", async () => {
    rows = [{ ...row, source: "tiktok", send_supported: false }];
    mount();
    await screen.findByText(/Approve-to-send is not connected/);
    expect(
      screen.queryByRole("button", { name: "Approve send" }),
    ).not.toBeInTheDocument();
  });
  it("stores snooze and done separately", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Snooze 1d" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        snoozed_until: expect.any(String),
      }),
    );
  });
});
