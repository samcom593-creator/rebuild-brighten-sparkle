import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HireCelebrationProvider } from "@/components/celebrations/HireCelebrationProvider";
import { HIRE_BATCH_DELAY_MS, HIRE_CELEBRATION_DURATION_MS, HIRE_CELEBRATION_GAP_MS } from "@/lib/hireCelebrations";
import { suppressDealCelebrations } from "@/lib/dealCelebrations";
import { setSoundEnabled } from "@/lib/soundPreference";
import { setDemoMode } from "@/lib/demoMode";

// MP-HIRE-CELEBRATION. The hire stream is a SIBLING of the deal stream in
// AuthenticatedShell, not a child of CelebrationProvider: the deal suite pins
// that provider's exact channel/read/removeChannel counts, and those stay true.
// This suite is the hire stream's own contract, with a mock chain that covers
// the two reads it makes (viewer agent ids, recruiter names).

type Change = { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> };
const state = vi.hoisted(() => ({
  user: { id: "user-a" } as { id: string } | null,
  isLoading: false,
  isAdmin: true,
  isManager: false,
  preview: false,
  readiness: "ready",
  callback: null as ((payload: Change) => void) | null,
  channel: { on: vi.fn(), subscribe: vi.fn() },
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), limit: vi.fn(), inFilter: vi.fn(),
  removeChannel: vi.fn(), channelFactory: vi.fn(), play: vi.fn(), stop: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: state.user, isLoading: state.isLoading, isAdmin: state.isAdmin, isManager: state.isManager }),
}));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ isPreviewing: state.preview }) }));
vi.mock("@/lib/soundEngine", () => ({ getSoundReadiness: () => state.readiness, playSoundEffect: state.play, stopSoundEffects: state.stop }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { channel: state.channelFactory, removeChannel: state.removeChannel, from: state.from } }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

const now = Date.parse("2026-11-26T02:30:00Z");
const id = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;
const recruiter = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherManager = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const row = (n = 1, patch: Record<string, unknown> = {}) => ({
  id: id(n), status: "active", onboarding_stage: "training_online", license_status: "licensed", agent_code: null,
  display_name: `Hire ${n}`, manager_id: otherManager, invited_by_manager_id: recruiter, user_id: `user-hire-${n}`,
  is_deactivated: false, is_inactive: false, created_at: new Date(Date.now()).toISOString(),
  phone: "PRIVATE PHONE", email: "private@example.com", ...patch,
});
const send = (n = 1, patch: Record<string, unknown> = {}, eventType = "INSERT") => state.callback?.({ eventType, new: row(n, patch) });
const flush = async (ms = HIRE_BATCH_DELAY_MS) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const settle = async () => { await act(async () => { await Promise.resolve(); }); };
const suppressionCleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  localStorage.clear();
  setDemoMode(false);
  setSoundEnabled(true);
  state.user = { id: "user-a" };
  state.isLoading = state.preview = false;
  state.isAdmin = true;
  state.isManager = false;
  state.readiness = "ready";
  state.callback = null;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  state.channelFactory.mockReturnValue(state.channel);
  state.channel.on.mockImplementation((_event, _filter, callback) => { state.callback = callback; return state.channel; });
  state.channel.subscribe.mockReturnValue(state.channel);
  state.from.mockReturnValue({ select: state.select });
  state.select.mockReturnValue({ eq: state.eq, in: state.inFilter });
  state.eq.mockReturnValue({ limit: state.limit });
  // The viewer's own agent row(s), then the recruiter-name lookup.
  state.limit.mockResolvedValue({ data: [], error: null });
  state.inFilter.mockResolvedValue({ data: [{ id: recruiter, display_name: "Obiajulu Ifediora" }, { id: otherManager, display_name: "Samuel James" }], error: null });
});
afterEach(() => { cleanup(); suppressionCleanups.splice(0).forEach((release) => release()); setDemoMode(false); vi.useRealTimers(); Reflect.deleteProperty(document, "visibilityState"); });

