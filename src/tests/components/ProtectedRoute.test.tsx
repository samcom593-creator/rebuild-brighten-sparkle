/**
 * ProtectedRoute.test.tsx
 *
 * Gaps covered:
 *   ✅ Unauthenticated user redirected to /login
 *   ✅ Unauthenticated user on agent page redirected to /agent-login
 *   ✅ Authenticated non-admin on a requireAdmin route sees the access-denied panel (no silent redirect)
 *   ✅ Denied VA manager is offered /va-team as the safe destination
 *   ✅ Unauthenticated redirect carries path + query in state.from so Login can return there
 *   ✅ Admin user can access requireAdmin route
 *   ✅ Manager bypasses requireAdmin when allowManagers=true
 *   ✅ Manager still blocked when allowManagers=false
 *   ✅ Presenter flag check fires supabase query when allowPresenters=true
 *   ✅ Presenter with is_presenting=true accesses the route
 *   ✅ Presenter check failure (Supabase throws) → blocks access
 *   ✅ Loading skeleton shown during initial auth check
 *   ✅ Same-account refresh preserves the mounted page; a new account waits for its own roles
 *
 * Missing / not yet tested:
 *   ❌ Presenter check cancellation on unmount (no DB state corruption)
 */
import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// Mock useAuth
vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const mockUseAuth = vi.mocked(useAuth);

// Stands in for Login.tsx, which reads state.from (pathname + search) to send
// the visitor back where they were headed after signing in.
function LoginEcho() {
  const { state } = useLocation();
  const from = (state as { from?: { pathname: string; search: string } } | null)?.from;
  return <div data-testid="from">{from ? `${from.pathname}${from.search}` : "none"}</div>;
}

function expectAccessDenied(pathname: string, requirement: string, homeHref: string) {
  const panel = screen.getByRole("alert");
  expect(panel).toHaveTextContent("You do not have access to this page");
  expect(panel).toHaveTextContent(pathname);
  expect(panel).toHaveTextContent(`needs ${requirement}`);
  expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", homeHref);
  expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
  expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
}

function renderRoute(
  path: string,
  props: Partial<React.ComponentProps<typeof ProtectedRoute>> = {}
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={path}
          element={
            <ProtectedRoute {...props}>
              <div>Protected content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/agent-login" element={<div>Agent Login page</div>} />
        <Route path="/dashboard" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: authenticated, non-admin, non-manager
  mockUseAuth.mockReturnValue({
    user: { id: "user-1" } as any,
    session: {} as any,
    profile: null,
    roles: [],
    isLoading: false,
    isAdmin: false,
    isManager: false,
    isAgent: true,
    isVaManager: false,
    isVa: false,
    isRecruiter: false,
    accountMode: null,
    hasAgentRecord: false,
    effectiveMode: "agent" as const,
    hasRole: vi.fn(),
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  });
});

describe("ProtectedRoute — unauthenticated", () => {
  it("redirects to /login when user is null", () => {
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), user: null } as any);
    renderRoute("/dashboard");
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });

  it("redirects to /agent-login for agent-specific pages", () => {
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), user: null } as any);
    renderRoute("/agent-portal");
    expect(screen.getByText("Agent Login page")).toBeInTheDocument();
  });

  it("redirects to /login for non-agent pages even when unauthenticated", () => {
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), user: null } as any);
    renderRoute("/admin");
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });

  it("carries the requested path and query in state.from so Login can return there", () => {
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), user: null });
    render(
      <MemoryRouter initialEntries={["/dashboard/team?view=contracting"]}>
        <Routes>
          <Route
            path="/dashboard/team"
            element={
              <ProtectedRoute>
                <div>Protected content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<LoginEcho />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("from")).toHaveTextContent("/dashboard/team?view=contracting");
  });
});

describe("ProtectedRoute — authenticated, no elevated role", () => {
  it("renders children for a non-requireAdmin route", () => {
    renderRoute("/dashboard");
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("shows the access-denied panel instead of a silent redirect when requireAdmin=true and user is not admin", () => {
    renderRoute("/admin", { requireAdmin: true });
    expectAccessDenied("/admin", "an admin account", "/dashboard");
  });

  it("names managers in the requirement when the route lets them through, and offers a VA manager /va-team", () => {
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), isVaManager: true });
    renderRoute("/dashboard/hiring-pipeline", { requireAdmin: true, allowManagers: true });
    expectAccessDenied("/dashboard/hiring-pipeline", "an admin or manager account", "/va-team");
  });
});

describe("ProtectedRoute — admin access", () => {
  it("renders children when isAdmin=true and requireAdmin=true", () => {
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), isAdmin: true } as any);
    renderRoute("/admin", { requireAdmin: true });
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });
});

describe("ProtectedRoute — manager bypass", () => {
  it("allows manager through when allowManagers=true", () => {
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), isManager: true } as any);
    renderRoute("/admin", { requireAdmin: true, allowManagers: true });
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });

  it("blocks manager when allowManagers=false (default)", () => {
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), isManager: true } as any);
    renderRoute("/admin", { requireAdmin: true, allowManagers: false });
    expectAccessDenied("/admin", "an admin account", "/dashboard");
  });
});

