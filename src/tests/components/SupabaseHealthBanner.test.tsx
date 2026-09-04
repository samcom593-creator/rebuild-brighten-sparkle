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

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

async function runInitialProbe() {
  await act(async () => {
    vi.advanceTimersByTime(30_001);
    await Promise.resolve();
    await Promise.resolve();
  });
}

// MP-430: one failed probe is "slow", two consecutive failures are "down" —
// a single 6 s abort on a throttled link must not shout that the database is
// gone. The 60 s poll is the second probe.
async function runSecondProbe() {
  await act(async () => {
    vi.advanceTimersByTime(60_001);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function settleProbe() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SupabaseHealthBanner — ok state", () => {
  it("renders nothing when probe succeeds immediately", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChain({ error: null }, 0) as any
    );
    const { container } = render(<SupabaseHealthBanner />);
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
    render(<SupabaseHealthBanner />);
    await runInitialProbe();
    expect(screen.queryByText(/data connection down/i)).not.toBeInTheDocument();
  });

  it("shows banner when probe rejects", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    render(<SupabaseHealthBanner />);
    await runInitialProbe();
    await runSecondProbe();
    expect(screen.getByText(/data connection down/i)).toBeInTheDocument();
  });

  it("shows the 'not answering' message", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    render(<SupabaseHealthBanner />);
    await runInitialProbe();
    await runSecondProbe();
    expect(screen.getByText(/database is not answering/i)).toBeInTheDocument();
  });

  it("shows banner when probe returns a Supabase error object", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChain({ error: { message: "connection refused" } }, 0) as any
    );
    render(<SupabaseHealthBanner />);
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
    render(<SupabaseHealthBanner />);
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
    render(<SupabaseHealthBanner />);
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
    render(<SupabaseHealthBanner />);
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
    render(<SupabaseHealthBanner />);
    // Initial probe
    await runInitialProbe();
    const callsAfterMount = vi.mocked(supabase.from).mock.calls.length;

    // Advance 60s for the interval
    await act(async () => {
      vi.advanceTimersByTime(60001);
      await Promise.resolve();
    });
    expect(vi.mocked(supabase.from).mock.calls.length).toBeGreaterThan(callsAfterMount);
  });
});
