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
  // A desktop browser: only the wide query matches, as a real one would report it.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: q === "(min-width: 1024px)", media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  window.sessionStorage.clear();
  db.rpcCalls = [];
  db.rows = [makeRow("a1"), makeRow("a2", { recruiting_owner_user_id: ME, next_action: "Call", next_action_due_at: "2020-01-01T00:00:00Z", next_action_set_at: "2019-12-31T00:00:00Z", last_contacted_at: "2019-12-30T00:00:00Z" })];
});

afterEach(() => vi.restoreAllMocks());

describe("RecruitingWorklist", () => {
  it("shows full-dataset queue counts and keeps assigned-to-me distinct from org-wide", async () => {
    renderAt("/dashboard/recruiting?queue=likely");
    const queues = await screen.findByRole("navigation", { name: "Saved queues" });
    // Four big lists are always visible; the rest sit one tap away behind "More lists".
    expect(within(queues).getByRole("button", { name: /Mine\s*1/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /Call today\s*1/ })).toBeTruthy();
    expect(within(queues).queryByRole("button", { name: /Everyone/ })).toBeNull();
    const more = within(queues).getByRole("button", { name: /More lists/ });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(within(queues).getByRole("button", { name: /Everyone\s*2/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /Never contacted\s*1/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /Overdue\s*1/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /No owner\s*1/ })).toBeTruthy();
    expect(screen.getByText(/Organization-wide/)).toBeTruthy();
    // The scoreboard reads the same full set: one person is late, so one call today.
    const board = screen.getByRole("region", { name: "Today's numbers" });
    const callToday = within(board).getByRole("button", { name: /Call today/ });
    expect(callToday.textContent).toContain("1");
    fireEvent.click(callToday);
    expect(callToday.getAttribute("aria-pressed")).toBe("true");
    expect(within(queues).getByRole("button", { name: /Call today\s*1/ }).getAttribute("aria-pressed")).toBe("true");
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
    // A confirmed save resets the form: the outcome is cleared, so the follow-up fields fold away.
    await waitFor(() => expect(within(panel).queryByLabelText("Notes")).toBeNull());
    expect(within(panel).getByRole("button", { name: "No answer" }).getAttribute("aria-pressed")).toBe("false");

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
    await waitFor(() => expect(within(queues).getByRole("button", { name: /Never contacted\s*0/ })).toBeTruthy());
  });

  it("a quick pick fills the due time, and the follow-up fields only appear after an outcome", async () => {
    renderAt("/dashboard/recruiting?queue=uncontacted&person=a1");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });
    expect(within(panel).queryByLabelText("Due (your time)")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Callback" }));
    const due = within(panel).getByLabelText("Due (your time)") as HTMLInputElement;
    expect(due.value).toBe("");
    fireEvent.click(within(panel).getByRole("button", { name: "Tomorrow 10 AM" }));
    expect(due.value).toMatch(/^\d{4}-\d{2}-\d{2}T10:00$/);
    expect((within(panel).getByLabelText("What to do") as HTMLInputElement).value).toBe("Call back");
  });

  it("do not contact takes a second, explicit tap", async () => {
    renderAt("/dashboard/recruiting?queue=uncontacted&person=a1");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });
    expect(within(panel).queryByRole("button", { name: "Do not contact" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: /Do not contact…/ }));
    const confirm = within(panel).getByRole("group", { name: "Confirm do not contact" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(within(panel).queryByRole("group", { name: "Confirm do not contact" })).toBeNull();
    expect(within(panel).queryByText(/Do not contact is selected/)).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: /Do not contact…/ }));
    fireEvent.click(within(panel).getByRole("button", { name: "Yes, do not contact" }));
    expect(within(panel).getByText(/Do not contact is selected/)).toBeTruthy();
    expect(db.rpcCalls.some((c) => c.fn === "record_recruiting_outcome")).toBe(false);
  });

  it("the owner shows on the folded row without opening it", async () => {
    renderAt("/dashboard/recruiting?queue=mine&person=a2");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });
    const ownerRow = within(panel).getByText("Owner").closest("summary");
    expect(ownerRow?.textContent).toContain("Test Staffer (you)");
  });

  it("opening a call link records nothing", async () => {
    renderAt("/dashboard/recruiting?queue=all_open&person=a1");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });
    fireEvent.click(within(panel).getByRole("link", { name: /Call Sample A1/ }));
    expect(db.rpcCalls.some((c) => c.fn === "record_recruiting_outcome" || c.fn === "log_contact_attempt")).toBe(false);
  });
  it("opens the person another page links with ?id= / ?lead= / ?focus=, in All open", async () => {
    for (const param of ["id", "lead", "focus"]) {
      const view = renderAt(`/dashboard/recruiting?${param}=a1`);
      const panel = await screen.findByRole("complementary", { name: "Selected person" });
      expect(await within(panel).findByText(/A1/)).toBeTruthy();
      const queues = screen.getByRole("navigation", { name: "Saved queues" });
      // "Everyone" lives behind More lists, which stays open while it is the chosen list.
      expect(within(queues).getByRole("button", { name: /Everyone/ }).getAttribute("aria-pressed")).toBe("true");
      view.unmount();
    }
  });

  it("says so when a linked person is not in the viewer's worklist instead of opening someone else", async () => {
    renderAt("/dashboard/recruiting?id=not-a-row");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });
    expect(await within(panel).findByText(/not in your worklist/)).toBeTruthy();
    expect(within(panel).getByRole("link", { name: /classic applicants view/ }).getAttribute("href"))
      .toBe("/dashboard/recruiting?view=classic&id=not-a-row");
  });
});
