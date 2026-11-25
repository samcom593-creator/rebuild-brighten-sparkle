import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WinPostFeed, WinPostItem } from "@/lib/winPostCard";

const auth = vi.hoisted(() => ({ user: { id: "synthetic-viewer" } }));
const api = vi.hoisted(() => ({ rpc: vi.fn(), render: vi.fn(), save: vi.fn(), download: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: api.rpc } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/winPostCard", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/winPostCard")>(),
  renderCardToCanvas: api.render,
  saveCard: api.save,
  exportCardBlob: api.download,
}));

import WinPostStudio from "@/pages/WinPostStudio";
import { buildCaption, buildAwardCopySummary } from "@/lib/winPostCard";

const item: WinPostItem = {
  kind: "win", tier: "A", date: "2026-11-24", agent_id: "synthetic-agent",
  agent_name: "Example Producer", photo_url: null, instagram_handle: null,
  alp: 5123.45, deals: 3, avg_alp: 1707.82, carrier: null, product: null,
};
const feed: WinPostFeed = { as_of: "2026-11-25T18:00:00Z", period: { from: "2026-11-10", to: "2026-11-24" }, wins: [item], trophies: [] };
let unavailable = false;
let feedPayload: unknown = feed;
let queuePayload: unknown;
const clients: QueryClient[] = [];
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const writeText = vi.fn();
function page(client: QueryClient) {
  return <QueryClientProvider client={client}><MemoryRouter><WinPostStudio /></MemoryRouter></QueryClientProvider>;
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return { ...render(page(client)), client };
}

beforeEach(() => {
  auth.user = { id: "synthetic-viewer" };
  unavailable = false;
  feedPayload = feed;
  queuePayload = { as_of: feed.as_of, picks: [], posted_today: 0, counts: { queued: 1 }, queue: [{ id: "synthetic-queue", event_key: "example", kind: "win", tier: "A", status: "queued", event_date: item.date, payload: item }] };
  api.render.mockReset().mockResolvedValue(undefined);
  api.save.mockReset().mockResolvedValue("downloaded");
  api.download.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  api.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "win_post_feed") return unavailable ? { data: null, error: { message: "synthetic unavailable" } } : { data: feedPayload, error: null };
    if (name === "win_post_queue_board") return { data: queuePayload, error: null };
    return { data: { ok: true, status: "approved" }, error: null };
  });
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

describe("Win Post Studio", () => {
  it("uses the actual feed period and provides per-card copy controls without publishing", async () => {
    renderPage();
    const card = await screen.findByRole("article", { name: "Example Producer production win" });
    expect(screen.getByText("Production: 2026-11-10 – 2026-11-24. Milestone windows are shown on each card.")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Copy caption" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(buildCaption(item)));
    await within(card).findByText("Caption copied.");
    fireEvent.click(within(card).getByRole("button", { name: "Copy stats" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(buildAwardCopySummary(item)));
    expect(api.rpc.mock.calls.every(([name]) => name === "win_post_feed")).toBe(true);
    expect(api.save).not.toHaveBeenCalled();
    expect(api.download).not.toHaveBeenCalled();
  });

  it("opens selectable fallback text when per-card copying fails", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    renderPage();
    const card = await screen.findByRole("article", { name: "Example Producer production win" });
    fireEvent.click(within(card).getByRole("button", { name: "Copy caption" }));
    expect(await within(card).findByRole("textbox", { name: /Caption text/ })).toHaveValue(buildCaption(item));
    expect(within(card).queryByText("Caption copied.")).not.toBeInTheDocument();
  });

  it("preserves manual export through the actual renderer contract", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Open card for Example Producer" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: /Caption text/ })).toHaveValue(buildCaption(item));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save / share card" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(item));
    expect(api.render).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), item, 1);
  });

  it("keeps a cached feed visible with a stale warning after a failed refresh", async () => {
    renderPage();
    await screen.findByRole("article", { name: "Example Producer production win" });
    unavailable = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Showing the last loaded wins");
    expect(screen.getByRole("article", { name: "Example Producer production win" })).toBeInTheDocument();
    expect(screen.queryByText(/No qualifying wins/)).not.toBeInTheDocument();
  });

  it("hides the old account's selected card and draft before the new feed resolves", async () => {
    const view = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Open card for Example Producer" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByRole("textbox", { name: /Caption text/ }), { target: { value: "Private draft" } });
    auth.user = { id: "synthetic-other-viewer" };
    unavailable = true;
    view.rerender(page(view.client));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Private draft")).not.toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Example Producer production win" })).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Award counts are unavailable");
    expect(view.client.getQueryData(["win-post-feed", "synthetic-other-viewer", 14])).toBeUndefined();
  });

  it("keeps queue decisions explicit and retains their RPC contract", async () => {
    renderPage();
    await screen.findByRole("article", { name: "Example Producer production win" });
    fireEvent.click(screen.getByRole("button", { name: "Posting queue" }));
    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(api.rpc.mock.calls.some(([name]) => name === "win_post_queue_decide")).toBe(false);
    fireEvent.click(approve);
    await waitFor(() => expect(api.rpc).toHaveBeenCalledWith("win_post_queue_decide", { p_id: "synthetic-queue", p_action: "approve" }));
  });

  it.each([
    null, {}, { ...feed, period: null }, { ...feed, period: { from: "2026-02-30", to: "2026-03-01" } },
    { ...feed, wins: {} }, { ...feed, trophies: {} }, { ...feed, wins: [null] },
    { ...feed, wins: [{ ...item, agent_name: {} }] }, { ...feed, wins: [{ ...item, headline: {} }] },
  ])("uses the error state for an unverified feed response: %j", async payload => {
    feedPayload = payload;
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Award counts are unavailable");
    expect(screen.queryByText(/No qualifying wins/)).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it.each([
    null,
    { queue: [], picks: [], counts: null, posted_today: 0 },
    { queue: null, picks: [], counts: {}, posted_today: 0 },
    { queue: [null], picks: [], counts: { queued: 1 }, posted_today: 0 },
    { queue: [{ id: "example", event_key: "example", status: "queued", payload: null }], picks: [], counts: { queued: 1 }, posted_today: 0 },
    { queue: [], picks: [{}], counts: {}, posted_today: 0 },
    { queue: [], picks: [], counts: { queued: -1 }, posted_today: 0 },
  ])("uses the error state for an unverified posting queue: %j", async payload => {
    queuePayload = payload;
    renderPage();
    await screen.findByRole("article", { name: "Example Producer production win" });
    fireEvent.click(screen.getByRole("button", { name: "Posting queue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Queue counts are unavailable");
    expect(screen.queryByText(/No cards in the posting queue/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("retains the verified empty state when both feed arrays are empty", async () => {
    feedPayload = { ...feed, wins: [], trophies: [] };
    renderPage();
    expect(await screen.findByText(/No qualifying wins in this view/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
