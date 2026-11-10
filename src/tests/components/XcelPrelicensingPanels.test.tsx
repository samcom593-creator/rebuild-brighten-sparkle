/**
 * WP1 staff panels on /dashboard/pre-licensing (onboarding audit 2026-11-10).
 *
 * XcelUnmatchedPanel: active Xcel students with no application/agent link get a
 * one-click link through admin_link_xcel_student; candidates are filtered
 * client-side (no LIKE pattern is ever built from what staff type).
 * CourseProofReviewPanel: proofs waiting for a human open through a 300s signed
 * URL and are decided through admin_review_course_proof.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  rpc: vi.fn(async (fn: string, _args: Record<string, unknown>) =>
    fn === "admin_xcel_unmatched_active"
      ? { data: db.tables.v_xcel_unmatched_active ?? [], error: null }
      : { data: { ok: true }, error: null }),
  signed: vi.fn(async (_path: string, _secs: number) => ({ data: { signedUrl: "https://signed.example/x.png" }, error: null })),
  calls: [] as Array<{ table: string; op: string; args: unknown[] }>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const result = () => ({ data: db.tables[table] ?? [], error: null });
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "gte", "order", "limit", "in", "is"]) {
        chain[op] = (...args: unknown[]) => { db.calls.push({ table, op, args }); return chain; };
      }
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject);
      return chain;
    },
    rpc: (fn: string, args: Record<string, unknown>) => db.rpc(fn, args),
    storage: { from: () => ({ createSignedUrl: (p: string, s: number) => db.signed(p, s) }) },
  },
}));

import { XcelUnmatchedPanel, nameMatches } from "@/components/prelicensing/XcelUnmatchedPanel";
import { CourseProofReviewPanel, PROOF_SIGNED_URL_SECONDS } from "@/components/prelicensing/CourseProofReviewPanel";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  db.calls = [];
  db.rpc.mockClear();
  db.signed.mockClear();
  db.tables = {
    v_xcel_unmatched_active: [
      { student_id: "stu-1", first_name: "Jakara", last_initial: "E", pct_complete: 100, last_log_in: "2026-11-07",
        completed_on: "2026-11-03", days_since_enrolled: 7, days_unmatched: 6, hiring_manager_name: "N/A",
        course_name: "Texas Life Pre-licensing", was_unlinked: false },
    ],
    applications: [
      { id: "app-1", first_name: "Jakara", last_name: "Evans", created_at: "2026-11-01T10:00:00Z", license_status: "unlicensed" },
      { id: "app-2", first_name: "Someone", last_name: "Else", created_at: "2026-10-01T10:00:00Z", license_status: "unlicensed" },
    ],
    agents: [{ id: "agent-1", display_name: "Jakara Evans", status: "active" }],
    xcel_pre_licensing_students: [],
    licensing_course_proofs: [
      { id: "proof-1", application_id: "app-1", screenshot_path: "app-1/proof.png", content_type: "image/png", status: "submitted", submitted_at: "2026-11-10T18:00:00Z" },
    ],
  };
});

describe("nameMatches", () => {
  it("matches every typed token, case-insensitively, and ignores one-letter input", () => {
    expect(nameMatches("jak ev", "Jakara", "Evans")).toBe(true);
    expect(nameMatches("jakara smith", "Jakara", "Evans")).toBe(false);
    expect(nameMatches("j", "Jakara", "Evans")).toBe(false);
  });
});

describe("XcelUnmatchedPanel", () => {
  it("lists unlinked students by first name + initial from the gated RPC, no contact fields", async () => {
    wrap(<XcelUnmatchedPanel showAutoMatches={false} />);
    expect(await screen.findByText("Jakara E.")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(db.rpc).toHaveBeenCalledWith("admin_xcel_unmatched_active", {});
    // the worklist row type carries no contact field
    expect(Object.keys(db.tables.v_xcel_unmatched_active[0]).join(",")).not.toMatch(/email|phone/);
  });

  it("links a student to the picked application through admin_link_xcel_student", async () => {
    wrap(<XcelUnmatchedPanel showAutoMatches={false} />);
    fireEvent.click(await screen.findByRole("button", { name: /link/i }));
    // picker is prefilled with the student's first name and filters client-side
    expect(await screen.findByText(/Application · Jakara Evans/)).toBeInTheDocument();
    expect(screen.queryByText(/Someone Else/)).not.toBeInTheDocument();
    const row = screen.getByText(/Application · Jakara Evans/).closest("div") as HTMLElement;
    fireEvent.click(row.querySelector("button") as HTMLButtonElement);
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith("admin_link_xcel_student", {
      p_student_id: "stu-1", p_application_id: "app-1", p_agent_id: null,
    }));
  });

  it("says so when every active student is linked", async () => {
    db.tables.v_xcel_unmatched_active = [];
    wrap(<XcelUnmatchedPanel showAutoMatches={false} />);
    expect(await screen.findByText(/Every active Xcel student is linked/)).toBeInTheDocument();
  });
});

describe("CourseProofReviewPanel", () => {
  it("opens the screenshot through a 300-second signed URL", async () => {
    wrap(<CourseProofReviewPanel />);
    expect(await screen.findByText("Jakara")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view/i }));
    await waitFor(() => expect(db.signed).toHaveBeenCalledWith("app-1/proof.png", 300));
    expect(PROOF_SIGNED_URL_SECONDS).toBe(300);
    expect(await screen.findByAltText(/Course purchase proof submitted by Jakara/)).toBeInTheDocument();
  });

  it("records a verify through admin_review_course_proof", async () => {
    wrap(<CourseProofReviewPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /verify/i }));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith("admin_review_course_proof", {
      p_proof_id: "proof-1", p_decision: "verified",
    }));
  });

  it("asks only for proofs still waiting (submitted / pending)", async () => {
    wrap(<CourseProofReviewPanel />);
    await screen.findByText("Jakara");
    const inCall = db.calls.find((c) => c.table === "licensing_course_proofs" && c.op === "in");
    expect(inCall?.args).toEqual(["status", ["submitted", "pending"]]);
  });
});
