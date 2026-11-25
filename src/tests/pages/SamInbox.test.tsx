import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { phoneHref } from "@/lib/phone";

const state = vi.hoisted(() => ({
  auth: { user: { id: "admin-one" } as { id: string } | null, isAdmin: true, isLoading: false },
  preview: false,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ isPreviewing: state.preview }) }));
vi.mock("@/components/ui/page-loading-skeleton", () => ({ PageLoadingSkeleton: () => <p role="status">Loading triage</p> }));
import SamInbox from "@/pages/SamInbox";

type Result = { data: unknown; error: unknown };
const results = new Map<string, Result | Promise<Result>>();
const calls: Array<{ user: string; table: string; method: string; args: unknown[] }> = [];
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "synthetic-app-one", first_name: "Synthetic", last_name: "Applicant", email: "synthetic@example.test",
  phone: "2025550123", state: "AZ", created_at: "2026-11-15T00:00:00Z", ica_paid: true,
  ica_paid_at: "2026-11-16T00:00:00Z", status: "paid", days_old: 10, is_duplicate: false,
  referral_source: "Synthetic fixture", triage_bucket: "paid_needs_onboarding", seminar_date: null, ...overrides,
});

function chainFor(table: string) {
  const user = state.auth.user?.id ?? "signed-out";
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "neq", "order", "limit"]) {
    chain[method] = (...args: unknown[]) => { calls.push({ user, table, method, args }); return chain; };
  }
  chain.then = (resolve: (result: Result) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(results.get(user) ?? { data: null, error: { message: "No synthetic response" } }).then(resolve, reject);
  return chain;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = () => <QueryClientProvider client={client}><MemoryRouter><SamInbox /></MemoryRouter></QueryClientProvider>;
  return { client, ...render(node()), node };
}

beforeEach(() => {
  state.auth = { user: { id: "admin-one" }, isAdmin: true, isLoading: false };
  state.preview = false;
  results.clear(); calls.length = 0;
  results.set("admin-one", { data: [row()], error: null });
  vi.mocked(supabase.from).mockReset();
  vi.mocked(supabase.from).mockImplementation((table: string) => chainFor(table) as never);
});

