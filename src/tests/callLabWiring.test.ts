import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AGENT_CLOUD_PRIMARY_NAV } from "@/components/layout/agentCloudNavigation";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Call Lab wiring contract: the nav item, the three routes, the three edge
 * functions the client calls, and the RLS the migration promises must all
 * agree. A drift in any one of them is a page that renders and does nothing.
 */
describe("Call Lab wiring", () => {
  it("is in the side navigation under Training", () => {
    const items = AGENT_CLOUD_PRIMARY_NAV.flatMap((g) => ("items" in g ? g.items : [g]));
    expect(items.find((i) => i.href === "/dashboard/call-lab")?.label).toBe("Call Lab");
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
