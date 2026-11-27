import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  signedIn: false,
  roles: ["agent"] as string[],
  passwordSet: true,
  signIn: vi.fn(),
}));

vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => {} }));
vi.mock("@/hooks/useSoundEffects", () => ({ useSoundEffects: () => ({ playSound: vi.fn() }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({
  user: mock.signedIn ? { id: "synthetic-applicant" } : null,
  isLoading: false, isAdmin: false, isManager: false, isVaManager: false,
  hasRole: (role: string) => mock.roles.includes(role),
}) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: {
    signInWithPassword: mock.signIn,
    getUser: async () => ({ data: { user: { id: "synthetic-applicant" } } }),
  },
  from: (table: string) => {
    const query = {
      select: () => query,
      eq: () => table === "user_roles"
        ? Promise.resolve({ data: mock.roles.map(role => ({ role })), error: null }) : query,
      maybeSingle: async () => ({ data: { portal_password_set: mock.passwordSet }, error: null }),
    };
    return query;
  },
} }));

import Login from "@/pages/Login";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { CONTRACTING_PROFILE_PATH } from "@/lib/contractingLinks";

function Destination() {
  const location = useLocation();
  return <h1>{location.pathname}{location.search}</h1>;
}

function renderLogin(from?: { pathname?: string; search?: string }, startProtected = false) {
  render(
    <MemoryRouter initialEntries={startProtected ? [CONTRACTING_PROFILE_PATH] : [{ pathname: "/login", state: { from } }]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path={CONTRACTING_PROFILE_PATH} element={<ProtectedRoute><Destination /></ProtectedRoute>} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function signIn(password = "synthetic-password") {
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "applicant@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
}

beforeEach(() => {
  mock.signedIn = false;
  mock.roles = ["agent"];
  mock.passwordSet = true;
  mock.signIn.mockReset().mockImplementation(async () => {
    mock.signedIn = true;
    return { error: null };
  });
});

describe("licensed applicant contracting sign-in recovery", () => {
  it("returns an ordinary applicant to contracting through the actual protected-route sign-in handoff", async () => {
    renderLogin(undefined, true);
    await signIn();
    expect(await screen.findByRole("heading", { name: CONTRACTING_PROFILE_PATH })).toBeInTheDocument();
    expect(mock.signIn).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://untrusted.example/contracting",
    "//untrusted.example/contracting",
    "/\\untrusted.example/contracting",
    "/dashboard/admin",
    "/dashboard/contracting-profile-extra",
    "/dashboard/contracting-profile/../../admin",
    "/login",
  ])("keeps an ordinary agent's default landing for unsupported return path %s", async pathname => {
    renderLogin({ pathname });
    await signIn();
    expect(await screen.findByRole("heading", { name: "/agent-portal" })).toBeInTheDocument();
  });

  it("does not carry untrusted state search text into the fixed contracting destination", async () => {
    renderLogin({ pathname: CONTRACTING_PROFILE_PATH, search: "//untrusted.example/escape" });
    await signIn();
    expect(await screen.findByRole("heading", { name: CONTRACTING_PROFILE_PATH })).toBeInTheDocument();
  });

  it("preserves the ordinary agent landing when no return destination was requested", async () => {
    renderLogin();
    await signIn();
    expect(await screen.findByRole("heading", { name: "/agent-portal" })).toBeInTheDocument();
  });

  it.each([
    ["admin", "/dashboard/recruiting", "?queue=all_open", "/dashboard/recruiting?queue=all_open"],
    ["manager", "/dashboard/recruiting", "?queue=all_open", "/dashboard/recruiting?queue=all_open"],
    ["va_manager", CONTRACTING_PROFILE_PATH, "", "/va-team"],
    ["va", CONTRACTING_PROFILE_PATH, "", "/admin/recovery-queue"],
  ])("preserves the existing %s landing rule", async (role, pathname, search, destination) => {
    mock.roles = [role];
    renderLogin({ pathname, search });
    await signIn();
    expect(await screen.findByRole("heading", { name: destination })).toBeInTheDocument();
  });

  it("keeps a required password change ahead of the contracting return", async () => {
    mock.passwordSet = false;
    renderLogin({ pathname: CONTRACTING_PROFILE_PATH });
    await signIn("123456");
    expect(await screen.findByRole("heading", { name: "/dashboard/settings?force_password_change=true" })).toBeInTheDocument();
  });
});
