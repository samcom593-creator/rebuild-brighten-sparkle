import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InactiveAgents from "@/pages/InactiveAgents";

const mock = vi.hoisted(() => ({
  evidenceError: false, detailsError: false, missingEvidence: false,
  writes: [] as any[], filters: [] as any[], saved: true,
  success: vi.fn(), error: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "manager" }, isAdmin: false, isManager: true }) }));
vi.mock("@/hooks/useConfirm", () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock("sonner", () => ({ toast: { success: mock.success, error: mock.error } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: vi.fn() },
  from: (table: string) => {
    let writing = false;
    const chain: any = {};
    for (const method of ["select", "order", "in"]) chain[method] = () => chain;
    chain.eq = (...args: any[]) => { if (writing) mock.filters.push(args); return chain; };
    chain.update = (payload: any) => { writing = true; mock.writes.push({ table, payload }); return chain; };
    const result = () => writing ? { data: mock.saved ? { id: "q" } : null, error: null }
      : table === "inactive_agent_queue" ? { data: [{ id: "q", agent_id: "alias", days_inactive: 15, reason: "no_recorded_activity", severity: "critical", status: "open", recovery_attempts: 2, recovery_notes: "Earlier outcome", updated_at: "2026-11-20T12:00:00Z" }], error: null }
      : table === "agents" ? { data: [{ id: "alias", display_name: "Agent One", canonical_agent_id: "canonical", status: "active", is_inactive: false, is_deactivated: false, license_status: "licensed", profile: { full_name: "Agent One", email: "agent@example.test", phone: "+16025550123" } }], error: mock.detailsError ? new Error("Details unavailable") : null }
      : { data: mock.missingEvidence ? [] : [{ agent_id: "canonical", first_deal_at: "2026-10-01" }], error: mock.evidenceError ? new Error("Evidence unavailable") : null };
    chain.single = () => Promise.resolve(result());
    chain.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  },
} }));

async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><InactiveAgents /></MemoryRouter></QueryClientProvider>);
  await screen.findByText("Inactive Agent Recovery");
}

describe("recovery evidence and actions", () => {
  beforeEach(() => { mock.evidenceError = false; mock.detailsError = false; mock.missingEvidence = false; mock.writes.length = 0; mock.filters.length = 0; mock.saved = true; mock.success.mockClear(); mock.error.mockClear(); });
  it.each(["failed", "missing"])("keeps %s production evidence unknown instead of claiming never sold", async kind => {
    mock.evidenceError = kind === "failed"; mock.missingEvidence = kind === "missing";
    await setup();
    await screen.findByText("Agent One");
    await waitFor(() => expect(screen.getByRole("button", { name: /Evidence unknown/ })).toHaveTextContent("(1)"));
    expect(screen.queryByText(/Never sold/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /No production recorded/ })).toHaveTextContent("(0)");
  });
  it("keeps a case visible when agent details cannot be read", async () => {
    mock.detailsError = true;
    await setup();
    await screen.findByText(/This recovery case needs review/);
    expect(screen.getByText("Agent details could not load.")).toBeInTheDocument();
  });
  it("opens a contact app without recording a completed contact and links to the canonical profile", async () => {
    await setup();
    const email = await screen.findByRole("link", { name: "Open email draft for Agent One" });
    email.addEventListener("click", event => event.preventDefault());
    fireEvent.click(email);
    expect(mock.writes).toEqual([]); expect(mock.success).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Agent One" })).toHaveAttribute("href", "/dashboard/agent/canonical");
  });
  it("appends an explicit contact outcome with a concurrency guard and no account mutation", async () => {
    await setup();
    const trigger = await screen.findByRole("button", { name: "Recovery actions for Agent One" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Record contact outcome" }));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Called; next review tomorrow" } });
    fireEvent.click(screen.getByRole("button", { name: "Save outcome" }));
    await waitFor(() => expect(mock.success).toHaveBeenCalledWith("Contact outcome recorded."));
    expect(mock.writes).toHaveLength(1);
    expect(mock.writes[0].table).toBe("inactive_agent_queue");
    expect(mock.writes[0].payload.recovery_notes).toContain("Earlier outcome\n");
    expect(mock.writes[0].payload.recovery_notes).toContain("No answer — Called; next review tomorrow");
    expect(mock.writes[0].payload.recovery_attempts).toBe(3);
    expect(mock.filters).toContainEqual(["updated_at", "2026-11-20T12:00:00Z"]);
    expect(mock.writes[0].payload).not.toHaveProperty("status");
  });
});
