/**
 * Pipeline page (src/pages/RecruitingPipeline.tsx), Grow review fixes 2026-10-28.
 *
 * Every number on the page is a list: a tile or chip value must equal the rows shown
 * after clicking it (findings 2 and 3). A failed load is dashes and a reason with Retry,
 * never zeros (4). The "Also" numbers are 44px chips (25). Intent is a 44px dropdown
 * in words that writes once per choice through the same rp_pipeline_action RPC (26).
 * A late follow-up says "Late · 1 day" in red and an unreadable date says so (38).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as null | { message: string },
  reads: 0,
  rpcArgs: [] as Array<{ fn: string; args: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.limit = () => {
        db.reads += 1;
        return Promise.resolve(db.error ? { data: null, error: db.error } : { data: db.rows, error: null });
      };
      return b;
    },
    rpc: (fn: string, args?: unknown) => {
      db.rpcArgs.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import RecruitingPipeline from "@/pages/RecruitingPipeline";

interface Person {
  person_key: string; person_type: string; name: string;
  phone: string | null; email: string | null; instagram: string | null;
  lead_source: string | null; stage: string; monday_status: string | null;
  expected_start: string | null; last_contact: string | null; next_follow_up: string | null;
  next_action_display: string | null; notes: string | null;
  license_status: string | null; raw_status: string | null; intent_level: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
let seq = 0;
function person(over: Partial<Person> & { name: string; person_type: string; stage: string }): Person {
  seq += 1;
  return {
    person_key: `${over.person_type}:${seq}`,
    phone: null, email: null, instagram: null, lead_source: null, monday_status: null,
    expected_start: null, last_contact: null, next_follow_up: null, next_action_display: null,
    notes: null, license_status: null, raw_status: null, intent_level: null,
    ...over,
  };
}

// Nine people. Expected Monday = Ana and Bea (prospects; Bea is inactive and still counts,
// because the number includes inactive people and so must the list). Eli is an AGENT
// carrying the same Monday flag: not a prospect, so never counted or listed as one.
// Contracting = Fay (Contract Sent) and Gus (Contracting In Progress), both stages.
const ana = person({ name: "Ana Ruiz", person_type: "applicant", stage: "Expected Monday", monday_status: "expected", intent_level: "hot", phone: "6015551001", instagram: "@ana.ruiz", next_follow_up: daysAgo(1), last_contact: daysAgo(3) });
const bea = person({ name: "Bea Lane", person_type: "applicant", stage: "Inactive/No Longer With Us", monday_status: "expected" });
const cal = person({ name: "Cal Moss", person_type: "applicant", stage: "Confirmed", monday_status: "confirmed", next_follow_up: "not-a-date" });
const dee = person({ name: "Dee Park", person_type: "applicant", stage: "No Show", monday_status: "no_show" });
const eli = person({ name: "Eli Stone", person_type: "agent", stage: "Active Agent", monday_status: "expected" });
const fay = person({ name: "Fay Quinn", person_type: "agent", stage: "Contract Sent" });
const gus = person({ name: "Gus Reed", person_type: "applicant", stage: "Contracting In Progress" });
const hal = person({ name: "Hal Byrne", person_type: "applicant", stage: "Onboarding" });
const ivy = person({ name: "Ivy Chan", person_type: "agent", stage: "Active Agent" });
const EVERYONE = [ana, bea, cal, dee, eli, fay, gus, hal, ivy];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/dashboard/recruiting/pipeline"]}><RecruitingPipeline /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const tile = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}`) });
const peopleListed = () => within(screen.getByRole("region", { name: "People" })).getAllByRole("listitem").map((li) => li.textContent ?? "");
/** The "N of M people" line; the N sits in its own span, so match the whole element's text. */
const scopeLine = () => screen.getByText((_, el) => el?.tagName === "SPAN" && /^\d+ of \d+ people$/.test(el.textContent ?? ""));
const openMenu = (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: "Enter" });

