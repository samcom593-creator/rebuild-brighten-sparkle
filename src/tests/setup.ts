/**
 * Vitest global test setup.
 * Runs before every test file.
 */
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, vi } from "vitest";

// Cleanup React Testing Library mounts after each test
afterEach(() => {
  cleanup();
});

// ── Supabase client mock ─────────────────────────────────────────────────────
// All tests that import @/integrations/supabase/client get this mock by default.
// Individual tests can override specific methods via vi.mocked().
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      abortSignal: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: vi.fn(),
    })),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
}));

// ── Browser API stubs ────────────────────────────────────────────────────────
beforeAll(() => {
  // crypto.randomUUID is available in Node 19+ but add a fallback for older envs
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: () => "test-uuid-" + Math.random().toString(36).slice(2) },
    });
  }

  // sessionStorage / localStorage are already available via jsdom

  // Mock performance.now
  if (!globalThis.performance?.now) {
    Object.defineProperty(globalThis, "performance", {
      value: { now: vi.fn(() => Date.now()) },
    });
  }
});
