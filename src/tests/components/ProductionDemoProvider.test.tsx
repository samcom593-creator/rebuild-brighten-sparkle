import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canEditProductionDemo, DemoNumberEditorButton, ProductionDemoProvider } from "@/components/demo/ProductionDemoProvider";
import { useDemoNumberFields, type DemoNumberField } from "@/hooks/useDemoNumberFields";
import { areDealCelebrationsSuppressed } from "@/lib/dealCelebrations";
import { setDemoMode } from "@/lib/demoMode";
import { productionDemoStorageKey } from "@/lib/productionDemo";
import type { AgentIdentity } from "@/lib/agentIdentity";

const state = vi.hoisted(() => ({
  user: { id: "sam-account", email: "sam.com593@gmail.com" } as { id: string; email: string } | null,
  isAdmin: true, isLoading: false, isPreviewing: false,
  identity: undefined as AgentIdentity | undefined,
  identityLoading: false, identityError: false, identityUserId: "sam-account" as string | null,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user, isAdmin: state.isAdmin, isLoading: state.isLoading }) }));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ isPreviewing: state.isPreviewing }) }));
vi.mock("@/hooks/useAgentIdentity", () => ({ useAgentIdentity: () => ({ identity: state.identity, userId: state.identityUserId, isLoading: state.identityLoading, isError: state.identityError }) }));

const JONTAY = "95759777-1432-4210-8e9b-f174d79685a2";
const defaultFields: DemoNumberField[] = [
  { key: "alp", label: "Annual premium", value: 2400, kind: "money" },
  { key: "policies", label: "Policies", value: 2, kind: "count" },
];
const jontayIdentity = (): Extract<AgentIdentity, { status: "resolved" }> => ({ status: "resolved", agentId: JONTAY, row: { id: JONTAY, user_id: "jontay-account", agent_code: null, display_name: " Jontay   Taylor ", status: "active", is_inactive: false, is_deactivated: false, created_at: "2026-01-01", canonical_agent_id: null } });

function Probe({ fields = defaultFields, scopeKey = "personal:november" }: { fields?: DemoNumberField[]; scopeKey?: string }) {
  const model = useDemoNumberFields({ scopeKey, label: "My production", fields });
  return <output data-testid="numbers">{JSON.stringify(model)}</output>;
}
function Surface({ fields = defaultFields }: { fields?: DemoNumberField[] }) {
  return <ProductionDemoProvider><DemoNumberEditorButton /><Probe fields={fields} /></ProductionDemoProvider>;
}
function editAlp(value = "18000") {
  fireEvent.click(screen.getByRole("button", { name: "Edit demo figures" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Annual premium ($)" }), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save demo figures" }));
}
const numbers = () => JSON.parse(screen.getByTestId("numbers").textContent!);

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); setDemoMode(false);
  state.user = { id: "sam-account", email: "sam.com593@gmail.com" };
  state.isAdmin = true; state.isLoading = state.isPreviewing = state.identityLoading = state.identityError = false;
  state.identity = undefined; state.identityUserId = "sam-account";
});
afterEach(async () => { cleanup(); await Promise.resolve(); setDemoMode(false); sessionStorage.clear(); localStorage.clear(); });

