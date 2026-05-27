/**
 * SupabaseHealthBanner.test.tsx
 *
 * Gaps covered:
 *   ✅ Renders nothing when health is "ok"
 *   ✅ Shows amber banner when health is "down"
 *   ✅ Dismiss button hides the banner
 *   ✅ Retry button re-triggers probe
 *   ✅ Banner auto-clears when probe recovers
 *   ✅ Probe fires on mount
 *   ✅ Probe fires on 60s interval
 *
 * Missing / not yet tested:
 *   ❌ AbortController 6s timeout path
 *   ❌ "slow" state (requires mocking performance.now with high delta)
 *   ❌ Down-time duration label format (Xh Ym)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabase } from "@/integrations/supabase/client";
import { SupabaseHealthBanner } from "@/components/SupabaseHealthBanner";

// The component calls: supabase.from("system_settings").select("key").limit(1).abortSignal(ctrl.signal)
// abortSignal returns a Promise<{ error }>.

function buildProbeChain(resolveValue: { error: null | object }, delayMs = 0) {
  const abortSignalMock = vi.fn().mockReturnValue(
    new Promise<{ error: null | object }>((res) => setTimeout(() => res(resolveValue), delayMs))
  );
  return {
    select: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    abortSignal: abortSignalMock,
  };
}

function buildProbeChainRejected(delayMs = 0) {
  const abortSignalMock = vi.fn().mockReturnValue(
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("probe failed")), delayMs))
  );
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

describe("SupabaseHealthBanner — ok state", () => {
  it("renders nothing when probe succeeds immediately", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChain({ error: null }, 0) as any
    );
    const { container } = render(<SupabaseHealthBanner />);
    // Let probe resolve
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });
    expect(container.firstChild).toBeNull();
  });
});

describe("SupabaseHealthBanner — down state", () => {
  it("shows banner when probe rejects", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    render(<SupabaseHealthBanner />);
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText(/supabase down/i)).toBeInTheDocument();
    });
  });

  it("shows 'unresponsive' message", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    render(<SupabaseHealthBanner />);
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText(/postgres data plane unresponsive/i)).toBeInTheDocument();
    });
  });

  it("shows banner when probe returns a Supabase error object", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChain({ error: { message: "connection refused" } }, 0) as any
    );
    render(<SupabaseHealthBanner />);
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText(/supabase down/i)).toBeInTheDocument();
    });
  });
});

describe("SupabaseHealthBanner — dismiss", () => {
  it("dismiss button removes the banner", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    render(<SupabaseHealthBanner />);
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });
    await waitFor(() => screen.getByLabelText(/dismiss/i));
    await userEvent.click(screen.getByLabelText(/dismiss/i));
    expect(screen.queryByText(/supabase down/i)).not.toBeInTheDocument();
  });
});

describe("SupabaseHealthBanner — retry button", () => {
  it("clicking retry fires a new probe call", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    render(<SupabaseHealthBanner />);
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });
    await waitFor(() => screen.getByLabelText(/retry now/i));

    const callsBefore = vi.mocked(supabase.from).mock.calls.length;
    // Set up a healthy probe for the retry
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChain({ error: null }, 0) as any
    );
    await userEvent.click(screen.getByLabelText(/retry now/i));
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });
    expect(vi.mocked(supabase.from).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("banner clears when retry probe succeeds", async () => {
    // First: down
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    render(<SupabaseHealthBanner />);
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });
    await waitFor(() => screen.getByLabelText(/retry now/i));

    // Retry with healthy probe
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChain({ error: null }, 0) as any
    );
    await userEvent.click(screen.getByLabelText(/retry now/i));
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByText(/supabase down/i)).not.toBeInTheDocument();
    });
  });
});

describe("SupabaseHealthBanner — polling interval", () => {
  it("fires a new probe after 60 seconds", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      buildProbeChainRejected(0) as any
    );
    render(<SupabaseHealthBanner />);
    // Initial probe
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });
    const callsAfterMount = vi.mocked(supabase.from).mock.calls.length;

    // Advance 60s for the interval
    await act(async () => {
      vi.advanceTimersByTime(60001);
      await Promise.resolve();
    });
    expect(vi.mocked(supabase.from).mock.calls.length).toBeGreaterThan(callsAfterMount);
  });
});
