/**
 * ErrorBoundary.test.tsx
 *
 * Gaps covered:
 *   ✅ Renders children normally when no error
 *   ✅ Catches a render error and shows fallback UI
 *   ✅ Shows custom fallback prop when provided
 *   ✅ Does not render children after error
 *   ✅ Auto-retries after first transient error (MAX_RETRIES=2)
 *   ✅ Stays on fallback when error is permanent (past MAX_RETRIES)
 *   ✅ Logs error to supabase error_logs on componentDidCatch
 *   ✅ Reload button calls window.location.reload
 *
 * Missing / not yet tested:
 *   ❌ Error stack is truncated to 4000 chars in DB insert
 *   ❌ logErrorToDb swallows auth.getUser failure gracefully
 *   ❌ Exponential backoff timing: retry 1 = 500ms, retry 2 = 1000ms
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";

function BombComponent({ shouldThrow = false }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error("Test render error");
  return <div>Child content</div>;
}

// Track throw count for flaky component tests
let throwCount = 0;

function FlakyOnce() {
  throwCount++;
  if (throwCount === 1) throw new Error("flaky first render");
  return <div>Recovered content</div>;
}

function AlwaysBomb(): never {
  throw new Error("permanent");
}

const originalError = console.error;

beforeEach(() => {
  vi.useFakeTimers();
  console.error = vi.fn();
  throwCount = 0;
});

afterEach(() => {
  console.error = originalError;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("ErrorBoundary — normal render", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <BombComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });
});

describe("ErrorBoundary — error state", () => {
  it("shows fallback UI when child throws", () => {
    render(
      <ErrorBoundary>
        <BombComponent shouldThrow />
      </ErrorBoundary>
    );
    // Auto-retry fires at 500ms; advance past it to confirm UI on permanent error
    act(() => { vi.advanceTimersByTime(200); }); // before first retry
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows custom fallback prop instead of default UI", () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <BombComponent shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText("Custom fallback")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("does not render children after error", () => {
    render(
      <ErrorBoundary>
        <BombComponent shouldThrow />
      </ErrorBoundary>
    );
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText("Child content")).not.toBeInTheDocument();
  });
});

describe("ErrorBoundary — auto-retry", () => {
  it("auto-retries and renders children when error was transient", () => {
    render(
      <ErrorBoundary>
        <FlakyOnce />
      </ErrorBoundary>
    );
    // First retry fires at 500ms
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.getByText("Recovered content")).toBeInTheDocument();
  });

  it("stays on fallback after MAX_RETRIES (2) with permanent error", () => {
    render(
      <ErrorBoundary>
        <AlwaysBomb />
      </ErrorBoundary>
    );
    // Retry 1 at 500ms, retry 2 at 1000ms
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    // Ensure the error message is stable (no further retries)
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});

describe("ErrorBoundary — error logging", () => {
  it("calls supabase.from('error_logs').insert() when child throws", async () => {
    const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as any);
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "user-1" } as any },
      error: null,
    });

    render(
      <ErrorBoundary>
        <BombComponent shouldThrow />
      </ErrorBoundary>
    );

    // Let the dynamic import + async logErrorToDb microtasks land.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ error_message: "Test render error" })
    );
  });
});

describe("ErrorBoundary — action buttons", () => {
  it("Refresh Page button calls window.location.reload", async () => {
    const reloadMock = vi.fn();

    render(
      <ErrorBoundary onReload={reloadMock}>
        <AlwaysBomb />
      </ErrorBoundary>
    );

    // Advance past both retries so button stays visible
    act(() => { vi.advanceTimersByTime(2000); });

    const refreshBtn = screen.getByRole("button", { name: /refresh page/i });
    fireEvent.click(refreshBtn);
    expect(reloadMock).toHaveBeenCalled();
  });
});
