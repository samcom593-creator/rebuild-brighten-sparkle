import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { database, save } = vi.hoisted(() => ({
  database: { rows: [] as Record<string, unknown>[] }, save: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => {
    const query = {
      select: () => query, order: () => query,
      limit: async () => ({ data: table === "v_interview_pipeline" ? database.rows : [], error: null }),
    };
    return query;
  } },
}));
vi.mock("@/lib/interviewDisposition", () => ({ recordInterviewDisposition: save, undoInterviewDisposition: vi.fn() }));
vi.mock("@/components/dashboard/ApplicationDetailSheet", () => ({ ApplicationDetailSheet: () => null }));
vi.mock("@/components/recruiting/RecruitingWorkspaceNav", () => ({ RecruitingWorkspaceNav: () => null }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => {} }));

import InterviewRecovery from "@/pages/InterviewRecovery";

const clients: QueryClient[] = [];
function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, application_id: `application-${id}`, display_name: `Candidate ${id}`,
    best_phone: "+16085550101", best_email: `${id.toLowerCase()}@example.test`,
    scheduled_at: "2026-11-20T18:00:00Z", scheduled_at_chicago: "2026-11-20T12:00:00",
    bucket: "missed_7_plus", is_backlog: true, days_overdue: 7,
    priority_score: 100 - id.charCodeAt(0), outcome: null, notes: null,
    call_track: "licensed", event_type_name: "Licensed Call", license_status: "licensed",
    ...overrides,
  };
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><InterviewRecovery /></MemoryRouter></QueryClientProvider>);
  return client;
}
async function startCatchUp() {
  const start = await screen.findByRole("button", { name: /Work queue/ });
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  await screen.findByRole("heading", { name: "Candidate A", level: 1 });
}

beforeEach(() => {
  database.rows = [row("A"), row("B"), row("C"), row("D")];
  save.mockReset().mockImplementation(async ({ id, outcome }: { id: string; outcome: string }) => {
    database.rows = database.rows.map(r => r.id === id ? { ...r, outcome, is_backlog: false, bucket: "completed" } : r);
    return { receipt_id: `receipt-${id}`, can_undo: false };
  });
});
afterEach(() => { for (const client of clients.splice(0)) client.clear(); });

describe("interview recovery handoffs", () => {
  it("works every remaining interview exactly once as saved rows disappear from the queue", async () => {
    renderPage();
    await startCatchUp();
    for (const id of ["A", "B", "C", "D"]) {
      await screen.findByRole("heading", { level: 1, name: `Candidate ${id}` });
      fireEvent.click(screen.getByRole("button", { name: `Completed — Candidate ${id}` }));
    }
    await screen.findByRole("heading", { level: 1, name: "Backlog clear" });
    expect(save.mock.calls.map(([args]) => args.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("keeps the same person on a failed save, then advances on a successful retry", async () => {
    save.mockRejectedValueOnce(new Error("Temporary failure"));
    renderPage();
    await startCatchUp();
    fireEvent.click(screen.getByRole("button", { name: "Completed — Candidate A" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Completed — Candidate A" })).toBeEnabled());
    expect(screen.getByRole("heading", { level: 1, name: "Candidate A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Completed — Candidate A" }));
    await screen.findByRole("heading", { level: 1, name: "Candidate B" });
    expect(save.mock.calls.map(([args]) => args.id)).toEqual(["A", "A"]);
  });

  it("holds the selected identity when polling changes priority order", async () => {
    const client = renderPage();
    await startCatchUp();
    fireEvent.click(screen.getByRole("button", { name: "Skip to next candidate" }));
    await screen.findByRole("heading", { level: 1, name: "Candidate B" });
    database.rows = database.rows.map(r => ({ ...r, priority_score: r.id === "C" ? 1000 : r.priority_score }));
    await act(async () => { await client.invalidateQueries({ queryKey: ["interview-pipeline"] }); });
    expect(screen.getByRole("heading", { level: 1, name: "Candidate B" })).toBeInTheDocument();
  });

  it("offers a real application search for an unlinked prospect while preserving the hire block", async () => {
    database.rows = [row("A", { application_id: null, best_email: "jordan+prospect@example.test" })];
    renderPage();
    await startCatchUp();
    const link = screen.getByRole("link", { name: "Find application" });
    const target = new URL(link.getAttribute("href")!, "https://galaxyfinancial.org");
    expect(target.pathname).toBe("/dashboard/recruiting");
    expect(target.searchParams.get("queue")).toBe("all_open");
    expect(target.searchParams.get("q")).toBe("jordan+prospect@example.test");
    expect(screen.getByRole("button", { name: "Hired — Candidate A" })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
});
