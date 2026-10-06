import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic records only. The fake client implements just the chain the worklist uses.
const ME = "00000000-0000-4000-8000-0000000000aa";

type Row = Record<string, unknown>;
const db: {
  rows: Row[];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> | undefined }>;
  rpc: (fn: string, args?: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null };
} = { rows: [], rpcCalls: [], rpc: () => ({ data: null, error: null }) };

function makeRow(id: string, patch: Row = {}): Row {
  return {
    id, first_name: "Sample", last_name: id.toUpperCase(), email: `${id}@example.test`, phone: "+15555550123",
    state: "TX", license_status: "unlicensed", license_progress: "unlicensed", status: "new",
    next_step_stage_key: "applied", created_at: "2026-09-01T12:00:00Z", assigned_agent_id: "attrib-agent",
    last_contacted_at: null, next_action: null, next_action_due_at: null, next_step_due_at: null,
    phone_bad_at: null, email_bad_at: null, sms_consent_given: true, email_consent_given: true,
    time_zone: null, time_zone_source: null, recruiting_owner_user_id: null, last_contact_outcome: null,
    last_contact_outcome_at: null, last_contact_channel: null, next_action_set_at: null, waiting_reason: null,
    next_review_at: null, do_not_contact_at: null,
    ...patch,
  };
}

vi.mock("@/integrations/supabase/client", () => {
  function from(table: string) {
    const q: Record<string, unknown> & { head: boolean; range_: [number, number] | null } = { head: false, range_: null };
    const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return q; };
    Object.assign(q, {
      select: chain((_c: unknown, opts: unknown) => { q.head = Boolean((opts as { head?: boolean } | undefined)?.head); }),
      eq: chain(), neq: chain(), is: chain(), or: chain(), order: chain(),
      range: chain((a: unknown, b: unknown) => { q.range_ = [a as number, b as number]; }),
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        let result: unknown;
        if (table === "applications") {
          result = q.head
            ? { data: null, error: null, count: db.rows.length }
            : { data: db.rows.slice(q.range_?.[0] ?? 0, (q.range_?.[1] ?? 999) + 1), error: null };
        } else if (table === "next_step_stages") {
          result = { data: [{ stage_key: "applied", display_name: "Applied", order_index: 1, is_terminal: false }], error: null };
        } else {
          result = { data: [], error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    });
    return q;
  }
  return {
    supabase: {
      from,
      rpc: (fn: string, args?: Record<string, unknown>) => {
        db.rpcCalls.push({ fn, args });
        if (fn === "recruiting_staff_directory") {
          return Promise.resolve({ data: [{ user_id: ME, display_name: "Test Staffer", roles: ["admin"] }], error: null });
        }
        return Promise.resolve(db.rpc(fn, args));
      },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: ME }, isAdmin: true, isManager: false, isVa: false, isVaManager: false, isRecruiter: false }),
}));

import { RecruitingWorklist } from "@/components/pipeline/worklist/RecruitingWorklist";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <RecruitingWorklist />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  window.sessionStorage.clear();
  db.rpcCalls = [];
  db.rows = [makeRow("a1"), makeRow("a2", { recruiting_owner_user_id: ME, next_action: "Call", next_action_due_at: "2020-01-01T00:00:00Z", next_action_set_at: "2019-12-31T00:00:00Z", last_contacted_at: "2019-12-30T00:00:00Z" })];
});

afterEach(() => vi.restoreAllMocks());

describe("RecruitingWorklist", () => {
  it("shows full-dataset queue counts and keeps assigned-to-me distinct from org-wide", async () => {
    renderAt("/dashboard/recruiting?queue=all_open");
    const queues = await screen.findByRole("navigation", { name: "Saved queues" });
    expect(within(queues).getByRole("button", { name: /All open\s*2/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /Uncontacted\s*1/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /Overdue\s*1/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /Unassigned\s*1/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /My queue\s*1/ })).toBeTruthy();
    expect(screen.getByText(/Organization-wide/)).toBeTruthy();
  });

  it("a failed save keeps the typed note and shows the error; a retry sends the conflict guard and clears the draft", async () => {
    renderAt("/dashboard/recruiting?queue=uncontacted&person=a1");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });

    fireEvent.click(within(panel).getByRole("button", { name: "No answer" }));
    const notes = within(panel).getByLabelText("Notes") as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "Rang out twice, left voicemail" } });
    fireEvent.change(within(panel).getByLabelText("Due (your time)"), { target: { value: "2026-10-08T10:00" } });

    db.rpc = () => ({ data: null, error: { message: "conflict: another outcome (callback) was recorded at x", code: "40001" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    expect(await within(panel).findByRole("alert")).toBeTruthy();
    expect(within(panel).getByRole("alert").textContent).toMatch(/Someone else updated/);
    expect((within(panel).getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Rang out twice, left voicemail");
    const stored = Object.keys(window.sessionStorage).find((k) => k.includes(":draft:") && k.endsWith(":a1"));
    expect(stored).toBeTruthy();

    db.rpc = (fn, args) => ({
      data: { ...makeRow("a1"), last_contact_outcome: "no_answer", last_contact_outcome_at: "2026-10-06T19:00:00.123456+00:00", last_contacted_at: "2026-10-06T19:00:00Z", recruiting_owner_user_id: ME, next_action: args?.p_next_action, next_action_due_at: args?.p_next_action_due_at, next_action_set_at: "2026-10-06T19:00:00Z", log_id: "log-1" },
      error: null,
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect((within(panel).getByLabelText("Notes") as HTMLTextAreaElement).value).toBe(""));

    const call = db.rpcCalls.filter((c) => c.fn === "record_recruiting_outcome").at(-1);
    expect(call?.args).toMatchObject({
      p_application_id: "a1",
      p_outcome: "no_answer",
      p_channel: "call",
      p_notes: "Rang out twice, left voicemail",
      p_next_action: "Try again",
      p_expected_last_outcome_at: null,
      p_check_conflict: true,
    });
    expect(Object.keys(window.sessionStorage).some((k) => k.includes(":draft:") && k.endsWith(":a1"))).toBe(false);
    // The queue updated from the same response: a1 left Uncontacted.
    const queues = screen.getByRole("navigation", { name: "Saved queues" });
    await waitFor(() => expect(within(queues).getByRole("button", { name: /Uncontacted\s*0/ })).toBeTruthy());
  });

  it("opening a call link records nothing", async () => {
    renderAt("/dashboard/recruiting?queue=all_open&person=a1");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });
    fireEvent.click(within(panel).getByRole("link", { name: /Call Sample A1/ }));
    expect(db.rpcCalls.some((c) => c.fn === "record_recruiting_outcome" || c.fn === "log_contact_attempt")).toBe(false);
  });
});
