import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ leads: [] as Array<Record<string, unknown>>, statsError: false, leadError: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (name: string) => Promise.resolve(
  name === "phc_admin_lead_stats" ? { data: db.statsError ? null : [{ total: db.leads.length, today: 1, uncalled: 2 }], error: db.statsError ? { message: "Totals unavailable" } : null }
    : { data: db.leadError ? null : db.leads, error: db.leadError ? { message: "Leads unavailable" } : null },
) } }));
import AdminPolicyLeads from "@/pages/AdminPolicyLeads";

const lead = (id: number, over: Record<string, unknown> = {}) => ({ lead_code: `lead-${id}`, first_name: `Person ${id}`,
  created_at: `2026-11-${String(1 + id % 25).padStart(2, "0")}T12:00:00Z`, phone_e164: `+1602555${String(id).padStart(4, "0")}`,
  email: `person${id}@example.test`, state: "AZ", help_category: "Policy review", callback_time: null, current_carrier: "Carrier One", utm_source: null, utm_campaign: "Review campaign", gclid: null, status: "new", ...over });
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminPolicyLeads /></QueryClientProvider>);

describe("consumer policy lead worklist", () => {
  beforeEach(() => { db.leads = [lead(1), lead(2, { state: "TX", status: "contacted" }), lead(3, { state: "TX" })]; db.statsError = false; db.leadError = false; });
  it("combines state/status filters, formatted-phone search and one-tap reset", async () => {
    renderPage();
    await screen.findByText("Person 1");
    fireEvent.change(screen.getByLabelText("Policy lead state"), { target: { value: "TX" } });
    fireEvent.change(screen.getByLabelText("Policy lead status"), { target: { value: "contacted" } });
    expect(screen.getByText("Person 2")).toBeTruthy();
    expect(screen.queryByText("Person 3")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search policy leads"), { target: { value: "(602) 555-0002" } });
    expect(screen.getByText("Person 2")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search policy leads"), { target: { value: "unknown" } });
    expect(screen.getByText("No policy leads match these filters.")).toBeTruthy();
    expect(screen.queryByText(/No policy-review leads yet/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all policy leads" }));
    expect(screen.getByText("Person 1")).toBeTruthy();
    expect(screen.getByText("Person 3")).toBeTruthy();
  });
  it("pages the complete loaded worklist and resets the page after a search", async () => {
    db.leads = Array.from({ length: 30 }, (_, i) => lead(i + 1, { created_at: "2026-11-25T12:00:00Z" }));
    renderPage();
    await screen.findByText("Person 1");
    expect(screen.queryByText("Person 30")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next policy leads page" }));
    expect(screen.getByText("Person 30")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search policy leads"), { target: { value: "person1@example.test" } });
    expect(screen.getByText("Person 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search policy leads" }));
    await waitFor(() => expect(screen.getByText("Person 1")).toBeTruthy());
  });
  it("shows unavailable totals with a retry instead of reporting zero on a failed read", async () => {
    db.statsError = true;
    renderPage();
    await screen.findByText("Totals unavailable");
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByText("Person 1")).toBeTruthy();
  });
  it("reserves the real empty state for a successful empty read and retries a failed lead read", async () => {
    db.leadError = true;
    renderPage();
    await screen.findByText("Leads unavailable");
    expect(screen.queryByText(/No policy-review leads yet/)).toBeNull();
    db.leadError = false; db.leads = [];
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/No policy-review leads yet/)).toBeTruthy();
  });
});
