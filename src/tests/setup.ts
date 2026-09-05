/**
 * Vitest global test setup.
 * Runs before every test file.
 */
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, vi } from "vitest";

// ── Web Storage restoration (MP-437) ─────────────────────────────────────────
// MEASURED, not assumed: jsdom 26.1.0 ships a fully working localStorage
// (direct instantiation round-trips setItem/getItem). What breaks it is the
// HOST runtime. Node >= 22.4 defines its own `globalThis.localStorage` as a
// non-enumerable native getter that is inert unless the process was started
// with --localstorage-file, and it shadows the jsdom implementation that
// vitest's jsdom environment would otherwise expose. Result on Node 26:
// `window.localStorage` reads back `undefined`, every `localStorage.clear()`
// in a beforeEach throws "Cannot read properties of undefined", and 38 tests
// across offlineDealSync / featureFlags / GlobalSidebar go red — while the
// SAME tree is 993-green on Node 22.12 and on CI's Node 20, which predate
// that global. Not one of those failures was a product bug.
//
// INSTALLED ONLY WHEN ABSENT, deliberately. On Node 20 and Node 22 the real
// jsdom Storage is present and is left completely untouched, so a genuine
// jsdom regression still fails loudly instead of being masked by a stand-in.
// This shim exists to undo a host-runtime collision, never to substitute for
// a browser API that was supposed to be there.
function installStorageIfAbsent(name: "localStorage" | "sessionStorage"): void {
  const present = (() => {
    try {
      return Boolean((window as unknown as Record<string, unknown>)[name]);
    } catch {  // empty-catch-allow:storage-probe
      // Private-mode-style throwing accessor: treat as absent.
      return false;
    }
  })();
  if (present) return;

  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(String(key)) ? store.get(String(key))! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(String(key)),
    setItem: (key: string, value: string) => void store.set(String(key), String(value)),
  };

  // Node's descriptor is configurable, so redefining it is legal and scoped to
  // this test process. Both surfaces are defined because product code reads it
  // both ways: offlineQueue.ts via `window.localStorage`, featureFlags.ts via
  // the bare `localStorage` global.
  Object.defineProperty(window, name, { value: storage, configurable: true, writable: true });
  if ((globalThis as unknown) !== (window as unknown)) {
    Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
  }
}

// Top level, not inside beforeAll: setupFiles run before the test module is
// imported, so this covers a module that touches storage at import time.
installStorageIfAbsent("localStorage");
installStorageIfAbsent("sessionStorage");

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

  // sessionStorage / localStorage: see installStorageIfAbsent() above. The
  // claim that once sat here — "already available via jsdom" — was true
  // until the host runtime grew a shadowing global of its own.

  // Mock performance.now
  if (!globalThis.performance?.now) {
    Object.defineProperty(globalThis, "performance", {
      value: { now: vi.fn(() => Date.now()) },
    });
  }
});
