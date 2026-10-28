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
    // Every fixture row is a live, non-duplicate application, so the duplicate and
    // non-application head counts (the ones narrowed by is_duplicate / neq record_type)
    // are 0 and the live count equals the rows: coverage reconciles as complete.
    const q: Record<string, unknown> & { head: boolean; narrow: boolean; range_: [number, number] | null } = { head: false, narrow: false, range_: null };
    const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return q; };
    Object.assign(q, {
      select: chain((_c: unknown, opts: unknown) => { q.head = Boolean((opts as { head?: boolean } | undefined)?.head); }),
      eq: chain((col: unknown) => { if (col === "is_duplicate") q.narrow = true; }),
      neq: chain(() => { q.narrow = true; }),
      is: chain(), or: chain(), order: chain(),
      range: chain((a: unknown, b: unknown) => { q.range_ = [a as number, b as number]; }),
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        let result: unknown;
        if (table === "applications") {
          result = q.head
            ? { data: null, error: null, count: q.narrow ? 0 : db.rows.length }
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

// The colour layer's side effects (2026-10-28) are mocked so a test can say exactly when they fire:
// bubbles once after a confirmed save, from the button pressed, never on load and never after an
// error; a tick when the list changes. prefersReducedMotion true makes CountUp paint the final
// number at once.
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn(() => Promise.resolve()), prefersReducedMotion: () => true }));
vi.mock("@/hooks/useSoundEffects", () => ({ playSoundEffect: vi.fn(), useSoundEffects: () => ({ playSound: vi.fn() }) }));

