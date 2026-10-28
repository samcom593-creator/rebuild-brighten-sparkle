/**
 * ExpectedStartControl, Grow review fix 2026-10-28 (finding 21): the trigger is a 44px row
 * control with 14px words, every control inside the popover is at least 44px, the one gold
 * Save button is 48px, and nothing reads under 13px.
 *
 * Colour layer (2026-10-28): a start date that saved is the chime, once, from where Save sat;
 * a refused save keeps its message and plays nothing; "not attending" and a no-show are kept
 * quietly; a start recorded as attended is the full burst. The RPC arguments are unchanged.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; args: unknown }>,
  error: null as null | { message: string },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => {
      db.calls.push({ fn, args });
      return Promise.resolve(db.error ? { data: null, error: db.error } : { data: null, error: null });
    },
  },
}));
// The burst and the sounds are spied, never run: jsdom has no canvas and no audio.
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn(() => Promise.resolve()), prefersReducedMotion: () => true }));
vi.mock("@/hooks/useSoundEffects", () => ({ playSoundEffect: vi.fn(), useSoundEffects: () => ({ playSound: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { ExpectedStartControl } from "@/components/onboarding/ExpectedStartControl";
import { celebrate } from "@/lib/celebrate";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import { toast } from "sonner";

const FACTS = {
  agent_id: "agent-1",
  agent_name: "Di Park",
  expected_start_on: "2026-11-02",
  expected_start_status: "confirmed",
  start_outcome: null,
  start_outcome_on: null,
};

function renderControl(facts = FACTS) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ExpectedStartControl facts={facts} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  db.calls = [];
  db.error = null;
  vi.mocked(celebrate).mockClear();
  vi.mocked(playSoundEffect).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const openControl = () => fireEvent.click(screen.getByRole("button", { name: "Expected start for Di Park" }));

describe("ExpectedStartControl", () => {
  it("is a 44px, 14px row control that says the status and date in words", () => {
    renderControl();
    const trigger = screen.getByRole("button", { name: "Expected start for Di Park" });
    expect(trigger).toHaveTextContent("Confirmed · 2026-11-02");
    expect(trigger.className).toMatch(/\bh-11\b/);
    expect(trigger.className).toMatch(/\btext-sm\b/);
    expect(trigger.className).not.toMatch(/\bh-7\b|\btext-xs\b/);
  });

  it("says 'Set expected start' when nothing is on file, in muted words rather than an empty box", () => {
    renderControl({ ...FACTS, expected_start_on: null, expected_start_status: null });
    const trigger = screen.getByRole("button", { name: "Expected start for Di Park" });
    expect(trigger).toHaveTextContent("Set expected start");
    expect(trigger.className).toMatch(/\btext-muted-foreground\b/);
  });

  it("opens to controls that are all at least 44px, a 48px gold Save, and no text under 13px", async () => {
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: "Expected start for Di Park" }));
    const date = await screen.findByLabelText("Expected start date");
    expect(date.className).toMatch(/\bh-11\b/);
    expect(screen.getByRole("combobox", { name: "Expected start status" }).className).toMatch(/\bh-11\b/);
    expect(screen.getByLabelText("Note").className).toMatch(/\bh-11\b/);
    const save = screen.getByRole("button", { name: "Save expected start" });
    expect(save.className).toMatch(/\bh-12\b/);
    expect(save.className).toMatch(/\bbg-primary\b/);
    for (const name of ["Attended", "No-show", "Rescheduled"]) {
      expect(screen.getByRole("button", { name }).className).toMatch(/\bh-11\b/);
    }
    expect(screen.getByLabelText("New start date for the reschedule").className).toMatch(/\bh-11\b/);
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll('[class*="text-xs"], [class*="text-[11px]"], [class*="text-[12px]"]')).toHaveLength(0);
    expect(screen.getByText("Their answer about a start date. It never changes employment status.").className).toMatch(/\btext-sm\b/);
  });

  it("a saved start date is the chime, once, from where Save sat; a refused save keeps its message and plays nothing", async () => {
    renderControl();
    openControl();
    const save = await screen.findByRole("button", { name: "Save expected start" });
    // jsdom lays nothing out; give the button a place. The popover closes the moment the save goes
    // through, so the burst must come from where the button was, not from a gone element.
    save.getBoundingClientRect = () => ({ x: 100, y: 200, left: 100, top: 200, width: 120, height: 48, right: 220, bottom: 248, toJSON: () => ({}) }) as DOMRect;
    fireEvent.click(save);
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1));
    expect(celebrate).toHaveBeenCalledWith("booked", { x: 160 / window.innerWidth, y: 224 / window.innerHeight });
    expect(db.calls).toEqual([{ fn: "set_expected_start", args: { p_agent_id: "agent-1", p_expected_start_on: "2026-11-02", p_status: "confirmed", p_note: null } }]);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(playSoundEffect).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    db.error = { message: "not allowed" };
    openControl();
    fireEvent.click(await screen.findByRole("button", { name: "Save expected start" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Di Park: not allowed"));
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(playSoundEffect).not.toHaveBeenCalled();
  });

  it("'Not attending' is an answer, not a booking: the save goes through and nothing bursts", async () => {
    renderControl({ ...FACTS, expected_start_status: "not_attending" });
    openControl();
    fireEvent.click(await screen.findByRole("button", { name: "Save expected start" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(db.calls[0]).toMatchObject({ fn: "set_expected_start", args: { p_status: "not_attending" } });
    expect(celebrate).not.toHaveBeenCalled();
    expect(playSoundEffect).not.toHaveBeenCalled();
  });

  it("a start recorded as attended is the full burst after it saved; a no-show is kept quietly", async () => {
    renderControl({ ...FACTS, expected_start_on: "2026-10-01" });
    openControl();
    const attended = await screen.findByRole("button", { name: "Attended" });
    expect(attended).toBeEnabled();
    fireEvent.click(attended);
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1));
    // jsdom gives the button no size, so the burst takes its default origin.
    expect(celebrate).toHaveBeenCalledWith("win", null);
    expect(db.calls).toEqual([{ fn: "record_start_outcome", args: { p_agent_id: "agent-1", p_outcome: "attended", p_new_start_on: null, p_note: null } }]);

    openControl();
    fireEvent.click(await screen.findByRole("button", { name: "No-show" }));
    await waitFor(() => expect(db.calls).toHaveLength(2));
    expect(db.calls[1]).toMatchObject({ fn: "record_start_outcome", args: { p_outcome: "no_show" } });
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(playSoundEffect).not.toHaveBeenCalled();
  });
});