beforeEach(() => {
  db.rows = EVERYONE;
  db.error = null;
  db.reads = 0;
  db.rpcArgs = [];
  // Radix positions menus and popovers with ResizeObserver, which jsdom does not ship.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

describe("Recruiting Pipeline", () => {
  it("counts Expected Monday over prospects only and opens exactly the people it counts", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    expect(scopeLine()).toHaveTextContent("8 of 9 people"); // open only: Bea (inactive) hidden by default
    const expected = tile("Expected Monday");
    expect(expected).toHaveTextContent(/Expected Monday\s*2\s*Prospects due to start/);
    fireEvent.click(expected);
    expect(tile("Expected Monday")).toHaveAttribute("aria-pressed", "true");
    const listed = peopleListed();
    expect(listed).toHaveLength(2);
    expect(listed.some((t) => t.includes("Ana Ruiz"))).toBe(true);
    expect(listed.some((t) => t.includes("Bea Lane"))).toBe(true);
    expect(listed.some((t) => t.includes("Eli Stone"))).toBe(false);
    expect(scopeLine()).toHaveTextContent("2 of 9 people");
    // The list is described in words: prospects, Monday, inactive included.
    expect(screen.getByRole("button", { name: "Clear Prospects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Monday: Expected Monday" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Include inactive" })).toBeInTheDocument();
  });

  it("counts Contracting over both contracting stages and its list shows the same people", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    const chip = screen.getByRole("button", { name: /^Contracting/ });
    expect(chip).toHaveTextContent(/Contracting\s*2$/);
    fireEvent.click(chip);
    expect(screen.getByRole("button", { name: /^Contracting/ })).toHaveAttribute("aria-pressed", "true");
    const listed = peopleListed();
    expect(listed).toHaveLength(2);
    expect(listed.some((t) => t.includes("Fay Quinn"))).toBe(true);
    expect(listed.some((t) => t.includes("Gus Reed"))).toBe(true);
    expect(scopeLine()).toHaveTextContent("2 of 9 people");
    expect(screen.getByRole("button", { name: "Clear Stage: Contracting (sent or in progress)" })).toBeInTheDocument();
  });

  it("keeps every number equal to its list, including Confirmed, No shows and the other tiles", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    for (const [name, count] of [["Confirmed", 1], ["No shows", 1], ["Showed", 0], ["Onboarding", 1], ["Active agents", 2]] as const) {
      const control = screen.getByRole("button", { name: new RegExp(`^${name}`) });
      expect(control).toHaveTextContent(new RegExp(`${name}\\s*${count}`));
      fireEvent.click(control);
      if (count === 0) expect(screen.getByText("No one matches these filters.")).toBeInTheDocument();
      else expect(peopleListed()).toHaveLength(count);
      expect(scopeLine()).toHaveTextContent(`${count} of 9 people`);
    }
  });

  it("shows dashes, a reason and Retry when the load fails, never zeros", async () => {
    db.error = { message: "permission denied" };
    renderPage();
    expect(await screen.findByText("The pipeline did not load: permission denied.")).toBeInTheDocument();
    for (const label of ["Expected Monday", "Showed", "Onboarding", "Active agents"]) {
      expect(tile(label)).toHaveTextContent("—");
      expect(tile(label)).not.toHaveTextContent(/\d/);
    }
    for (const label of ["Confirmed", "No shows", "Contracting"]) {
      const chip = screen.getByRole("button", { name: new RegExp(`^${label}`) });
      expect(chip).toHaveTextContent("—");
      expect(chip).toBeDisabled();
    }
    expect(screen.getByText(/numbers are hidden rather than shown as 0/)).toBeInTheDocument();
    expect(screen.getByText("People did not load")).toBeInTheDocument();
    expect(screen.queryByText(/0 people/)).toBeNull();
    expect(screen.queryByText("No one matches these filters.")).toBeNull();

    db.error = null;
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await screen.findByText("Ana Ruiz");
    expect(db.reads).toBe(2);
    expect(scopeLine()).toHaveTextContent("8 of 9 people");
    expect(tile("Expected Monday")).toHaveTextContent(/Expected Monday\s*2/);
  });

  it("renders the Also numbers as 44px chips that say whether they are picked", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    for (const label of ["Confirmed", "No shows", "Contracting"]) {
      const chip = screen.getByRole("button", { name: new RegExp(`^${label}`) });
      expect(chip.className).toMatch(/\bh-11\b/);
      expect(chip).toHaveAttribute("aria-pressed", "false");
    }
    fireEvent.click(screen.getByRole("button", { name: /^Confirmed/ }));
    expect(screen.getByRole("button", { name: /^Confirmed/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^No shows/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("sets intent from a 44px dropdown in words and writes once per choice", async () => {
    renderPage();
    const trigger = await screen.findByRole("button", { name: /^Intent: Hot/ });
    expect(trigger.className).toMatch(/\bh-11\b/);
    expect(trigger).toHaveTextContent("Intent: Hot");

    openMenu(trigger);
    for (const option of ["Hot", "Warm", "Cold", "Not set"]) {
      expect(await screen.findByRole("menuitemradio", { name: option })).toBeInTheDocument();
    }
    // Picking the current value is not a write.
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Hot" }));
    await waitFor(() => expect(screen.queryByRole("menuitemradio", { name: "Hot" })).toBeNull());
    expect(db.rpcArgs.filter((c) => c.fn === "rp_pipeline_action")).toHaveLength(0);

    openMenu(screen.getByRole("button", { name: /^Intent: Hot/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Cold" }));
    await waitFor(() => expect(db.rpcArgs.filter((c) => c.fn === "rp_pipeline_action")).toHaveLength(1));
    expect(db.rpcArgs[0].args).toEqual({ p_person_key: ana.person_key, p_action: "intent", p_value: "cold" });

    openMenu(screen.getByRole("button", { name: /^Intent: Hot/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Not set" }));
    await waitFor(() => expect(db.rpcArgs.filter((c) => c.fn === "rp_pipeline_action")).toHaveLength(2));
    expect(db.rpcArgs[1].args).toEqual({ p_person_key: ana.person_key, p_action: "intent", p_value: "clear" });
  });

  it("says a late follow-up in words and red, names an unreadable date, and has no footer", async () => {
    renderPage();
    const late = await screen.findByText("Late · 1 day");
    expect(late.className).toMatch(/text-destructive/);
    const bad = screen.getByText("Unreadable date");
    expect(bad.className).toMatch(/text-destructive/);
    expect(screen.getByText("Last contact 3 days ago")).toBeInTheDocument();
    expect(screen.getAllByText("Last contact never").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No due date").length).toBeGreaterThan(0);
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText(/no data is duplicated/)).toBeNull();
    expect(screen.queryByText(/manual override/)).toBeNull();
  });

  it("keeps the subtitle short enough for one line on a phone", async () => {
    renderPage();
    const subtitle = await screen.findByText("Everyone from first call to active agent.");
    expect((subtitle.textContent ?? "").length).toBeLessThanOrEqual(48);
  });

  it("keeps every control at 44px or taller", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    for (const label of ["Everyone", "Prospects", "Agents", "Any", "Hot", "Open only", "Include inactive"]) {
      for (const b of await screen.findAllByRole("button", { name: label })) expect(b.className).toMatch(/\bh-11\b/);
    }
    fireEvent.click(screen.getByRole("button", { name: "Prospects" }));
    expect(screen.getByRole("button", { name: "Clear all" }).className).toMatch(/\bh-11\b/);
    expect(screen.getByRole("button", { name: "Clear Prospects" }).className).toMatch(/\bh-11\b/);
    expect(screen.getByRole("button", { name: /^Intent: Hot/ }).className).toMatch(/\bh-11\b/);
    expect(screen.getByRole("button", { name: "Update Ana Ruiz" }).className).toMatch(/\bh-11\b/);
    expect(screen.getByRole("combobox", { name: "Stage for Ana Ruiz" }).className).toMatch(/\bh-11\b/);
    // Nothing on the page is set below 13px.
    expect(document.body.innerHTML).not.toMatch(/text-xs|text-\[1[0-2]px\]/);
  });

  it("keeps Call and Text on the shared contact links, which record nothing", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    const call = screen.getByRole("link", { name: "Call Ana Ruiz" });
    expect(decodeURIComponent(decodeURIComponent(call.getAttribute("href") ?? ""))).toContain("+16015551001");
    expect(screen.getByRole("link", { name: "Text Ana Ruiz" })).toBeInTheDocument();
    fireEvent.click(call);
    expect(db.rpcArgs).toHaveLength(0);
  });

  it("opens Instagram from a 44px button beside Call and Text, and shows the handle as text", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    const ig = screen.getByRole("link", { name: "Open Instagram for Ana Ruiz" });
    expect(ig).toHaveAttribute("href", "https://instagram.com/ana.ruiz");
    expect(ig).toHaveAttribute("rel", "noopener noreferrer");
    expect(ig.className).toMatch(/\bh-11\b/);
    expect(screen.getByText(/\(601\) 555-1001 · @ana\.ruiz/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "@ana.ruiz" })).toBeNull();
  });
});