describe("the hire screen", () => {
  it("subscribes to agents INSERTs only and shows name, license, recruiter — never a phone or email", async () => {
    render(<HireCelebrationProvider />);
    expect(state.channel.on).toHaveBeenCalledWith("postgres_changes", { event: "INSERT", schema: "public", table: "agents" }, expect.any(Function));
    expect(state.channelFactory).toHaveBeenCalledTimes(1);
    expect(state.select).toHaveBeenCalledWith("id");
    expect(state.eq).toHaveBeenCalledWith("user_id", "user-a");
    await settle();
    act(() => send());
    await flush();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Welcome, Hire");
    expect(status).toHaveTextContent("Hire 1");
    expect(status).toHaveTextContent("Licensed");
    expect(status).toHaveTextContent("Recruited by Obiajulu Ifediora");
    expect(state.inFilter).toHaveBeenCalledWith("id", [recruiter, otherManager]);
    expect(document.body).not.toHaveTextContent("PRIVATE");
    expect(document.body).not.toHaveTextContent("example.com");
    expect(state.play).toHaveBeenCalledExactlyOnceWith("fanfare");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss hire celebration" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a pre-license hire reads Pre-license and still shows without an agent code", async () => {
    render(<HireCelebrationProvider />);
    await settle();
    act(() => send(1, { license_status: "unlicensed", agent_code: null }));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Pre-license");
    expect(screen.getByRole("status")).not.toHaveTextContent("Licensed");
  });

  it("managers see every hire; a plain agent sees only the hires they recruited", async () => {
    state.isAdmin = false;
    state.isManager = true;
    const view = render(<HireCelebrationProvider />);
    await settle();
    act(() => send(1));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Hire 1");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss hire celebration" }));
    view.unmount();
    cleanup();

    // A plain agent whose agent row is the recruiter.
    vi.clearAllMocks();
    state.isManager = false;
    state.channelFactory.mockReturnValue(state.channel);
    state.channel.on.mockImplementation((_event, _filter, callback) => { state.callback = callback; return state.channel; });
    state.channel.subscribe.mockReturnValue(state.channel);
    state.from.mockReturnValue({ select: state.select });
    state.select.mockReturnValue({ eq: state.eq, in: state.inFilter });
    state.eq.mockReturnValue({ limit: state.limit });
    state.limit.mockResolvedValue({ data: [{ id: recruiter }], error: null });
    state.inFilter.mockResolvedValue({ data: [], error: null });
    render(<HireCelebrationProvider />);
    await settle();
    act(() => { send(2); send(3, { invited_by_manager_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", manager_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }); });
    await flush(HIRE_CELEBRATION_GAP_MS);
    expect(screen.getByRole("status")).toHaveTextContent("Hire 2");
    expect(screen.getByRole("status")).not.toHaveTextContent("Hire 3");
    expect(state.play).toHaveBeenCalledTimes(1);
  });

  it("a plain agent who recruited nobody never sees a screen", async () => {
    state.isAdmin = false;
    render(<HireCelebrationProvider />);
    await settle();
    act(() => send(1));
    await flush(HIRE_CELEBRATION_GAP_MS);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(state.play).not.toHaveBeenCalled();
    expect(state.inFilter).not.toHaveBeenCalled();
  });

  it("never celebrates placeholders, pending rows, departed rows, UPDATEs or history", async () => {
    render(<HireCelebrationProvider />);
    await settle();
    act(() => {
      send(1, { agent_code: "GHOST_AYRO_1", user_id: null });
      send(2, { status: "pending" });
      send(3, { is_deactivated: true });
      send(4, { is_inactive: true });
      send(5, {}, "UPDATE");
      send(6, { display_name: "" });
      send(7, { created_at: new Date(now - 1000).toISOString() });
    });
    await flush(HIRE_CELEBRATION_GAP_MS);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(state.play).not.toHaveBeenCalled();
  });

  it("one screen per hire: a replayed INSERT is ignored and a burst is one screen", async () => {
    render(<HireCelebrationProvider />);
    await settle();
    act(() => { send(1); send(1); });
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Welcome, Hire");
    expect(state.play).toHaveBeenCalledTimes(1);
    act(() => { for (let n = 2; n <= 7; n += 1) send(n); });
    await flush(HIRE_CELEBRATION_GAP_MS);
    expect(screen.getByRole("status")).toHaveTextContent("6 new hires");
    expect(screen.getByRole("status")).toHaveTextContent("and 2 more");
    expect(state.play).toHaveBeenCalledTimes(2);
    await flush(HIRE_CELEBRATION_DURATION_MS + 1000);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps muted and pre-gesture events silent even if audio becomes ready before flush", async () => {
    state.readiness = "locked";
    render(<HireCelebrationProvider />);
    await settle();
    act(() => send(1));
    state.readiness = "ready";
    await flush();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(state.play).not.toHaveBeenCalled();
    act(() => { setSoundEnabled(false); send(2); setSoundEnabled(true); });
    await flush(HIRE_CELEBRATION_GAP_MS);
    expect(state.play).not.toHaveBeenCalled();
  });

  it("stays dark in demo mode, while previewing a role, and when signed out", async () => {
    setDemoMode(true);
    const view = render(<HireCelebrationProvider />);
    expect(state.channelFactory).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalled();
    setDemoMode(false);
    state.preview = true;
    view.rerender(<HireCelebrationProvider />);
    expect(state.channelFactory).not.toHaveBeenCalled();
    state.preview = false;
    state.user = null;
    view.rerender(<HireCelebrationProvider />);
    expect(state.channelFactory).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("clears a pending screen when the demo flag turns on or a presentation lease is taken", async () => {
    render(<HireCelebrationProvider />);
    await settle();
    act(() => { send(1); setDemoMode(true); });
    await flush();
    expect(state.removeChannel).toHaveBeenCalledTimes(1);
    expect(state.stop).toHaveBeenCalledWith("fanfare");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => setDemoMode(false));
    await settle();
    act(() => send(2));
    act(() => { suppressionCleanups.push(suppressDealCelebrations()); });
    await flush(HIRE_CELEBRATION_GAP_MS);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(state.play).not.toHaveBeenCalled();
  });

  it("remembers hidden-tab hires but never replays them on refocus", async () => {
    render(<HireCelebrationProvider />);
    await settle();
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      send(1);
    });
    await flush();
    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      send(1);
    });
    await flush(HIRE_CELEBRATION_GAP_MS);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(state.play).not.toHaveBeenCalled();
  });

  it("a failed recruiter-name read drops the chip, never invents a name", async () => {
    state.inFilter.mockResolvedValue({ data: null, error: { message: "denied" } });
    render(<HireCelebrationProvider />);
    await settle();
    act(() => send(1));
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Hire 1");
    expect(screen.getByRole("status")).not.toHaveTextContent("Recruited by");
  });

  it("retains a static readable screen with reduced motion and nonblocking decoration", () => {
    const css = readFileSync(resolve(process.cwd(), "src/components/celebrations/hire-celebration.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.hire-celebration-card\s*\{\s*animation: none/);
    expect(css).toMatch(/\.hire-celebration-balloons\s*\{\s*display: none/);
    expect(css).toContain("pointer-events: none");
    expect(css).not.toContain("infinite");
    expect(css).not.toMatch(/transition:\s*all|filter:|backdrop-filter:/);
  });
});
