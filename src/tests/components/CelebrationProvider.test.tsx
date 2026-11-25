import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CelebrationProvider } from "@/components/celebrations/CelebrationProvider";
import { announcePostedDealReceipt, DEAL_BATCH_DELAY_MS, DEAL_CELEBRATION_GAP_MS, suppressDealCelebrations } from "@/lib/dealCelebrations";
import { setSoundEnabled } from "@/lib/soundPreference";
import { setDemoMode } from "@/lib/demoMode";

type Change = { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> };
const state = vi.hoisted(() => ({
  user: { id: "user-a" } as { id: string } | null,
  isLoading: false,
  preview: false,
  readiness: "ready",
  callback: null as ((payload: Change) => void) | null,
  channel: { on: vi.fn(), subscribe: vi.fn() },
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(),
  removeChannel: vi.fn(), channelFactory: vi.fn(), play: vi.fn(), stop: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user, isLoading: state.isLoading }) }));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ isPreviewing: state.preview }) }));
vi.mock("@/hooks/useSoundSession", () => ({ useSoundSession: () => state.readiness }));
vi.mock("@/lib/soundEngine", () => ({ getSoundReadiness: () => state.readiness, playSoundEffect: state.play, stopSoundEffects: state.stop }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { channel: state.channelFactory, removeChannel: state.removeChannel, from: state.from } }));

const now = Date.parse("2026-11-25T16:00:00Z");
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const row = (n = 1, patch: Record<string, unknown> = {}) => ({ id: id(n), source: "apex_native", status: "submitted", posted_at: new Date(Date.now()).toISOString(), annual_premium: 1200, client_first_name: "PRIVATE CLIENT", policy_number: "PRIVATE POLICY", sms_body: "PRIVATE MESSAGE", ...patch });
const send = (n = 1, patch: Record<string, unknown> = {}, old?: Record<string, unknown>) => state.callback?.({ eventType: old ? "UPDATE" : "INSERT", new: row(n, patch), old });
const flush = async (ms = DEAL_BATCH_DELAY_MS) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const suppressionCleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  localStorage.clear();
  setDemoMode(false);
  state.user = { id: "user-a" };
  state.isLoading = state.preview = false;
  state.readiness = "ready";
  state.callback = null;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  state.channelFactory.mockReturnValue(state.channel);
  state.channel.on.mockImplementation((_event, _filter, callback) => { state.callback = callback; return state.channel; });
  state.channel.subscribe.mockReturnValue(state.channel);
  state.from.mockReturnValue({ select: state.select });
  state.select.mockReturnValue({ eq: state.eq });
  state.eq.mockReturnValue({ maybeSingle: state.maybeSingle });
  state.maybeSingle.mockResolvedValue({ data: row(), error: null });
});
afterEach(() => { cleanup(); suppressionCleanups.splice(0).forEach((release) => release()); setDemoMode(false); vi.useRealTimers(); Reflect.deleteProperty(document, "visibilityState"); });