describe("production demo editor", () => {
  it("returns real values without a provider", () => {
    render(<Probe />);
    expect(numbers()).toEqual({ values: { alp: 2400, policies: 2 }, isDemo: false });
  });

  it("edits the visible render values atomically, labels them and suppresses real celebrations", () => {
    render(<Surface />);
    editAlp("18250.129");
    expect(numbers()).toEqual({ values: { alp: 18250.13, policies: 2 }, isDemo: true });
    expect(screen.getByRole("button", { name: "Edit demo figures" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Demo figures active. Edit or restore live figures" })).toBeInTheDocument();
    expect(areDealCelebrationsSuppressed()).toBe(true);
    expect(defaultFields[0].value).toBe(2400);
    fireEvent.click(screen.getByRole("button", { name: "Edit demo figures" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore live figures" }));
    expect(numbers()).toEqual({ values: { alp: 2400, policies: 2 }, isDemo: false });
    expect(areDealCelebrationsSuppressed()).toBe(false);
  });

  it("does not apply a valid money edit when another changed field is invalid", () => {
    render(<Surface />);
    fireEvent.click(screen.getByRole("button", { name: "Edit demo figures" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Annual premium ($)" }), { target: { value: "18000" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Policies" }), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save demo figures" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Policies: enter a whole number.");
    expect(numbers().values).toEqual({ alp: 2400, policies: 2 });
    expect(areDealCelebrationsSuppressed()).toBe(false);
  });

  it("keeps untouched figures current while an editor is open", () => {
    const view = render(<Surface />);
    fireEvent.click(screen.getByRole("button", { name: "Edit demo figures" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Annual premium ($)" }), { target: { value: "18000" } });
    view.rerender(<Surface fields={[defaultFields[0], { ...defaultFields[1], value: 7 }]} />);
    expect(screen.getByRole("spinbutton", { name: "Policies" })).toHaveValue(7);
    fireEvent.click(screen.getByRole("button", { name: "Save demo figures" }));
    expect(numbers().values).toEqual({ alp: 18000, policies: 7 });
  });

  it("discards stale account values and closes the editor immediately on account switch", async () => {
    const view = render(<Surface />);
    editAlp();
    fireEvent.click(screen.getByRole("button", { name: "Edit demo figures" }));
    state.user = { id: "jontay-account", email: "jontay@example.test" };
    state.isAdmin = false; state.identity = jontayIdentity(); state.identityUserId = "jontay-account";
    view.rerender(<Surface />);
    expect(numbers()).toEqual({ values: { alp: 2400, policies: 2 }, isDemo: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(areDealCelebrationsSuppressed()).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(sessionStorage.getItem(productionDemoStorageKey("sam-account"))).toBeNull();
  });

  it("fails closed when role preview starts and cannot restore edited data through preview", () => {
    const view = render(<Surface />);
    editAlp();
    state.isPreviewing = true;
    view.rerender(<Surface />);
    expect(screen.queryByRole("button", { name: "Edit demo figures" })).not.toBeInTheDocument();
    expect(numbers().isDemo).toBe(false);
    expect(numbers().values.alp).toBe(2400);
    expect(areDealCelebrationsSuppressed()).toBe(false);
  });

  it("fails closed while auth is loading and after signout", () => {
    const view = render(<Surface />);
    editAlp();
    state.isLoading = true;
    view.rerender(<Surface />);
    expect(numbers().isDemo).toBe(false);
    expect(screen.queryByRole("button", { name: "Edit demo figures" })).not.toBeInTheDocument();
    state.user = null; state.isLoading = false;
    view.rerender(<Surface />);
    expect(numbers().values.alp).toBe(2400);
    expect(areDealCelebrationsSuppressed()).toBe(false);
  });

  it("restores only its own session values under StrictMode", async () => {
    sessionStorage.setItem(productionDemoStorageKey("sam-account"), JSON.stringify({ version: 1, ownerId: "sam-account", overrides: { "personal:november": { alp: 18000 } } }));
    render(<StrictMode><Surface /></StrictMode>);
    await act(async () => { await Promise.resolve(); });
    expect(numbers().values.alp).toBe(18000);
    expect(areDealCelebrationsSuppressed()).toBe(true);
  });

  it("supports the existing global masking mode without changing its flag or cache", () => {
    state.user = { id: "jontay-account", email: "jontay@example.test" };
    state.isAdmin = false; state.identity = jontayIdentity(); state.identityUserId = "jontay-account";
    state.identity.row.display_name = "Avery Bennett";
    setDemoMode(true);
    render(<Surface />);
    editAlp();
    fireEvent.click(screen.getByRole("button", { name: "Edit demo figures" }));
    expect(screen.getByRole("button", { name: "Restore masked figures" })).toBeInTheDocument();
    expect(localStorage.getItem("apex.demoMode")).toBe("1");
  });
});

describe("exact production demo capability", () => {
  const access = () => ({ user: { id: "jontay-account", email: "jontay@example.test" }, isAdmin: false, isLoading: false, isPreviewing: false, identity: jontayIdentity() as AgentIdentity, identityUserId: "jontay-account", identityLoading: false, identityError: false, masked: false });

  it("accepts Sam's actual admin gate and Jontay's resolved working agent identity", () => {
    expect(canEditProductionDemo(access())).toBe(true);
    expect(canEditProductionDemo({ ...access(), user: { id: "sam-account", email: "sam.com593@gmail.com" }, isAdmin: true })).toBe(true);
    expect(canEditProductionDemo({ ...access(), identity: { ...jontayIdentity(), agentId: "new-canonical-id", mergedFromAgentId: JONTAY } })).toBe(true);
  });

  it("rejects other admins, name-only matches, wrong server names, stale identity, inactive rows and failed resolution", () => {
    const original = access();
    const other = { ...jontayIdentity(), agentId: "someone-else", row: { ...jontayIdentity().row, id: "someone-else" } };
    expect(canEditProductionDemo({ ...original, user: { id: "other-admin", email: "admin@example.test" }, isAdmin: true, identity: other, identityUserId: "other-admin" })).toBe(false);
    expect(canEditProductionDemo({ ...original, identity: other })).toBe(false);
    expect(canEditProductionDemo({ ...original, identity: { ...jontayIdentity(), row: { ...jontayIdentity().row, display_name: "Someone Else" } } })).toBe(false);
    expect(canEditProductionDemo({ ...original, identityUserId: "previous-account" })).toBe(false);
    expect(canEditProductionDemo({ ...original, identity: { ...jontayIdentity(), row: { ...jontayIdentity().row, is_deactivated: true } } })).toBe(false);
    expect(canEditProductionDemo({ ...original, identityLoading: true })).toBe(false);
    expect(canEditProductionDemo({ ...original, identityError: true })).toBe(false);
    expect(canEditProductionDemo({ ...original, identity: { status: "ambiguous", candidates: [] } })).toBe(false);
  });
});
