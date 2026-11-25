import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { AGENT_CLOUD_PRIMARY_NAV } from "@/components/layout/agentCloudNavigation";
import { TrainingJourney } from "@/components/training/TrainingJourney";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "wiring-agent" } }) }));
vi.mock("@/components/training/TrainingPathPanel", () => ({ TrainingPathPanel: () => null }));

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Call Lab wiring contract: the Training entry, practice link, three routes, and three edge
 * functions the client calls, and the RLS the migration promises must all
 * agree. A drift in any one of them is a page that renders and does nothing.
 */
describe("Call Lab wiring", () => {
  it("is reachable from the Training navigation entry through Start here and Practice a call", () => {
    const items = AGENT_CLOUD_PRIMARY_NAV.flatMap((g) => ("items" in g ? g.items : [g]));
    expect(items.filter(item => item.href === "/dashboard/training/library").map(item => item.label)).toEqual(["Training"]);
    const app = read("src/App.tsx");
    expect(app).toContain('<Route path="/dashboard/training/library" element={<ProtectedRoute><TrainingHub /></ProtectedRoute>} />');
    const hub = read("src/pages/TrainingHub.tsx");
    expect(hub).toContain('const tab = (legalTabs.includes(requestedTab) ? requestedTab : "path")');
    expect(hub).toMatch(/<TabsTrigger value="path"[\s\S]*?Start here\s*<\/TabsTrigger>/);
    expect(hub).toMatch(/<TabsContent value="path">\s*<TrainingJourney\b/);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["training-path-agent", "wiring-agent"], { id: "wiring-profile", display_name: "Test agent" });
    client.setQueryData(["training-path-modules"], []);
    client.setQueryData(["training-path-progress", "wiring-profile"], []);
    client.setQueryData(["training-center-practice", "wiring-agent"], 0);
    client.setQueryData(["training-center-progress", "wiring-agent"], []);
    render(createElement(QueryClientProvider, { client },
      createElement(MemoryRouter, null,
        createElement(TrainingJourney, { onOpenTab: vi.fn(), callsAvailable: 0 }))));
    const practice = screen.getByText("Practice a call").closest("li");
    expect(practice).not.toBeNull();
    expect(within(practice!).getByRole("link", { name: "Practice" })).toHaveAttribute("href", "/dashboard/call-lab");
  });
  it("routes the home, live, and report pages", () => {
    const app = read("src/App.tsx");
    for (const r of ['path="/dashboard/call-lab"', 'path="/dashboard/call-lab/live/:id"', 'path="/dashboard/call-lab/report/:id"']) expect(app).toContain(r);
  });
  it("calls edge functions that exist in the repo", () => {
    const client = read("src/lib/callLab/providers.ts") + read("src/lib/callLab/useCallLabSession.ts") + read("src/pages/CallLabReport.tsx");
    for (const fn of ["call-lab-turn", "call-lab-tts", "call-lab-evaluate"]) { expect(client).toContain(fn); expect(() => read(`supabase/functions/${fn}/index.ts`)).not.toThrow(); }
  });
  it("keeps sessions owner-scoped with staff read", () => {
    const sql = read("supabase/migrations/20260906010000_call_lab.sql");
    expect(sql).toContain("create policy call_lab_sessions_own on public.call_lab_sessions for all to authenticated using (user_id = auth.uid())");
    expect(sql).toContain("create policy call_lab_sessions_staff_read");
    expect(sql).toContain("create policy call_lab_events_own");
  });
  it("persists events idempotently on (session_id, event_id)", () => {
    expect(read("src/lib/callLab/useCallLabSession.ts")).toContain('onConflict: "session_id,event_id"');
    expect(read("supabase/migrations/20260906010000_call_lab.sql")).toMatch(/unique\s*\(session_id,\s*event_id\)|primary key \(session_id, event_id\)/);
  });
});