describe("authorized production celebrations", () => {
  it("subscribes only to native deal changes and sanitizes all customer/alert text", async () => {
    render(<CelebrationProvider />);
    expect(state.channel.on).toHaveBeenCalledWith("postgres_changes", { event: "*", schema: "public", table: "deals", filter: "source=eq.apex_native" }, expect.any(Function));
    act(() => send());
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Deal posted");
    expect(screen.getByRole("status")).toHaveTextContent("$1,200.00");
    expect(screen.getByRole("status")).toHaveTextContent("annual premium");
    expect(document.body).not.toHaveTextContent("PRIVATE");
    expect(state.play).toHaveBeenCalledExactlyOnceWith("deal");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss deal celebration" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("deduplicates a local receipt followed by INSERT/UPDATE for the same durable ID", async () => {
    render(<CelebrationProvider />);
    await act(async () => { announcePostedDealReceipt("user-a", { dealId: id(1), status: "submitted" }); });
    act(() => { send(); send(1, {}, { id: id(1) }); });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Deal posted");
    expect(state.play).toHaveBeenCalledTimes(1);
    expect(state.select).toHaveBeenCalledWith("id, source, status, posted_at, created_at, annual_premium");
    expect(state.eq).toHaveBeenCalledWith("id", id(1));
    expect(state.from).toHaveBeenCalledTimes(1);
  });

  it("celebrates a newly saved legacy receipt without rewriting its older production date", async () => {
    state.maybeSingle.mockResolvedValue({ data: row(1, { source: "apex", posted_at: "2026-01-01T00:00:00Z", created_at: new Date(now).toISOString() }), error: null });
    render(<CelebrationProvider />);
    await act(async () => announcePostedDealReceipt("user-a", { dealId: id(1), status: "submitted" }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Deal posted");
    expect(screen.getByRole("status")).toHaveTextContent("Saved to your deal records.");
    expect(state.play).toHaveBeenCalledTimes(1);
  });

  it("suppresses live and masked amounts, receipt reads and sounds in global demo mode", async () => {
    setDemoMode(true);
    render(<CelebrationProvider />);
    await act(async () => announcePostedDealReceipt("user-a", { dealId: id(1) }));
    await flush();
    expect(state.channelFactory).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(state.play).not.toHaveBeenCalled();
  });

  it("clears a pending celebration immediately when the global demo flag turns on", async () => {
    render(<CelebrationProvider />);
    act(() => { send(); setDemoMode(true); });
    await flush();
    expect(state.removeChannel).toHaveBeenCalledTimes(1);
    expect(state.stop).toHaveBeenCalledWith("deal");
    expect(state.play).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => { setDemoMode(false); });
    act(() => send());
    await flush();
    expect(state.play).not.toHaveBeenCalled();
  });

  it("honors a presentation lease without replaying suppressed IDs after it releases", async () => {
    render(<CelebrationProvider />);
    act(() => send(1));
    let release: () => void = () => undefined;
    act(() => { release = suppressDealCelebrations(); suppressionCleanups.push(release); });
    act(() => send(2));
    await act(async () => announcePostedDealReceipt("user-a", { dealId: id(3) }));
    await flush();
    expect(state.channelFactory).toHaveBeenCalledTimes(1); // keep receiving/deduping live IDs
    expect(state.from).not.toHaveBeenCalled();
    expect(state.play).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(state.stop).toHaveBeenCalledWith("deal");
    act(() => release());
    act(() => { send(1); send(2); });
    await act(async () => announcePostedDealReceipt("user-a", { dealId: id(3) }));
    await flush();
    expect(state.play).not.toHaveBeenCalled();
    act(() => send(4));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Deal posted");
    act(() => { suppressionCleanups.push(suppressDealCelebrations()); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("drops a late receipt read and delayed realtime history after hide/refocus", async () => {
    const original = row();
    let finish: ((value: { data: ReturnType<typeof row>; error: null }) => void) | undefined;
    state.maybeSingle.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<CelebrationProvider />);
    act(() => announcePostedDealReceipt("user-a", { dealId: id(1) }));
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush(1000);
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      send(2, { posted_at: original.posted_at });
    });
    await act(async () => finish?.({ data: original, error: null }));
    await flush();
    expect(state.play).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("deduplicates realtime first, plus route rerender and same-tab receipt", async () => {
    const view = render(<CelebrationProvider />);
    act(() => send());
    view.rerender(<CelebrationProvider />);
    await act(async () => { announcePostedDealReceipt("user-a", { dealId: id(1), status: "submitted" }); });
    await flush();
    expect(state.from).not.toHaveBeenCalled();
    expect(state.channelFactory).toHaveBeenCalledTimes(1);
    expect(state.play).toHaveBeenCalledTimes(1);
  });

  it("celebrates draft→submitted without counting draft saves or later corrections", async () => {
    render(<CelebrationProvider />);
    act(() => { send(1, { status: "draft" }); send(1, {}, { id: id(1), status: "draft" }); send(1, { status: "approved" }, { id: id(1), status: "submitted" }); });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Deal posted");
    expect(state.play).toHaveBeenCalledTimes(1);
  });

  it("never celebrates history, raw imports, generic refreshes or malformed dates", async () => {
    render(<CelebrationProvider />);
    act(() => {
      send(1, { posted_at: new Date(now - 1000).toISOString() });
      send(2, { source: "agent_link", created_at: new Date(now).toISOString() });
      send(3, { posted_at: "invalid" });
      window.dispatchEvent(new CustomEvent("production-realtime-update"));
    });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(state.play).not.toHaveBeenCalled();
  });

  it("aggregates genuine bursts without a long sound queue or a partial money total", async () => {
    render(<CelebrationProvider />);
    act(() => { for (let n = 1; n <= 100; n += 1) send(n); });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("100 deals posted");
    expect(screen.getByRole("status")).toHaveTextContent("$120,000.00");
    act(() => { send(101); send(102, { annual_premium: null }); });
    await flush(DEAL_CELEBRATION_GAP_MS);
    expect(screen.getByRole("status")).toHaveTextContent("2 deals posted");
    expect(screen.getByRole("status")).not.toHaveTextContent("annual premium");
    expect(state.play).toHaveBeenCalledTimes(2);
    await flush(60_000);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(state.play).toHaveBeenCalledTimes(2);
  });

  it("keeps muted and pre-gesture events silent even if audio becomes ready before flush", async () => {
    state.readiness = "locked";
    render(<CelebrationProvider />);
    act(() => send());
    state.readiness = "ready";
    await flush();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(state.play).not.toHaveBeenCalled();
    act(() => { setSoundEnabled(false); send(2); setSoundEnabled(true); });
    await flush(DEAL_CELEBRATION_GAP_MS);
    expect(state.play).not.toHaveBeenCalled();
  });

  it("remembers hidden-tab events but never replays them on refocus", async () => {
    render(<CelebrationProvider />);
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      send();
    });
    await flush();
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      send();
    });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(state.play).not.toHaveBeenCalled();
  });

  it("clears a pending burst on hide, and only new deals can celebrate afterward", async () => {
    render(<CelebrationProvider />);
    act(() => {
      send();
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      send(2);
    });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Deal posted");
    expect(state.play).toHaveBeenCalledTimes(1);
  });

  it("suppresses all subscriptions and local receipt reads while signed out or previewing", async () => {
    state.preview = true;
    const view = render(<CelebrationProvider />);
    await act(async () => { announcePostedDealReceipt("user-a", { dealId: id(1) }); });
    expect(state.channelFactory).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalled();
    state.preview = false;
    state.user = null;
    view.rerender(<CelebrationProvider />);
    expect(state.channelFactory).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("clears private state on account change and ignores late responses from the old session", async () => {
    let resolveReceipt: ((value: { data: ReturnType<typeof row>; error: null }) => void) | undefined;
    state.maybeSingle.mockReturnValue(new Promise((resolve) => { resolveReceipt = resolve; }));
    const view = render(<CelebrationProvider />);
    act(() => announcePostedDealReceipt("user-a", { dealId: id(1) }));
    state.user = { id: "user-b" };
    view.rerender(<CelebrationProvider />);
    await act(async () => { resolveReceipt?.({ data: row(), error: null }); });
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(state.removeChannel).toHaveBeenCalledTimes(1);
    expect(state.play).not.toHaveBeenCalled();
    await act(async () => announcePostedDealReceipt("user-a", { dealId: id(2) }));
    expect(state.from).toHaveBeenCalledTimes(1);
  });

  it("a denied receipt read produces neither money nor a fallback fake win", async () => {
    state.maybeSingle.mockResolvedValue({ data: null, error: { message: "denied" } });
    render(<CelebrationProvider />);
    await act(async () => announcePostedDealReceipt("user-a", { dealId: id(1) }));
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(state.play).not.toHaveBeenCalled();
  });

  it("retains a static readable receipt with reduced motion and nonblocking decoration", () => {
    const css = readFileSync(resolve(process.cwd(), "src/components/celebrations/deal-celebration.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.deal-celebration-card\s*\{\s*animation: none/);
    expect(css).toMatch(/\.deal-celebration-balloons\s*\{\s*display: none/);
    expect(css).toContain("pointer-events: none");
    expect(css).not.toContain("infinite");
    expect(css).not.toMatch(/transition:\s*all|filter:|backdrop-filter:/);
  });
});