import { celebrate } from "@/lib/celebrate";
import { playSoundEffect } from "@/hooks/useSoundEffects";
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
  db.rpc = () => ({ data: null, error: null });
  db.rows = [makeRow("a1"), makeRow("a2", { recruiting_owner_user_id: ME, next_action: "Call", next_action_due_at: "2020-01-01T00:00:00Z", next_action_set_at: "2019-12-31T00:00:00Z", last_contacted_at: "2019-12-30T00:00:00Z" })];
  vi.mocked(celebrate).mockClear();
  vi.mocked(playSoundEffect).mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("RecruitingWorklist", () => {
  it("shows full-dataset queue counts and keeps assigned-to-me distinct from org-wide", async () => {
    renderAt("/dashboard/recruiting?queue=likely");
    const queues = await screen.findByRole("navigation", { name: "Saved queues" });
    // Nothing plays on page load.
    expect(playSoundEffect).not.toHaveBeenCalled();
    // Two big lists are always visible. Call today, New, Worked today and Booked open from their
    // tiles and nowhere else (one entry point per list); the rest sit behind "More lists".
    expect(within(queues).getByRole("button", { name: /Mine\s*1/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /Likely to join\s*0/ })).toBeTruthy();
    expect(within(queues).queryByRole("button", { name: /Call today/ })).toBeNull();
    expect(within(queues).queryByRole("button", { name: /^New\b/ })).toBeNull();
    expect(within(queues).queryByRole("button", { name: /Everyone/ })).toBeNull();
    const more = within(queues).getByRole("button", { name: /More lists/ });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(within(queues).getByRole("button", { name: /Everyone\s*2/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /Never contacted\s*1/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /Overdue\s*1/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /No owner\s*1/ })).toBeTruthy();
    expect(within(queues).getByRole("button", { name: /No owner or next step\s*1/ })).toBeTruthy();
    expect(within(queues).queryByRole("button", { name: /Call today/ })).toBeNull();
    expect(within(queues).queryByRole("button", { name: /Worked today/ })).toBeNull();
    expect(within(queues).queryByRole("button", { name: /Booked/ })).toBeNull();
    expect(screen.getByText(/Organization-wide/)).toBeTruthy();
    // The scoreboard reads the same full set: one person is late, so one call today, and the
    // tile is how that list opens.
    const board = screen.getByRole("region", { name: "Today's numbers" });
    const callToday = within(board).getByRole("button", { name: /Call today/ });
    expect(callToday.textContent).toContain("1");
    fireEvent.click(callToday);
    expect(callToday.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Call today: 1 person\./)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Queue" })).getByRole("button", { name: /Sample A2/ })).toBeTruthy();
    // Moving to another list is one short tick; the tile itself wears the "act now" tone with a bubble the reader skips.
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
    expect(playSoundEffect).toHaveBeenCalledWith("tick");
    expect(callToday.querySelector("span[aria-hidden='true']")?.className).toMatch(/text-tone-hot/);
    expect(within(board).getByRole("button", { name: /Worked today/ }).querySelector("span[aria-hidden='true']")?.className).toMatch(/text-tone-good/);
    expect(within(board).getByRole("button", { name: /Booked/ }).querySelector("span[aria-hidden='true']")?.className).toMatch(/text-tone-cool/);
  });

  it("the open list wears the gold tint and says so with aria-pressed; a tap on another list ticks once", async () => {
    renderAt("/dashboard/recruiting?queue=likely");
    const queues = await screen.findByRole("navigation", { name: "Saved queues" });
    const likely = within(queues).getByRole("button", { name: /Likely to join/ });
    const mine = within(queues).getByRole("button", { name: /^Mine/ });
    expect(likely).toHaveAttribute("aria-pressed", "true");
    expect(likely.className).toMatch(/bg-tone-gold\/12/);
    expect(likely.className).toMatch(/text-tone-gold/);
    expect(likely.className).toMatch(/border-tone-gold\/35/);
    expect(likely.className).toMatch(/\bh-11\b/);
    expect(mine).toHaveAttribute("aria-pressed", "false");
    expect(mine.className).not.toMatch(/tone-gold/);
    expect(playSoundEffect).not.toHaveBeenCalled();

    fireEvent.click(mine);
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
    expect(playSoundEffect).toHaveBeenCalledWith("tick");
    expect(within(queues).getByRole("button", { name: /^Mine/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(queues).getByRole("button", { name: /^Mine/ }).className).toMatch(/bg-tone-gold\/12/);
    expect(within(queues).getByRole("button", { name: /Likely to join/ })).toHaveAttribute("aria-pressed", "false");
    expect(within(queues).getByRole("button", { name: /Likely to join/ }).className).not.toMatch(/tone-gold/);
    // Tapping the list that is already open changes nothing, so it makes no sound.
    fireEvent.click(within(queues).getByRole("button", { name: /^Mine/ }));
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
    expect(celebrate).not.toHaveBeenCalled();
  });

  it("each row has an initials bubble in the status tone that assistive technology skips; the name stays the row's name", async () => {
    renderAt("/dashboard/recruiting?queue=all_open");
    const list = await screen.findByRole("list", { name: "Queue" });
    expect(list.className).toMatch(/apex-rise-list/);
    const a2 = within(list).getByRole("button", { name: /Sample A2/ });
    expect(a2).toHaveAccessibleName(/^Sample A2/);
    expect(a2.className).toMatch(/apex-lift/);
    const bubble = a2.querySelector("span[aria-hidden='true']");
    expect(bubble?.textContent).toBe("SA");
    expect(bubble?.className).toMatch(/\bh-10\b/);
    // Late is "act now": the same tone the status pill beside the name wears.
    expect(bubble?.className).toMatch(/text-tone-hot/);
    expect(within(a2).getByText(/^Late · /).className).toMatch(/text-tone-hot/);
    const a1 = within(list).getByRole("button", { name: /Sample A1/ });
    expect(a1).toHaveAccessibleName(/^Sample A1/);
    expect(a1.querySelector("span[aria-hidden='true']")?.className).toMatch(/text-tone-slate/); // no next step: quiet
    // The panel header carries the same bubble, larger, beside a 20px name and the status in words.
    // (The page opens the first person a tick after the list renders, so wait for the heading.)
    const panel = screen.getByRole("complementary", { name: "Selected person" });
    const title = await within(panel).findByRole("heading", { level: 2, name: "Sample A2" });
    expect(title.className).toMatch(/\btext-xl\b/);
    const big = panel.querySelector("span[aria-hidden='true'].h-12");
    expect(big?.textContent).toBe("SA");
    expect(big?.className).toMatch(/text-tone-hot/);
  });

  it("Worked today and Booked are lists too: each tile opens exactly the people it counts", async () => {
    const now = new Date().toISOString();
    db.rows = [
      makeRow("a1"),
      makeRow("b1", { last_contact_outcome: "appointment_booked", last_contact_outcome_at: "2026-09-20T17:00:00Z", last_contacted_at: "2026-09-20T17:00:00Z", recruiting_owner_user_id: ME, next_action: "Interview", next_action_due_at: "2099-01-01T17:00:00Z", next_action_set_at: "2026-09-20T17:00:00Z" }),
      makeRow("w1", { last_contact_outcome: "no_answer", last_contact_outcome_at: now, last_contacted_at: now, recruiting_owner_user_id: ME, next_action: "Try again", next_action_due_at: "2099-01-02T17:00:00Z", next_action_set_at: now }),
      // Said no today: closed, and still a call made today.
      makeRow("n1", { last_contact_outcome: "not_interested", last_contact_outcome_at: now, last_contacted_at: now, recruiting_owner_user_id: ME }),
    ];
    renderAt("/dashboard/recruiting?queue=all_open");
    await screen.findByRole("list", { name: "Queue" });
    const board = screen.getByRole("region", { name: "Today's numbers" });

    const booked = within(board).getByRole("button", { name: /Booked/ });
    expect(booked.textContent).toContain("1");
    fireEvent.click(booked);
    expect(booked.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Booked: 1 person\./)).toBeTruthy();
    let list = screen.getByRole("list", { name: "Queue" });
    expect(within(list).getByRole("button", { name: /Sample B1/ })).toBeTruthy();
    expect(within(list).queryByRole("button", { name: /Sample A1/ })).toBeNull();

    const worked = within(board).getByRole("button", { name: /Worked today/ });
    expect(worked.textContent).toContain("2");
    fireEvent.click(worked);
    expect(worked.getAttribute("aria-pressed")).toBe("true");
    expect(booked.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText(/Worked today: 2 people\./)).toBeTruthy();
    list = screen.getByRole("list", { name: "Queue" });
    expect(within(list).getByRole("button", { name: /Sample W1/ })).toBeTruthy();
    expect(within(list).getByRole("button", { name: /Sample N1/ })).toBeTruthy();
    expect(within(list).queryByRole("button", { name: /Sample B1/ })).toBeNull();
    // The queue row does not repeat the tile lists, so each has one entry point.
    const queues = screen.getByRole("navigation", { name: "Saved queues" });
    expect(within(queues).queryByRole("button", { name: /Worked today/ })).toBeNull();
    expect(within(queues).queryByRole("button", { name: /Booked/ })).toBeNull();
  });

  it("a failed save keeps the typed note and shows the error; a retry sends the conflict guard and clears the draft", async () => {
    renderAt("/dashboard/recruiting?queue=uncontacted&person=a1");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });

    fireEvent.click(within(panel).getByRole("button", { name: "No answer" }));
    const notes = within(panel).getByLabelText("Notes") as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "Rang out twice, left voicemail" } });
    fireEvent.change(within(panel).getByLabelText("Due (your time)"), { target: { value: "2026-10-08T10:00" } });

    db.rpc = () => ({ data: null, error: { message: "conflict: another outcome (callback) was recorded at x", code: "40001" } });
    const save = within(panel).getByRole("button", { name: "Save" });
    fireEvent.click(save);
    expect(await within(panel).findByRole("alert")).toBeTruthy();
    expect(within(panel).getByRole("alert").textContent).toMatch(/Someone else updated/);
    expect((within(panel).getByLabelText("Notes") as HTMLTextAreaElement).value).toBe("Rang out twice, left voicemail");
    const stored = Object.keys(window.sessionStorage).find((k) => k.includes(":draft:") && k.endsWith(":a1"));
    expect(stored).toBeTruthy();
    // A failed save is the error alone: no bubbles, no sound.
    expect(celebrate).not.toHaveBeenCalled();
    expect(playSoundEffect).not.toHaveBeenCalled();

    db.rpc = (fn, args) => ({
      data: { ...makeRow("a1"), last_contact_outcome: "no_answer", last_contact_outcome_at: "2026-10-06T19:00:00.123456+00:00", last_contacted_at: "2026-10-06T19:00:00Z", recruiting_owner_user_id: ME, next_action: args?.p_next_action, next_action_due_at: args?.p_next_action_due_at, next_action_set_at: "2026-10-06T19:00:00Z", log_id: "log-1" },
      error: null,
    });
    fireEvent.click(save);
    // A confirmed save resets the form: the outcome is cleared, so the follow-up fields fold away.
    await waitFor(() => expect(within(panel).queryByLabelText("Notes")).toBeNull());
    expect(within(panel).getByRole("button", { name: "No answer" }).getAttribute("aria-pressed")).toBe("false");
    // The win is marked once, after the server confirmed it, from the button that was pressed.
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1));
    expect(celebrate).toHaveBeenCalledWith("save", save);

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

  it("No answer prefills Try again for tomorrow 10 AM, so one tap saves it", async () => {
    renderAt("/dashboard/recruiting?queue=uncontacted&person=a1");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });
    fireEvent.click(within(panel).getByRole("button", { name: "No answer" }));
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T10:00`;
    expect((within(panel).getByLabelText("Due (your time)") as HTMLInputElement).value).toBe(expected);
    expect((within(panel).getByLabelText("What to do") as HTMLInputElement).value).toBe("Try again");
    // What the outcome does is written under the buttons, not only in a hover title.
    expect(within(panel).getByText("No answer: Rang out, voicemail, or no reply.")).toBeTruthy();

    db.rpc = (fn, args) => ({
      data: { ...makeRow("a1"), last_contact_outcome: "no_answer", last_contact_outcome_at: "2026-10-28T19:00:00Z", last_contacted_at: "2026-10-28T19:00:00Z", recruiting_owner_user_id: ME, next_action: args?.p_next_action, next_action_due_at: args?.p_next_action_due_at, next_action_set_at: "2026-10-28T19:00:00Z", log_id: "log-2" },
      error: null,
    });
    fireEvent.click(within(panel).getByRole("button", { name: /Save & next person/ }));
    await waitFor(() => expect(db.rpcCalls.some((c) => c.fn === "record_recruiting_outcome")).toBe(true));
    const call = db.rpcCalls.filter((c) => c.fn === "record_recruiting_outcome").at(-1);
    expect(call?.args).toMatchObject({
      p_outcome: "no_answer",
      p_channel: "call",
      p_next_action: "Try again",
      p_next_action_due_at: new Date(expected).toISOString(),
    });
  });

  it("a booked appointment celebrates with the chime kind, once, after the save landed", async () => {
    renderAt("/dashboard/recruiting?queue=uncontacted&person=a1");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });
    const booked = within(panel).getByRole("button", { name: "Appointment booked" });
    // Each outcome carries a small icon in its meaning's tone; the words are unchanged and the icon is skipped by a reader.
    expect(booked.querySelector("svg")?.getAttribute("class")).toMatch(/text-tone-cool/);
    expect(booked.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(within(panel).getByRole("button", { name: "No answer" }).querySelector("svg")?.getAttribute("class")).toMatch(/text-tone-slate/);
    expect(within(panel).getByRole("button", { name: "Callback" }).querySelector("svg")?.getAttribute("class")).toMatch(/text-tone-warm/);
    expect(within(panel).getByRole("button", { name: "Interested" }).querySelector("svg")?.getAttribute("class")).toMatch(/text-tone-good/);
    expect(within(panel).getByRole("button", { name: "Not interested" }).querySelector("svg")?.getAttribute("class")).toMatch(/text-tone-hot/);
    expect(within(panel).getByRole("button", { name: "Wrong number" }).querySelector("svg")?.getAttribute("class")).toMatch(/text-tone-hot/);
    fireEvent.click(booked);
    expect(booked).toHaveAttribute("aria-pressed", "true");
    expect(booked.className).toMatch(/bg-tone-cool\/12/);
    expect(within(panel).getByRole("button", { name: "No answer" }).className).not.toMatch(/bg-tone-/);
    expect(celebrate).not.toHaveBeenCalled();
    fireEvent.change(within(panel).getByLabelText("Due (your time)"), { target: { value: "2026-11-02T10:00" } });

    db.rpc = (fn, args) => ({
      data: { ...makeRow("a1"), last_contact_outcome: "appointment_booked", last_contact_outcome_at: "2026-10-28T19:00:00Z", last_contacted_at: "2026-10-28T19:00:00Z", recruiting_owner_user_id: ME, next_action: args?.p_next_action, next_action_due_at: args?.p_next_action_due_at, next_action_set_at: "2026-10-28T19:00:00Z", log_id: "log-3" },
      error: null,
    });
    const next = within(panel).getByRole("button", { name: /Save & next person/ });
    fireEvent.click(next);
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1));
    expect(celebrate).toHaveBeenCalledWith("booked", next);
    const call = db.rpcCalls.filter((c) => c.fn === "record_recruiting_outcome").at(-1);
    expect(call?.args).toMatchObject({ p_outcome: "appointment_booked", p_next_action: "Interview" });
  });

  it("the quick pick whose time fills the field wears the gold tint; typing a time by hand clears it", async () => {
    renderAt("/dashboard/recruiting?queue=uncontacted&person=a1");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });
    fireEvent.click(within(panel).getByRole("button", { name: "No answer" }));
    // No answer prefills tomorrow 10 AM, the same value as the quick pick, so that pick is the chosen one.
    const tomorrow = within(panel).getByRole("button", { name: "Tomorrow 10 AM" });
    expect(tomorrow).toHaveAttribute("aria-pressed", "true");
    expect(tomorrow.className).toMatch(/bg-tone-gold\/12/);
    const threeDays = within(panel).getByRole("button", { name: "In 3 days" });
    expect(threeDays).toHaveAttribute("aria-pressed", "false");
    expect(threeDays.className).not.toMatch(/tone-gold/);
    fireEvent.click(threeDays);
    expect(threeDays).toHaveAttribute("aria-pressed", "true");
    expect(threeDays.className).toMatch(/bg-tone-gold\/12/);
    expect(within(panel).getByRole("button", { name: "Tomorrow 10 AM" })).toHaveAttribute("aria-pressed", "false");
    expect((within(panel).getByLabelText("Due (your time)") as HTMLInputElement).value).toMatch(/T10:00$/);
    fireEvent.change(within(panel).getByLabelText("Due (your time)"), { target: { value: "2026-11-05T09:30" } });
    for (const name of ["In 2 hours", "Tomorrow 10 AM", "In 3 days", "Next week"]) {
      expect(within(panel).getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
    expect(playSoundEffect).not.toHaveBeenCalled();
  });

  it("saving Do not contact records it without bubbles or a sound", async () => {
    renderAt("/dashboard/recruiting?queue=uncontacted&person=a1");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });
    fireEvent.click(within(panel).getByRole("button", { name: /Do not contact…/ }));
    fireEvent.click(within(panel).getByRole("button", { name: "Yes, do not contact" }));
    db.rpc = () => ({
      data: { ...makeRow("a1"), last_contact_outcome: "do_not_contact", last_contact_outcome_at: "2026-10-28T19:00:00Z", last_contacted_at: "2026-10-28T19:00:00Z", do_not_contact_at: "2026-10-28T19:00:00Z", recruiting_owner_user_id: ME, log_id: "log-4" },
      error: null,
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(db.rpcCalls.some((c) => c.fn === "record_recruiting_outcome" && c.args?.p_outcome === "do_not_contact")).toBe(true));
    await waitFor(() => expect(within(panel).queryByText(/Do not contact is selected/)).toBeNull());
    expect(celebrate).not.toHaveBeenCalled();
    expect(playSoundEffect).not.toHaveBeenCalled();
  });

  it("the channel stays one line, Reached by Call, until Change opens the five choices", async () => {
    renderAt("/dashboard/recruiting?queue=uncontacted&person=a1");
    const panel = await screen.findByRole("complementary", { name: "Selected person" });
    fireEvent.click(within(panel).getByRole("button", { name: "No answer" }));
    expect(within(panel).getByText("Reached by Call")).toBeTruthy();
    expect(within(panel).queryByRole("group", { name: "How did you reach them?" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: /Change how you reached them/ }));
    const choices = within(panel).getByRole("group", { name: "How did you reach them?" });
    expect(within(choices).getByRole("button", { name: "Call" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(choices).getByRole("button", { name: "Text" }));
    expect(within(panel).queryByRole("group", { name: "How did you reach them?" })).toBeNull();
    expect(within(panel).getByText("Reached by Text")).toBeTruthy();
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