describe("Recruiting triage verified reads", () => {
  it("keeps valid rows, bucket ordering, contact actions, and the bounded-result label usable", async () => {
    results.set("admin-one", { data: [
      row({ id: "synthetic-stale", first_name: "Stale", last_name: "Fixture", triage_bucket: "stale_new_7d", ica_paid: false, ica_paid_at: null, created_at: "not-a-date", phone: null, email: null }),
      row(),
    ], error: null });
    mount();
    expect(await screen.findByText("Synthetic Applicant")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Recruiting triage" })).toBeInTheDocument();
    expect(screen.getByText("Up to 120 applicants needing onboarding or follow-up.")).toBeInTheDocument();
    expect(screen.getByText("Applicants shown").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Paid waiting").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Seven-day stale").parentElement).toHaveTextContent("1");
    expect(screen.getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual(["Paid - needs onboarding", "Stale 7d"]);
    expect(screen.getByRole("link", { name: "Call" })).toHaveAttribute("href", phoneHref("2025550123"));
    expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:synthetic@example.test");
    expect(screen.getByText(/unknown age/)).toBeInTheDocument();
    expect(screen.getByText("No contact")).toBeInTheDocument();
    expect(calls).toContainEqual({ user: "admin-one", table: "v_sam_inbox", method: "neq", args: ["triage_bucket", "fresh"] });
    expect(calls).toContainEqual({ user: "admin-one", table: "v_sam_inbox", method: "limit", args: [120] });
    expect(screen.queryByText("No urgent recruiting leaks in the inbox.")).not.toBeInTheDocument();
  });

  it("renders all-clear only after a verified successful empty response", async () => {
    results.set("admin-one", { data: [], error: null });
    mount();
    expect(await screen.findByText("No urgent recruiting leaks in the inbox.")).toBeInTheDocument();
    expect(screen.getByText("Applicants shown").parentElement).toHaveTextContent("0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a failed read with Retry rather than all-clear and can recover", async () => {
    results.set("admin-one", { data: null, error: { message: "Synthetic triage read failed" } });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic triage read failed");
    expect(screen.queryByText("No urgent recruiting leaks in the inbox.")).not.toBeInTheDocument();
    expect(screen.queryByText("Applicants shown")).not.toBeInTheDocument();
    results.set("admin-one", { data: [row()], error: null });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Synthetic Applicant")).toBeInTheDocument();
  });

  it.each([
    null, {}, [null], [row(), row()], [row({ id: "" })], [row({ ica_paid: "false" })],
    [row({ triage_bucket: {} })], [row({ days_old: Number.NaN })], [{ id: "missing-fields" }],
  ].map((data, index) => ({ data, caseNumber: index + 1 })))("rejects malformed payload $caseNumber without crashing or showing all-clear", async ({ data }) => {
    results.set("admin-one", { data, error: null });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("unverified result");
    expect(screen.queryByText("No urgent recruiting leaks in the inbox.")).not.toBeInTheDocument();
    expect(screen.queryByText("Synthetic Applicant")).not.toBeInTheDocument();
  });

  it("does not turn a failed refresh of an empty response into a new all-clear", async () => {
    results.set("admin-one", { data: [], error: null });
    mount();
    await screen.findByText("No urgent recruiting leaks in the inbox.");
    results.set("admin-one", { data: null, error: { message: "Synthetic refresh failed" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic refresh failed");
    expect(screen.queryByText("No urgent recruiting leaks in the inbox.")).not.toBeInTheDocument();
  });
});

describe("Recruiting triage access and account isolation", () => {
  it.each(["non-admin", "role-preview", "auth-loading", "signed-out"])("does not query or display applicant data for %s", kind => {
    if (kind === "non-admin") state.auth.isAdmin = false;
    if (kind === "role-preview") state.preview = true;
    if (kind === "auth-loading") state.auth.isLoading = true;
    if (kind === "signed-out") state.auth.user = null;
    mount();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(screen.queryByText("Synthetic Applicant")).not.toBeInTheDocument();
    expect(screen.queryByText("No urgent recruiting leaks in the inbox.")).not.toBeInTheDocument();
  });

  it("hides cached applicant rows immediately when role preview starts", async () => {
    const view = mount();
    await screen.findByText("Synthetic Applicant");
    state.preview = true;
    view.rerender(view.node());
    expect(screen.queryByText("Synthetic Applicant")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Call" })).not.toBeInTheDocument();
    expect(screen.getByText("Recruiting triage is unavailable in this view")).toBeInTheDocument();
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("isolates the query cache by admin account and never shows the prior account while the next read is pending", async () => {
    const view = mount();
    await screen.findByText("Synthetic Applicant");
    expect(view.client.getQueryData(["sam-inbox", "admin-one"])).toHaveLength(1);
    let finish!: (result: Result) => void;
    results.set("admin-two", new Promise(resolve => { finish = resolve; }));
    state.auth.user = { id: "admin-two" };
    view.rerender(view.node());
    expect(screen.queryByText("Synthetic Applicant")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading triage");
    await act(async () => { finish({ data: [row({ id: "next-app", first_name: "Next", last_name: "Account" })], error: null }); });
    expect(await screen.findByText("Next Account")).toBeInTheDocument();
    expect(screen.queryByText("Synthetic Applicant")).not.toBeInTheDocument();
    expect(view.client.getQueryData(["sam-inbox", "admin-two"])).toHaveLength(1);
  });

  it("ignores a late previous-account response after the next account is active", async () => {
    let finish!: (result: Result) => void;
    results.set("admin-one", new Promise(resolve => { finish = resolve; }));
    const view = mount();
    await waitFor(() => expect(supabase.from).toHaveBeenCalledTimes(1));
    state.auth.user = { id: "admin-two" };
    results.set("admin-two", { data: [], error: null });
    view.rerender(view.node());
    await screen.findByText("No urgent recruiting leaks in the inbox.");
    await act(async () => { finish({ data: [row()], error: null }); });
    expect(screen.queryByText("Synthetic Applicant")).not.toBeInTheDocument();
    expect(screen.getByText("No urgent recruiting leaks in the inbox.")).toBeInTheDocument();
  });
});
