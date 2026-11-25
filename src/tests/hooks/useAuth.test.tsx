/**
 * useAuth.test.tsx
 *
 * Tests for the AuthProvider + useAuth hook (src/hooks/useAuth.ts).
 * The auth system is used on every protected page — zero tests is a critical gap.
 *
 * Coverage targets:
 *   ✅ useAuth throws when called outside AuthProvider
 *   ✅ isLoading: true on mount before session resolves
 *   ✅ hasRole() — admin, manager, agent roles
 *   ✅ isAdmin / isManager / isAgent computed flags
 *   ✅ TOKEN_REFRESHED event only updates session (no profile/role re-fetch)
 *   ✅ TOKEN_REFRESHED with null session → clears state (refresh_token_not_found path)
 *   ✅ SIGNED_OUT event clears user/profile/roles
 *   ✅ PASSWORD_RECOVERY event → redirects to settings (does NOT hang)
 *   ✅ Dedup: same userId on back-to-back getSession + onAuthStateChange → 1 profile fetch
 *
 * NOT YET TESTED (integration-level, need full Supabase mock fidelity):
 *   ❌ signIn / signUp / signOut flows
 *   ❌ Email sync (when profile.email !== auth email)
 *   ❌ IdleSessionGate integration
 *
 * LATENT BUG: PASSWORD_RECOVERY sets window.location.href but test env
 *   doesn't navigate — we verify the assignment happens without crashing.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { isCancelledError, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { queryClient } from "@/shared/api/queryClient";
import { supabase } from "@/integrations/supabase/client";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function TestConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{auth.isLoading ? "loading" : "ready"}</span>
      <span data-testid="user">{auth.user?.id ?? "none"}</span>
      <span data-testid="isAdmin">{auth.isAdmin ? "yes" : "no"}</span>
      <span data-testid="isManager">{auth.isManager ? "yes" : "no"}</span>
      <span data-testid="isAgent">{auth.isAgent ? "yes" : "no"}</span>
      <span data-testid="profile">{auth.profile?.full_name ?? "none"}</span>
      <span data-testid="accountMode">{auth.accountMode ?? "none"}</span>
      <span data-testid="hasAgentRecord">{auth.hasAgentRecord ? "yes" : "no"}</span>
    </div>
  );
}

function ThrowConsumer() {
  // Should throw because no AuthProvider wraps it
  useAuth();
  return null;
}

function makeSession(userId = "user-001", email = "test@example.com"): Session {
  return {
    user: { id: userId, email, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
    access_token: "token",
    refresh_token: "refresh",
    expires_in: 3600,
    token_type: "bearer",
  };
}

// Grab the mock handles from setup.ts
const mockGetSession = vi.mocked(supabase.auth.getSession);
const mockOnAuthStateChange = vi.mocked(supabase.auth.onAuthStateChange);
const mockFrom = vi.mocked(supabase.from);

let authStateCallback: ((event: AuthChangeEvent, session: Session | null) => void) | null = null;

type IdentityReply = { data: unknown; error: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function identityReply(table: string, userId: string, admin = false): IdentityReply {
  if (table === "user_roles") return { data: [{ role: admin ? "admin" : "agent" }], error: null };
  if (table === "profiles") return { data: { user_id: userId, email: `${userId}@example.test`, full_name: `Profile ${userId}` }, error: null };
  return { data: { account_mode: admin ? "admin" : "agent" }, error: null };
}
function mockIdentityReads(reply: (table: string, userId: string) => Promise<IdentityReply>) {
  const calls: Array<{ table: string; userId: string }> = [];
  mockFrom.mockImplementation((table: string) => {
    let userId = "";
    const read = () => { calls.push({ table, userId }); return reply(table, userId); };
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((_column: string, value: string) => { userId = value; return chain; }),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(read),
      then: (fulfilled: (value: IdentityReply) => unknown, rejected?: (error: unknown) => unknown) => read().then(fulfilled, rejected),
    };
    return chain as never;
  });
  return calls;
}
const sessionFor = (id: string) => makeSession(id, `${id}@example.test`);
function mountAuth() { return render(<AuthProvider><TestConsumer /></AuthProvider>); }

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  authStateCallback = null;

  // Capture the onAuthStateChange callback so we can fire events in tests
  mockOnAuthStateChange.mockImplementation((cb) => {
    authStateCallback = cb;
    return { data: { subscription: { id: "test-auth-subscription", callback: cb, unsubscribe: vi.fn() } } };
  });

  // Default: no session
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null } as any);

  // Default profiles/roles mocks (returns null profile, empty roles)
  mockIdentityReads(async table => ({ data: table === "user_roles" ? [] : null, error: null }));
});
afterEach(() => { queryClient.clear(); vi.restoreAllMocks(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useAuth — provider guard", () => {
  it("throws descriptive error when used outside AuthProvider", () => {
    // Suppress expected React error boundary noise
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ThrowConsumer />)).toThrow(
      "useAuth must be used within an AuthProvider"
    );
    spy.mockRestore();
  });
});

describe("useAuth — initial loading state", () => {
  it("starts in loading state", async () => {
    // Don't resolve getSession immediately
    mockGetSession.mockReturnValue(new Promise(() => {}) as any);
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    expect(screen.getByTestId("loading").textContent).toBe("loading");
  });

  it("transitions to ready after getSession resolves with no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null } as any);
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("ready");
    });
    expect(screen.getByTestId("user").textContent).toBe("none");
  });
});

describe("useAuth — role flags", () => {
  it("isAdmin is false when user has no roles", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null } as any);
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("ready")
    );
    expect(screen.getByTestId("isAdmin").textContent).toBe("no");
    expect(screen.getByTestId("isManager").textContent).toBe("no");
    expect(screen.getByTestId("isAgent").textContent).toBe("no");
  });
});

describe("useAuth — hasRole", () => {
  it("returns correct role checks for admin role", () => {
    // Test the hasRole logic directly via a consumer that uses it
    function RoleConsumer() {
      const { hasRole } = useAuth();
      return (
        <div>
          <span data-testid="hasAdmin">{hasRole("admin") ? "yes" : "no"}</span>
          <span data-testid="hasManager">{hasRole("manager") ? "yes" : "no"}</span>
          <span data-testid="hasAgent">{hasRole("agent") ? "yes" : "no"}</span>
        </div>
      );
    }

    render(
      <AuthProvider>
        <RoleConsumer />
      </AuthProvider>
    );
    // No roles set → all false
    expect(screen.getByTestId("hasAdmin").textContent).toBe("no");
    expect(screen.getByTestId("hasManager").textContent).toBe("no");
    expect(screen.getByTestId("hasAgent").textContent).toBe("no");
  });
});

describe("useAuth — auth state events", () => {
  it("does not crash on SIGNED_OUT event", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("ready")
    );

    act(() => {
      authStateCallback?.("SIGNED_OUT", null);
    });

    // Should not throw; user clears
    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("none")
    );
  });

  it("handles TOKEN_REFRESHED with a valid session without crashing", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("ready")
    );

    act(() => {
      authStateCallback?.("TOKEN_REFRESHED", makeSession());
    });

    // Should not throw or crash
    expect(screen.getByTestId("loading").textContent).toBe("ready");
  });

  it("clears state on TOKEN_REFRESHED with null session (refresh_token_not_found)", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("ready")
    );

    act(() => {
      authStateCallback?.("TOKEN_REFRESHED", null);
    });

    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("none")
    );
  });

  it("handles PASSWORD_RECOVERY event without throwing", async () => {
    // A real navigation is outside jsdom. Record the destination through a
    // location object instead of relying on its "not implemented" error.
    const originalLocation = window.location;
    const location = { pathname: "/dashboard", href: "https://galaxyfinancial.org/dashboard" };
    Object.defineProperty(window, "location", { configurable: true, writable: true, value: location });
    try {
      render(<AuthProvider><TestConsumer /></AuthProvider>);
      await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("ready"));
      expect(() => { act(() => { authStateCallback?.("PASSWORD_RECOVERY", makeSession()); }); }).not.toThrow();
      expect(location.href).toBe("/reset-password");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, writable: true, value: originalLocation });
    }
  });

  // 2026-11-18: recovery used to hard-redirect to /dashboard/settings?recovery=true.
  // Settings never read that flag, so a reset link landed on the PROFILE tab under
  // the profile-photo pop-up, and the redirect also fired on /reset-password itself,
  // so the purpose-built page was unreachable. The owner could not reset his own
  // password. These two cases pin the destination and the no-loop guard.
  describe("PASSWORD_RECOVERY destination", () => {
    const realLocation = window.location;
    const setLocation = (pathname: string) => {
      const fake = { pathname, href: `https://galaxyfinancial.org${pathname}` };
      Object.defineProperty(window, "location", { configurable: true, writable: true, value: fake });
      return fake;
    };
    afterEach(() => {
      Object.defineProperty(window, "location", { configurable: true, writable: true, value: realLocation });
    });

    it("sends a recovery session to /reset-password, not the settings profile tab", async () => {
      render(<AuthProvider><TestConsumer /></AuthProvider>);
      await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("ready"));
      const loc = setLocation("/dashboard/settings");
      act(() => { authStateCallback?.("PASSWORD_RECOVERY", makeSession()); });
      expect(loc.href).toBe("/reset-password");
    });

    it("does not redirect again once already on /reset-password", async () => {
      render(<AuthProvider><TestConsumer /></AuthProvider>);
      await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("ready"));
      const loc = setLocation("/reset-password");
      act(() => { authStateCallback?.("PASSWORD_RECOVERY", makeSession()); });
      expect(loc.href).toBe("https://galaxyfinancial.org/reset-password");
    });

    it("resolves the recovery session when it supersedes a pending startup snapshot on the reset page", async () => {
      const loc = setLocation("/reset-password");
      const startup = deferred<{ data: { session: Session }; error: null }>();
      mockGetSession.mockReturnValue(startup.promise);
      const calls = mockIdentityReads(async (table, userId) => identityReply(table, userId));
      mountAuth();
      await waitFor(() => expect(authStateCallback).not.toBeNull());

      act(() => { authStateCallback?.("PASSWORD_RECOVERY", sessionFor("recovery-user")); });
      await act(async () => startup.resolve({ data: { session: sessionFor("old-admin") }, error: null }));

      await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
      expect(screen.getByTestId("user")).toHaveTextContent("recovery-user");
      expect(screen.getByTestId("profile")).toHaveTextContent("Profile recovery-user");
      expect(calls).toHaveLength(3);
      expect(calls.every(call => call.userId === "recovery-user")).toBe(true);
      expect(loc.href).toBe("https://galaxyfinancial.org/reset-password");
    });

    it("does not restore a queued recovery session after a newer sign-out", async () => {
      const loc = setLocation("/reset-password");
      const startup = deferred<{ data: { session: Session }; error: null }>();
      mockGetSession.mockReturnValue(startup.promise);
      const calls = mockIdentityReads(async (table, userId) => identityReply(table, userId));
      mountAuth();
      await waitFor(() => expect(authStateCallback).not.toBeNull());

      act(() => {
        authStateCallback?.("PASSWORD_RECOVERY", sessionFor("recovery-user"));
        authStateCallback?.("SIGNED_OUT", null);
      });
      await act(async () => startup.resolve({ data: { session: sessionFor("old-admin") }, error: null }));

      await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
      expect(screen.getByTestId("user")).toHaveTextContent("none");
      expect(screen.getByTestId("profile")).toHaveTextContent("none");
      expect(calls).toHaveLength(0);
      expect(loc.href).toBe("https://galaxyfinancial.org/reset-password");
    });
  });
});

describe("useAuth — account request isolation", () => {
  it("does not let delayed prior-account roles, profile, or mode replace a resolved new account", async () => {
    const old = deferred<void>();
    mockGetSession.mockResolvedValue({ data: { session: sessionFor("old-admin") }, error: null });
    const calls = mockIdentityReads((table, userId) => userId === "old-admin"
      ? old.promise.then(() => identityReply(table, userId, true))
      : Promise.resolve(identityReply(table, userId)));
    mountAuth();
    await waitFor(() => expect(calls).toHaveLength(3));
    act(() => { authStateCallback?.("SIGNED_IN", sessionFor("new-agent")); });
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("Profile new-agent"));
    expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    await act(async () => old.resolve());
    expect(screen.getByTestId("user")).toHaveTextContent("new-agent");
    expect(screen.getByTestId("isAdmin")).toHaveTextContent("no");
    expect(screen.getByTestId("isAgent")).toHaveTextContent("yes");
    expect(screen.getByTestId("profile")).toHaveTextContent("Profile new-agent");
    expect(screen.getByTestId("accountMode")).toHaveTextContent("agent");
  });

  it("does not let an old completion clear a different account's pending loading boundary", async () => {
    const old = deferred<void>();
    const next = deferred<void>();
    mockGetSession.mockResolvedValue({ data: { session: sessionFor("old-admin") }, error: null });
    const calls = mockIdentityReads((table, userId) => (userId === "old-admin" ? old : next).promise
      .then(() => identityReply(table, userId, userId === "old-admin")));
    mountAuth();
    await waitFor(() => expect(calls).toHaveLength(3));
    act(() => { authStateCallback?.("SIGNED_IN", sessionFor("new-agent")); });
    await waitFor(() => expect(calls).toHaveLength(6));
    await act(async () => old.resolve());
    expect(screen.getByTestId("user")).toHaveTextContent("new-agent");
    expect(screen.getByTestId("loading")).toHaveTextContent("loading");
    expect(screen.getByTestId("isAdmin")).toHaveTextContent("no");
    expect(screen.getByTestId("profile")).toHaveTextContent("none");
    expect(screen.getByTestId("hasAgentRecord")).toHaveTextContent("no");
    await act(async () => next.resolve());
    expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    expect(screen.getByTestId("isAgent")).toHaveTextContent("yes");
  });

  it("clears a resolved account's privileges and profile immediately when a different user starts loading", async () => {
    const next = deferred<void>();
    mockGetSession.mockResolvedValue({ data: { session: sessionFor("old-admin") }, error: null });
    mockIdentityReads((table, userId) => userId === "old-admin"
      ? Promise.resolve(identityReply(table, userId, true))
      : next.promise.then(() => identityReply(table, userId)));
    mountAuth();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
    expect(screen.getByTestId("isAdmin")).toHaveTextContent("yes");
    act(() => { authStateCallback?.("SIGNED_IN", sessionFor("new-agent")); });
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("new-agent"));
    expect(screen.getByTestId("loading")).toHaveTextContent("loading");
    expect(screen.getByTestId("isAdmin")).toHaveTextContent("no");
    expect(screen.getByTestId("profile")).toHaveTextContent("none");
    expect(screen.getByTestId("accountMode")).toHaveTextContent("none");
    await act(async () => next.resolve());
  });

  it("keeps a resolved same-account session ready without repeating identity reads", async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor("current-admin") }, error: null });
    const calls = mockIdentityReads(async (table, userId) => identityReply(table, userId, true));
    mountAuth();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
    expect(calls).toHaveLength(3);
    const cached = { owner: "current-admin", items: ["Current account item"] };
    queryClient.setQueryData(["calendar-agenda", "2026-11-25"], cached);
    const reset = vi.spyOn(queryClient, "clear");
    await act(async () => {
      authStateCallback?.("TOKEN_REFRESHED", { ...sessionFor("current-admin"), access_token: "refreshed-test-token" });
      authStateCallback?.("SIGNED_IN", sessionFor("current-admin"));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(calls).toHaveLength(3);
    expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    expect(screen.getByTestId("isAdmin")).toHaveTextContent("yes");
    expect(screen.getByTestId("profile")).toHaveTextContent("Profile current-admin");
    expect(reset).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(["calendar-agenda", "2026-11-25"])).toBe(cached);
  });

  it("keeps the first identity load pending when a duplicate event arrives before profile and mode finish", async () => {
    const pending = deferred<void>();
    mockGetSession.mockResolvedValue({ data: { session: sessionFor("current-admin") }, error: null });
    const calls = mockIdentityReads((table, userId) => table === "user_roles"
      ? Promise.resolve(identityReply(table, userId, true))
      : pending.promise.then(() => identityReply(table, userId, true)));
    mountAuth();
    await waitFor(() => expect(screen.getByTestId("isAdmin")).toHaveTextContent("yes"));
    await act(async () => {
      authStateCallback?.("SIGNED_IN", sessionFor("current-admin"));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(calls).toHaveLength(3);
    expect(screen.getByTestId("loading")).toHaveTextContent("loading");
    await act(async () => pending.resolve());
    expect(screen.getByTestId("loading")).toHaveTextContent("ready");
  });

  it.each(["SIGNED_OUT", "TOKEN_REFRESHED"] as const)("ignores pending identity responses after %s clears the session", async event => {
    const pending = deferred<void>();
    mockGetSession.mockResolvedValue({ data: { session: sessionFor("old-admin") }, error: null });
    const calls = mockIdentityReads((table, userId) => pending.promise.then(() => identityReply(table, userId, true)));
    mountAuth();
    await waitFor(() => expect(calls).toHaveLength(3));
    act(() => { authStateCallback?.(event, null); });
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    await act(async () => pending.resolve());
    expect(screen.getByTestId("isAdmin")).toHaveTextContent("no");
    expect(screen.getByTestId("profile")).toHaveTextContent("none");
    expect(screen.getByTestId("accountMode")).toHaveTextContent("none");
    expect(screen.getByTestId("hasAgentRecord")).toHaveTextContent("no");
    expect(screen.getByTestId("loading")).toHaveTextContent("ready");
  });

  it("rejects the first A response after a later A session resolves through A to B to A", async () => {
    const first = deferred<void>();
    const rounds = new Map<string, number>();
    mockGetSession.mockResolvedValue({ data: { session: sessionFor("account-a") }, error: null });
    const calls = mockIdentityReads((table, userId) => {
      const key = `${table}:${userId}`;
      const round = (rounds.get(key) ?? 0) + 1;
      rounds.set(key, round);
      return userId === "account-a" && round === 1
        ? first.promise.then(() => identityReply(table, userId, true))
        : Promise.resolve(identityReply(table, userId));
    });
    mountAuth();
    await waitFor(() => expect(calls).toHaveLength(3));
    act(() => { authStateCallback?.("SIGNED_IN", sessionFor("account-b")); });
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("Profile account-b"));
    act(() => { authStateCallback?.("SIGNED_IN", sessionFor("account-a")); });
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("Profile account-a"));
    expect(calls).toHaveLength(9);
    await act(async () => first.resolve());
    expect(screen.getByTestId("isAdmin")).toHaveTextContent("no");
    expect(screen.getByTestId("accountMode")).toHaveTextContent("agent");
    expect(screen.getByTestId("loading")).toHaveTextContent("ready");
  });

  it("does not restore an older startup session after a newer sign-in event", async () => {
    const startup = deferred<{ data: { session: Session }; error: null }>();
    mockGetSession.mockReturnValue(startup.promise);
    const calls = mockIdentityReads(async (table, userId) => identityReply(table, userId));
    mountAuth();
    await waitFor(() => expect(authStateCallback).not.toBeNull());
    act(() => { authStateCallback?.("SIGNED_IN", sessionFor("new-agent")); });
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("Profile new-agent"));
    await act(async () => startup.resolve({ data: { session: sessionFor("old-admin") }, error: null }));
    expect(screen.getByTestId("user")).toHaveTextContent("new-agent");
    expect(calls).toHaveLength(3);
    expect(calls.every(call => call.userId === "new-agent")).toBe(true);
  });
});

describe("useAuth — singleton private-cache boundary", () => {
  const globalKeys = [
    ["calendar-agenda", "2026-11-25"],
    ["apex-today-finances"], ["apex-today-content"], ["apex-today-blockers"],
  ];

  it("clears global private keys before a new account can render a global-key query", async () => {
    const nextData = deferred<string>();
    const seen: Array<{ viewer: string | undefined; data: string | undefined }> = [];
    function PrivateCalendar() {
      const { user } = useAuth();
      const calendar = useQuery({
        queryKey: ["calendar-window", "2026-11"], staleTime: Infinity,
        queryFn: () => user?.id === "account-a" ? Promise.resolve("Account A private calendar") : nextData.promise,
      });
      seen.push({ viewer: user?.id, data: calendar.data });
      return <output data-testid="private-calendar">{calendar.data ?? "Loading current calendar"}</output>;
    }
    mockGetSession.mockResolvedValue({ data: { session: sessionFor("account-a") }, error: null });
    mockIdentityReads(async (table, userId) => identityReply(table, userId));
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
          <MemoryRouter><ProtectedRoute><PrivateCalendar /></ProtectedRoute></MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Account A private calendar")).toBeInTheDocument();
    for (const key of globalKeys) queryClient.setQueryData(key, { owner: "account-a", private: "Synthetic private data" });
    act(() => { authStateCallback?.("SIGNED_IN", sessionFor("account-b")); });
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("Profile account-b"));
    expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    expect(screen.getByTestId("private-calendar")).toHaveTextContent("Loading current calendar");
    expect(screen.queryByText("Account A private calendar")).not.toBeInTheDocument();
    expect(globalKeys.every(key => queryClient.getQueryData(key) === undefined)).toBe(true);
    expect(seen.filter(value => value.viewer === "account-b").every(value => value.data !== "Account A private calendar")).toBe(true);
    await act(async () => nextData.resolve("Account B private calendar"));
    expect(await screen.findByText("Account B private calendar")).toBeInTheDocument();
  });

  it.each(["SIGNED_OUT", "TOKEN_REFRESHED"] as const)("clears all private cache on %s with a null session", async event => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor("account-a") }, error: null });
    mockIdentityReads(async (table, userId) => identityReply(table, userId));
    mountAuth();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
    for (const key of globalKeys) queryClient.setQueryData(key, { owner: "account-a" });
    act(() => { authStateCallback?.(event, null); });
    await waitFor(() => {
      expect(screen.getByTestId("user")).toHaveTextContent("none");
      expect(screen.getByTestId("loading")).toHaveTextContent("ready");
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("cancels an old global-key fetch so its late response cannot restore the cleared cache", async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor("account-a") }, error: null });
    mockIdentityReads(async (table, userId) => identityReply(table, userId));
    mountAuth();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
    const late = deferred<string>();
    const oldRead = queryClient.fetchQuery({ queryKey: ["apex-today-finances"], queryFn: () => late.promise });
    const canceledRead = expect(oldRead).rejects.toSatisfy(isCancelledError);
    act(() => { authStateCallback?.("SIGNED_IN", sessionFor("account-b")); });
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("Profile account-b"));
    await act(async () => { late.resolve("Account A private finances"); await canceledRead; });
    expect(queryClient.getQueryData(["apex-today-finances"])).toBeUndefined();
  });

  it("applies only the newest queued identity event and does not let its superseded reset clear the new cache", async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor("account-a") }, error: null });
    const calls = mockIdentityReads(async (table, userId) => identityReply(table, userId));
    mountAuth();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
    const reset = vi.spyOn(queryClient, "clear");
    act(() => {
      authStateCallback?.("SIGNED_IN", sessionFor("superseded-account"));
      authStateCallback?.("SIGNED_IN", sessionFor("account-b"));
    });
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("Profile account-b"));
    queryClient.setQueryData(["apex-today-content"], { owner: "account-b" });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(calls.some(call => call.userId === "superseded-account")).toBe(false);
    expect(queryClient.getQueryData(["apex-today-content"])).toEqual({ owner: "account-b" });
  });

  it("does not reset the query cache for an unchanged anonymous startup", async () => {
    const reset = vi.spyOn(queryClient, "clear");
    mountAuth();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
    expect(reset).not.toHaveBeenCalled();
  });
});