describe("ProtectedRoute — presenter bypass", () => {
  it("queries agents table when allowPresenters=true and user is not admin/manager", async () => {
    const mockLimit = vi.fn().mockResolvedValue({
      data: [{ is_presenting: true }],
      error: null,
    });
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: mockLimit,
    } as any);

    renderRoute("/seminar", { requireAdmin: true, allowPresenters: true });

    await waitFor(() => {
      expect(mockLimit).toHaveBeenCalledWith(1);
    });
  });

  it("grants access when is_presenting=true", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ is_presenting: true }],
        error: null,
      }),
    } as any);

    renderRoute("/seminar", { requireAdmin: true, allowPresenters: true });

    await waitFor(() => {
      expect(screen.getByText("Protected content")).toBeInTheDocument();
    });
  });

  it("blocks when is_presenting=false", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [],
        error: null,
      }),
    } as any);

    renderRoute("/seminar", { requireAdmin: true, allowPresenters: true });

    await waitFor(() => {
      expectAccessDenied("/seminar", "an admin or active presenter account", "/dashboard");
    });
  });

  it("blocks when presenter Supabase query throws", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error("DB error")),
    } as any);

    renderRoute("/seminar", { requireAdmin: true, allowPresenters: true });

    await waitFor(() => {
      expectAccessDenied("/seminar", "an admin or active presenter account", "/dashboard");
    });
  });
});

describe("ProtectedRoute — loading state", () => {
  it("shows skeleton during initial auth load", () => {
    mockUseAuth.mockReturnValue({
      ...mockUseAuth(),
      isLoading: true,
      user: null,
    } as any);
    const { container } = renderRoute("/dashboard");
    // The SkeletonLoader renders something; assert children are NOT shown
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });
});

describe("ProtectedRoute — account isolation", () => {
  function PrivateDraft() {
    const [draft, setDraft] = useState("");
    return <input aria-label="Private draft" value={draft} onChange={event => setDraft(event.target.value)} />;
  }
  const privateRoute = () => (
    <MemoryRouter initialEntries={["/admin"]}>
      <ProtectedRoute requireAdmin><PrivateDraft /></ProtectedRoute>
    </MemoryRouter>
  );

  it("keeps a same-account draft mounted during a role/session refresh", () => {
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), isAdmin: true });
    const view = render(privateRoute());
    fireEvent.change(screen.getByRole("textbox", { name: "Private draft" }), { target: { value: "Current account draft" } });
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), isLoading: true });
    view.rerender(privateRoute());
    expect(screen.getByRole("textbox", { name: "Private draft" })).toHaveValue("Current account draft");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("hides the old account while a new user's retained admin flag is unresolved", () => {
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), isAdmin: true });
    const view = render(privateRoute());
    fireEvent.change(screen.getByRole("textbox", { name: "Private draft" }), { target: { value: "Prior account draft" } });
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), user: { id: "user-2" } as any, isLoading: true });
    view.rerender(privateRoute());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), isLoading: false, isAdmin: false });
    view.rerender(privateRoute());
    expect(screen.getByRole("alert")).toHaveTextContent("needs an admin account");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("remounts local private state for a different already-resolved authorized account", () => {
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), isAdmin: true });
    const view = render(privateRoute());
    fireEvent.change(screen.getByRole("textbox", { name: "Private draft" }), { target: { value: "Prior account draft" } });
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), user: { id: "user-2" } as any });
    view.rerender(privateRoute());
    expect(screen.getByRole("textbox", { name: "Private draft" })).toHaveValue("");
  });

  it("does not reuse an earlier resolution when accounts switch A to B to A while loading", () => {
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), isAdmin: true });
    const view = render(privateRoute());
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), user: { id: "user-2" } as any, isLoading: true });
    view.rerender(privateRoute());
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), user: { id: "user-1" } as any });
    view.rerender(privateRoute());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("ignores a previous account's delayed presenter approval", async () => {
    let finishFirst!: (value: { data: unknown[]; error: null }) => void;
    let finishSecond!: (value: { data: unknown[]; error: null }) => void;
    const limit = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
    vi.mocked(supabase.from).mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit } as any);
    const node = () => (
      <MemoryRouter initialEntries={["/seminar"]}>
        <ProtectedRoute requireAdmin allowPresenters><div>Protected content</div></ProtectedRoute>
      </MemoryRouter>
    );
    const view = render(node());
    await waitFor(() => expect(limit).toHaveBeenCalledTimes(1));
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), user: { id: "user-2" } as any, isLoading: true });
    view.rerender(node());
    expect(limit).toHaveBeenCalledTimes(1);
    mockUseAuth.mockReturnValue({ ...mockUseAuth(), isLoading: false });
    view.rerender(node());
    await waitFor(() => expect(limit).toHaveBeenCalledTimes(2));
    await act(async () => finishFirst({ data: [{ is_presenting: true }], error: null }));
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    await act(async () => finishSecond({ data: [], error: null }));
    expectAccessDenied("/seminar", "an admin or active presenter account", "/dashboard");
  });
});
