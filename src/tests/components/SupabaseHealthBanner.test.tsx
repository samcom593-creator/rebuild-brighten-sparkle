/**
 * SupabaseHealthBanner.test.tsx
 *
 * Gaps covered:
 *   ✅ Renders nothing when health is "ok"
 *   ✅ Shows amber banner when health is "down"
 *   ✅ Dismiss button hides the banner
 *   ✅ Retry button re-triggers probe
 *   ✅ Banner auto-clears when probe recovers
 *   ✅ Probe fires after the intentional 30s cold-load delay
 *   ✅ Probe fires on 60s interval
 *
 * Missing / not yet tested:
 *   ❌ AbortController 6s timeout path
 *   ❌ "slow" state (requires mocking performance.now with high delta)
 *   ❌ Down-time duration label format (Xh Ym)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { supabase } from "@/integrations/supabase/client";
import { SupabaseHealthBanner } from "@/components/SupabaseHealthBanner";
import { BrowserRouter, Link } from "react-router-dom";

// MP-515: the banner is an ops instrument and now arms only for a signed-in
// session, so every test below has to say which session it is running as.
// Mocked rather than wrapped in a real <AuthProvider> because AuthContext is
// not exported and the provider would drag real auth bootstrapping into a unit
// test whose subject is the probe, not the session.
const auth = vi.hoisted(() => ({ user: { id: "test-user" } as { id: string } | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: auth.user }) }));

// The component calls: supabase.from("system_settings").select("key").limit(1).abortSignal(ctrl.signal)
// abortSignal returns a Promise<{ error }>.

function buildProbeChain(resolveValue: { error: null | object }, delayMs = 0) {
  const abortSignalMock = delayMs === 0
    ? vi.fn().mockResolvedValue(resolveValue)
    : vi.fn().mockReturnValue(new Promise<{ error: null | object }>((res) => setTimeout(() => res(resolveValue), delayMs)));
  return {
    select: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    abortSignal: abortSignalMock,
  };
}

function buildProbeChainRejected(delayMs = 0) {
  const abortSignalMock = delayMs === 0
    ? vi.fn().mockRejectedValue(new Error("probe failed"))
    : vi.fn().mockReturnValue(new Promise<never>((_, rej) => setTimeout(() => rej(new Error("probe failed")), delayMs)));
  return {
    select: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    abortSignal: abortSignalMock,
  };
}


// MP-519: the banner now lives inside <BrowserRouter> and reads useLocation(),
// so every render here needs a router. BrowserRouter reads window.location at
// mount, which is exactly how the cold-load cases below already set the route.
function renderBanner() {
  return render(
    <BrowserRouter>
      <SupabaseHealthBanner />
    </BrowserRouter>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  // MP-519: restore the default session here, not at the end of each test
  // body. A test that throws mid-body skips its own trailing restore and
  // leaves every later test running signed-out -- which is how one broken
  // line in this file reported 7 unrelated failures.
  auth.user = { id: "test-user" };
});

// MP-521: probe() now awaits the supabase client import BEFORE it arms the
// database timer, so settling a probe takes more microtask turns than the two
// hand-written `await Promise.resolve()` calls these helpers used to do. Two was
// already only just enough; one extra `await` in the component turned 4 of these
// tests red. Flushing a fixed generous number is the honest fix -- the count is
// not load-bearing, it just has to exceed the component's await depth.
async function flushMicrotasks(turns = 8) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

async function runInitialProbe() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_001);
    await flushMicrotasks();
  });
}

// MP-430: one failed probe is "slow", two consecutive failures are "down" —
// a single 6 s abort on a throttled link must not shout that the database is
// gone. The 60 s poll is the second probe.
async function runSecondProbe() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_001);
    await flushMicrotasks();
  });
}

async function settleProbe() {
  await act(async () => {
    await flushMicrotasks();
  });
}

describe("SupabaseHealthBanner — signed-out visitor", () => {
  // The contract this wave shipped, and the regression guard for it. On the
  // public landing page this banner used to mount ~36s in and displace the
  // whole page 61px (CLS 0.0741 against a 0.05 budget). A signed-out visitor
  // cannot act on "the database is slow", so the probe must never arm and the
  // banner must never appear — INCLUDING on a probe that would have failed,
  // which is the only case that could ever have rendered it.
  it("never probes and never renders, even when the probe would fail", async () => {
    auth.user = null;
    vi.mocked(supabase.from).mockReturnValue(buildProbeChainRejected(0) as any);
    const { container } = renderBanner();
    await runInitialProbe();
    await runSecondProbe();
    expect(vi.mocked(supabase.from).mock.calls.length).toBe(0);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Data connection/i)).toBeNull();
    auth.user = { id: "test-user" };
  });

  // M2 of this wave's mutation proof passed without this case, which means the
  // render guard was redundant-but-untested: with the probe gated, state never
  // leaves "ok", so `!user` in the return condition was never observable. It IS
  // observable on the real transition — an agent signed in while the backend is
  // degraded, then signs out. The banner must go with the session, or a
  // signed-out visitor keeps the outage bar (and its 61px of layout shift).
  it("clears the banner when the session ends mid-outage", async () => {
    auth.user = { id: "test-user" };
    vi.mocked(supabase.from).mockReturnValue(buildProbeChainRejected(0) as any);
    const { container, rerender } = renderBanner();
    await runInitialProbe();
    await runSecondProbe();
    expect(screen.queryByText(/Data connection/i)).not.toBeNull();

    auth.user = null;
    rerender(
      <BrowserRouter>
        <SupabaseHealthBanner />
      </BrowserRouter>
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Data connection/i)).toBeNull();
    auth.user = { id: "test-user" };
  });
});

describe("SupabaseHealthBanner — ok state", () => {
  it("renders nothing when probe succeeds immediately", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChain({ error: null }, 0) as any
    );
    const { container } = renderBanner();
    // Let probe resolve
    await runInitialProbe();
    expect(container.firstChild).toBeNull();
  });
});

describe("SupabaseHealthBanner — down state", () => {
  it("does NOT show the down banner after a single failed probe", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    renderBanner();
    await runInitialProbe();
    expect(screen.queryByText(/data connection down/i)).not.toBeInTheDocument();
  });

  it("shows banner when probe rejects", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    renderBanner();
    await runInitialProbe();
    await runSecondProbe();
    expect(screen.getByText(/data connection down/i)).toBeInTheDocument();
  });

  it("shows the 'not answering' message", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    renderBanner();
    await runInitialProbe();
    await runSecondProbe();
    expect(screen.getByText(/database is not answering/i)).toBeInTheDocument();
  });

  it("shows banner when probe returns a Supabase error object", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChain({ error: { message: "connection refused" } }, 0) as any
    );
    renderBanner();
    await runInitialProbe();
    await runSecondProbe();
    expect(screen.getByText(/data connection down/i)).toBeInTheDocument();
  });
});

describe("SupabaseHealthBanner — dismiss", () => {
  it("dismiss button removes the banner", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    renderBanner();
    await runInitialProbe();
    await runSecondProbe();
    fireEvent.click(screen.getByLabelText(/dismiss/i));
    expect(screen.queryByText(/data connection down/i)).not.toBeInTheDocument();
  });
});

describe("SupabaseHealthBanner — retry button", () => {
  it("clicking retry fires a new probe call", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    renderBanner();
    await runInitialProbe();

    const callsBefore = vi.mocked(supabase.from).mock.calls.length;
    // Set up a healthy probe for the retry
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChain({ error: null }, 0) as any
    );
    fireEvent.click(screen.getByLabelText(/retry now/i));
    await settleProbe();
    expect(vi.mocked(supabase.from).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("banner clears when retry probe succeeds", async () => {
    // First: down
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    renderBanner();
    await runInitialProbe();
    await runSecondProbe();

    // Retry with healthy probe
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChain({ error: null }, 0) as any
    );
    fireEvent.click(screen.getByLabelText(/retry now/i));
    await settleProbe();
    expect(screen.queryByText(/data connection down/i)).not.toBeInTheDocument();
  });
});

describe("SupabaseHealthBanner — polling interval", () => {
  it("fires a new probe after 60 seconds", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    renderBanner();
    // Initial probe
    await runInitialProbe();
    const callsAfterMount = vi.mocked(supabase.from).mock.calls.length;

    // Advance 60s for the interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60001);
      await Promise.resolve();
    });
    expect(vi.mocked(supabase.from).mock.calls.length).toBeGreaterThan(callsAfterMount);
  });
});

// MP-517: the login-route gap. MP-515 correctly disarmed the banner for
// signed-out visitors on the landing page (its layout-shift budget). But the
// people who "cannot get in" during a backend outage are signed-out visitors
// on /login, and they were shown only a bare auth-error toast. The banner now
// arms on auth routes for signed-out visitors too, with a fast first probe.
describe("SupabaseHealthBanner — signed-out visitor on the login route", () => {
  const realLocation = window.location;
  beforeEach(() => {
    auth.user = null;
    window.history.pushState({}, "", "/login");
  });
  afterEach(() => {
    window.history.pushState({}, "", "/");
    auth.user = { id: "test-user" };
  });

  async function runLoginProbes() {
    // signed-out firstDelay = 3s (slow), pollMs = 12s -> second probe = down
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_001);
      await flushMicrotasks();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_001);
      await flushMicrotasks();
    });
  }

  it("arms the probe and shows the login-safe outage message when the backend is down", async () => {
    vi.mocked(supabase.from).mockReturnValue(buildProbeChainRejected(0) as any);
    renderBanner();
    await runLoginProbes();
    expect(vi.mocked(supabase.from).mock.calls.length).toBeGreaterThan(0);
    expect(screen.queryByText(/not your email or password/i)).not.toBeNull();
  });

  it("clears itself the moment the backend recovers", async () => {
    vi.mocked(supabase.from).mockReturnValue(buildProbeChainRejected(0) as any);
    const { container } = renderBanner();
    await runLoginProbes();
    expect(screen.queryByText(/not your email or password/i)).not.toBeNull();
    // backend comes back; next probe succeeds -> banner clears. The async
    // timer variant flushes the probe's dynamic-import + resolved-value
    // microtask chain, which the sync variant + manual resolves does not.
    vi.mocked(supabase.from).mockReturnValue(buildProbeChain({ error: null }, 0) as any);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_001);
    });
    expect(container.firstChild).toBeNull();
  });

  it("still never renders for a signed-out visitor on the landing page", async () => {
    window.history.pushState({}, "", "/");
    vi.mocked(supabase.from).mockReturnValue(buildProbeChainRejected(0) as any);
    const { container } = renderBanner();
    await runLoginProbes();
    expect(vi.mocked(supabase.from).mock.calls.length).toBe(0);
    expect(container.firstChild).toBeNull();
  });
});

// MP-519: MP-517 armed the banner for signed-out visitors on /login, and every
// test above proves it by pushing "/login" into history BEFORE render — a cold
// load. That is not how most people reach that page. There are 10 in-app
// <Link to="/login"> sites, including the landing navbar (both the desktop and
// the mobile menu), and a <Link> navigates client-side: it calls
// history.pushState and re-renders the ROUTER's subtree. This banner is mounted
// outside <BrowserRouter> (App.tsx), read its route from window.location during
// render with nothing subscribed to it, and keyed its arming effect on [user]
// alone. So the visitor who clicks "Agent Login" during an outage got the
// disarmed banner and the bare "invalid login" toast MP-517 set out to replace.
//
// This test navigates the way the navbar does — a real <Link> click — rather
// than calling pushState directly, because pushState alone would also model a
// fix that only listens for popstate and would still miss every Link click.
describe("SupabaseHealthBanner — signed-out visitor who NAVIGATES to login", () => {
  beforeEach(() => {
    auth.user = null;
    window.history.pushState({}, "", "/");
  });
  afterEach(() => {
    window.history.pushState({}, "", "/");
    auth.user = { id: "test-user" };
  });

  it("arms the probe after an in-app Link click, not only on a cold load", async () => {
    vi.mocked(supabase.from).mockReturnValue(buildProbeChainRejected(0) as any);
    render(
      <BrowserRouter>
        <Link to="/login">Agent Login</Link>
        <SupabaseHealthBanner />
      </BrowserRouter>
    );

    // On the landing page, still correctly silent (MP-515 holds).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_001);
      await Promise.resolve();
    });
    expect(vi.mocked(supabase.from).mock.calls.length).toBe(0);

    // Click "Agent Login" exactly as the navbar does.
    await act(async () => {
      fireEvent.click(screen.getByText("Agent Login"), { button: 0 });
    });
    expect(window.location.pathname).toBe("/login");

    // The signed-out arm is firstDelay 3s then a 12s poll; two failures = down.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_001);
      await flushMicrotasks();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_001);
      await flushMicrotasks();
    });

    expect(vi.mocked(supabase.from).mock.calls.length).toBeGreaterThan(0);
    expect(screen.queryByText(/not your email or password/i)).not.toBeNull();
  });

  it("stops probing once the visitor navigates back off the auth route", async () => {
    vi.mocked(supabase.from).mockReturnValue(buildProbeChain({ error: null }, 0) as any);
    window.history.pushState({}, "", "/login");
    render(
      <BrowserRouter>
        <Link to="/">Home</Link>
        <SupabaseHealthBanner />
      </BrowserRouter>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_001);
      await Promise.resolve();
    });
    const armedCalls = vi.mocked(supabase.from).mock.calls.length;
    expect(armedCalls).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByText("Home"), { button: 0 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });
    // No further probes: a signed-out visitor off the auth route is disarmed.
    expect(vi.mocked(supabase.from).mock.calls.length).toBe(armedCalls);
  });
});

// MP-519: the runtime failure mode of hoisting this banner back out of the
// router is loud (useLocation() throws on mount), but nothing in CI watches
// where it is mounted, and App.tsx is edited far more often than this file.
// This asserts the mount position directly. It reads the source rather than
// rendering <App />, because rendering App drags the whole route table, the
// auth bootstrap and every lazy chunk into a unit test whose subject is one
// line of JSX ordering.
describe("SupabaseHealthBanner — mount position in App.tsx", () => {
  it("is mounted inside <BrowserRouter>, which is what makes it route-aware", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/App.tsx", "utf8");

    const routerAt = src.indexOf("<BrowserRouter>");
    const bannerAt = src.indexOf("<SupabaseHealthBanner />");
    const routerCloseAt = src.indexOf("</BrowserRouter>");

    // Guard the guard: if any anchor stops existing this test must fail loudly
    // rather than pass on three -1s comparing equal.
    expect(routerAt).toBeGreaterThan(-1);
    expect(bannerAt).toBeGreaterThan(-1);
    expect(routerCloseAt).toBeGreaterThan(-1);

    expect(bannerAt).toBeGreaterThan(routerAt);
    expect(bannerAt).toBeLessThan(routerCloseAt);
  });
});

// MP-521: the probe used to load its own supabase client INSIDE the span it
// blames on the database — the 6000ms AbortController and the performance.now()
// sample feeding the `ms > 3000` "slow" bar both started above `await import()`.
// Measured on the live landing page, where this probe is the first importer of
// the 44.8KB gz vendor-supabase chunk: at 2G it computed 5361ms of which 5278ms
// was its own download while the query took 85ms, and on a slower link the import
// alone blew the 6000ms abort and rendered "The database is not answering".
//
// These two cases are the ones that go RED on the old ordering. Every other test
// in this file passes either way, so they cannot speak for this fix.
describe("SupabaseHealthBanner — a failure to load our own client is not a database verdict", () => {
  afterEach(() => {
    vi.doUnmock("@/integrations/supabase/client");
    vi.resetModules();
  });

  it("stays silent when the client chunk cannot be loaded at all", async () => {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client", () => {
      throw new Error("Failed to fetch dynamically imported module");
    });

    renderBanner();
    await runInitialProbe();
    await runSecondProbe();

    // Old ordering: the import threw inside the timed try, so the outer catch
    // counted it as a failed probe — two of them reach "down" and assert that
    // Postgres is gone on the strength of a chunk this app failed to download.
    expect(screen.queryByText(/data connection down/i)).toBeNull();
    expect(screen.queryByText(/not answering/i)).toBeNull();
    expect(screen.queryByText(/data connection slow/i)).toBeNull();
  });

  it("does not spend a failure strike on an unloadable client", async () => {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client", () => {
      throw new Error("Failed to fetch dynamically imported module");
    });

    renderBanner();
    await runInitialProbe();
    await runSecondProbe();
    await runSecondProbe();

    // Three probes that could not look must leave the verdict untouched rather
    // than escalating. If the strike were spent, the banner would be mounted by
    // now and the whole point of the split would be lost.
    expect(document.querySelector(".bg-amber-500\\/95")).toBeNull();
  });
});
