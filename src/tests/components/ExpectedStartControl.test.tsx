/**
 * ExpectedStartControl, Grow review fix 2026-10-28 (finding 21): the trigger is a 44px row
 * control with 14px words, every control inside the popover is at least 44px, the one gold
 * Save button is 48px, and nothing reads under 13px.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExpectedStartControl } from "@/components/onboarding/ExpectedStartControl";

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
});
afterEach(() => vi.unstubAllGlobals());

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
});
