/**
 * HomeConversions (OVERHAUL-home, 2026-10-29): the owner Home's conversion strip and the
 * Selling agents number. Pins that each number is a button that opens exactly the people it
 * counts, that a failed read is a dash and never a zero, and that the roster number says
 * what it counts.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "samuel" }, isAdmin: auth.isAdmin }) }));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-10-29" }));

import { HomeConversions, SellingAgentsTile } from "@/components/dashboard/HomeConversions";

const PAYLOAD = {
  as_of: "2026-10-29T16:05:00Z",
  today: "2026-10-29",
  week_start: "2026-10-23",
  prior_week_start: "2026-10-16",
  month_start: "2026-09-30",
  xcel_report_on: "2026-10-28",
  people: [
    { kind: "applied", period: "current", name: "Ana Diaz", at: "2026-10-29T16:14:00Z", on: "2026-10-29", application_id: "app-1", agent_id: null, license: "licensed" },
    { kind: "applied", period: "current", name: "Bo Kim", at: "2026-10-29T15:02:00Z", on: "2026-10-29", application_id: "app-2", agent_id: null, license: "unlicensed" },
    { kind: "applied", period: "prior", name: "Cy Lee", at: "2026-10-28T20:00:00Z", on: "2026-10-28", application_id: "app-3", agent_id: null, license: "unlicensed" },
    { kind: "xcel_bought", period: "current", name: "Eli Moss", at: null, on: "2026-10-27", application_id: "app-5", agent_id: null, course: "Life & Health" },
    { kind: "licensed", period: "current", name: "Fay Gold", at: "2026-10-26T17:00:00Z", on: "2026-10-26", application_id: "app-6", agent_id: "agent-6", how: "record" },
    { kind: "first_deal", period: "prior", name: "Gus Hale", at: null, on: "2026-10-20", application_id: null, agent_id: "agent-7", ap: 1411 },
    { kind: "selling", period: "current", name: "Hal Ives", at: null, on: "2026-10-28", application_id: null, agent_id: "agent-8", deals: 8, ap: 13226 },
    { kind: "selling", period: "current", name: "Ida Jay", at: null, on: "2026-10-02", application_id: null, agent_id: "agent-9", deals: 1, ap: 1411 },
  ],
};

const rpc = vi.mocked(supabase.rpc);

function renderWith(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The tile button whose label is `label`. */
const tile = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label}`) });

beforeEach(() => {
  auth.isAdmin = true;
  rpc.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/** The hook retries once after 4s (MP-431); let that pass so the failure is final. */
async function settleRetry() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
}

describe("HomeConversions", () => {
  it("asks for the Phoenix business day and shows every number from the one read", async () => {
    rpc.mockResolvedValue({ data: PAYLOAD, error: null } as never);
    renderWith(<HomeConversions />);
    await waitFor(() => expect(tile("Applied today")).toHaveTextContent("2"));
    expect(rpc).toHaveBeenCalledWith("home_conversion_people", { p_today: "2026-10-29" });
    expect(rpc).toHaveBeenCalledTimes(1);
    // Visible: the short label, the number and the comparison under a header that says when.
    expect(tile("Applied today")).toHaveTextContent(/^Applied2Up from 1$/);
    expect(tile("Interviews booked today")).toHaveTextContent(/^Interviews booked0No change$/);
    expect(tile("Bought Xcel")).toHaveTextContent(/^Bought Xcel1Up from 0$/);
    expect(tile("Passed the test")).toHaveTextContent(/^Passed the test0No change$/);
    expect(tile("Newly licensed")).toHaveTextContent(/^Newly licensed1Up from 0$/);
    expect(tile("First deals")).toHaveTextContent(/^First deals0Down from 1$/);
    // Spoken: the full label, the window and the comparison in full.
    expect(tile("Applied today")).toHaveAccessibleName("Applied today: 2. Up from 1 yesterday. Open the list");
    expect(tile("First deals")).toHaveAccessibleName("First deals, last 7 days: 0. Down from 1 the week before. Open the list");
    // Two groups that say when, the funnel in order, every number a button that opens a list.
    const today = screen.getByRole("group", { name: "Today" });
    const week = screen.getByRole("group", { name: "Last 7 days" });
    expect(today).toHaveTextContent("compared with yesterday");
    expect(week).toHaveTextContent("compared with the 7 days before");
    expect(within(today).getAllByRole("button").map((b) => b.textContent?.replace(/\d.*$/, ""))).toEqual(["Applied", "Interviews booked"]);
    expect(within(week).getAllByRole("button").map((b) => b.textContent?.replace(/\d.*$/, ""))).toEqual(["Bought Xcel", "Passed the test", "Newly licensed", "First deals"]);
    const all = within(screen.getByRole("region", { name: "Conversions" })).getAllByRole("button");
    expect(all.map((b) => b.getAttribute("aria-haspopup"))).toEqual(["dialog", "dialog", "dialog", "dialog", "dialog", "dialog"]);
  });

  it("a tile opens exactly the people it counts, then the comparison's people", async () => {
    rpc.mockResolvedValue({ data: PAYLOAD, error: null } as never);
    renderWith(<HomeConversions />);
    await waitFor(() => expect(tile("Applied today")).toHaveTextContent("2"));
    fireEvent.click(tile("Applied today"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Applied today" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent("2 people · Phoenix time");
    const sections = within(sheet).getAllByRole("list");
    // The number on the tile (2) is the length of the first list.
    expect(within(sections[0]).getAllByRole("listitem")).toHaveLength(2);
    expect(within(sections[0]).getByRole("link", { name: /Ana Diaz/ })).toHaveAttribute("href", "/dashboard/recruiting?person=app-1");
    expect(within(sections[0]).getByText("Applied 9:14 AM · Licensed")).toBeInTheDocument();
    expect(within(sections[1]).getAllByRole("listitem")).toHaveLength(1);
    expect(within(sections[1]).getByText("Cy Lee")).toBeInTheDocument();
    expect(within(sheet).getByText(/Yesterday/, { selector: "h3" })).toHaveTextContent("Yesterday · 1 person");
  });

  it("closing a list returns focus to the number that opened it", async () => {
    rpc.mockResolvedValue({ data: PAYLOAD, error: null } as never);
    renderWith(<HomeConversions />);
    await waitFor(() => expect(tile("Newly licensed")).toHaveTextContent("1"));
    const opener = tile("Newly licensed");
    opener.focus();
    fireEvent.click(opener);
    const sheet = await screen.findByRole("dialog");
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(tile("Newly licensed"));
  });

  it("an empty list says so and offers the next step, and still shows the week before", async () => {
    rpc.mockResolvedValue({ data: PAYLOAD, error: null } as never);
    renderWith(<HomeConversions />);
    await waitFor(() => expect(tile("First deals")).toHaveTextContent("0"));
    fireEvent.click(tile("First deals"));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("0 people · last 7 days");
    expect(sheet).toHaveTextContent("No first deals in the last 7 days.");
    expect(within(sheet).getByRole("link", { name: /Open New hires/ })).toHaveAttribute("href", "/dashboard/recruits");
    expect(within(sheet).getByRole("link", { name: /Gus Hale/ })).toHaveAttribute("href", "/dashboard/agents/agent-7");
    expect(within(sheet).getByText("First deal Tue, Oct 20")).toBeInTheDocument();
    expect(within(sheet).getByText("$1,411")).toBeInTheDocument();
    expect(within(sheet).getByText("first-day ALP")).toBeInTheDocument();
  });

  it("a failed read shows dashes and a way to try again, never zeros", async () => {
    vi.useFakeTimers();
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied", code: "42501" } } as never);
    renderWith(<HomeConversions />);
    await settleRetry();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("The conversion numbers did not load: You do not have permission to view this.");
    for (const label of ["Applied today", "Interviews booked today", "Bought Xcel", "Passed the test", "Newly licensed", "First deals"]) {
      expect(tile(label)).toHaveTextContent("—");
      // No zero anywhere, and no comparison: an unknown number has nothing to compare.
      expect(tile(label)).not.toHaveTextContent("0");
      expect(tile(label)).not.toHaveTextContent(/Up from|Down from|No change/);
    }
  });

  it("a reply in a shape the page cannot read is a failure, not a strip of zeros", async () => {
    vi.useFakeTimers();
    rpc.mockResolvedValue({ data: { people: "nope" }, error: null } as never);
    renderWith(<HomeConversions />);
    await settleRetry();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
    expect(tile("Applied today")).toHaveTextContent("—");
  });

  it("Bought Xcel is a dash with the reason when Xcel's daily report has gone quiet", async () => {
    rpc.mockResolvedValue({ data: { ...PAYLOAD, xcel_report_on: "2026-10-20" }, error: null } as never);
    renderWith(<HomeConversions />);
    await waitFor(() => expect(tile("Applied today")).toHaveTextContent("2"));
    expect(tile("Bought Xcel")).toHaveTextContent(/^Bought Xcel—Xcel report is late$/);
    fireEvent.click(tile("Bought Xcel"));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Count unknown");
    expect(within(sheet).getByRole("status")).toHaveTextContent("Xcel's daily report has not arrived since Tue, Oct 20");
  });

  it("does not ask for anything when the viewer is not an administrator", () => {
    auth.isAdmin = false;
    renderWith(<HomeConversions />);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("SellingAgentsTile (the roster number)", () => {
  it("counts licensed agents who sold in the last 30 days, says so, and opens every one of them", async () => {
    rpc.mockResolvedValue({ data: PAYLOAD, error: null } as never);
    renderWith(<SellingAgentsTile />);
    const button = await screen.findByRole("button", { name: /^Selling agents/ });
    await waitFor(() => expect(button).toHaveTextContent("2"));
    expect(button).toHaveTextContent(/^Selling agentsSee who\s?2Licensed, sold in the last 30 days$/);
    expect(button).toHaveAccessibleName("Selling agents, last 30 days: 2. Open the list");
    fireEvent.click(button);
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("2 people · last 30 days");
    expect(sheet).toHaveTextContent("Licensed agents on the roster with at least one posted deal in the last 30 days");
    const list = within(sheet).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByRole("link", { name: /Hal Ives/ })).toHaveAttribute("href", "/dashboard/agents/agent-8");
    expect(within(list).getByText("8 deals · last sale yesterday")).toBeInTheDocument();
    expect(within(list).getByText("$13,226")).toBeInTheDocument();
    // Most ALP first.
    expect(within(list).getAllByRole("link").map((a) => a.textContent?.slice(2, 9))).toEqual(["Hal Ive", "Ida Jay"]);
    // No "the 30 days before" list: the roster number has no comparison.
    expect(within(sheet).getAllByRole("heading", { level: 3 })).toHaveLength(1);
  });

  it("shows its definition on hover or focus, not only on the list", async () => {
    rpc.mockResolvedValue({ data: PAYLOAD, error: null } as never);
    renderWith(<SellingAgentsTile />);
    const button = await screen.findByRole("button", { name: /^Selling agents/ });
    fireEvent.focus(button);
    expect((await screen.findAllByText(/with at least one posted deal in the last 30 days/)).length).toBeGreaterThan(0);
  });

  it("a failed read is a dash with the reason", async () => {
    vi.useFakeTimers();
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } } as never);
    renderWith(<SellingAgentsTile />);
    await settleRetry();
    expect(screen.getByRole("button", { name: /^Selling agents/ })).toHaveTextContent("Did not load: boom.");
    expect(screen.getByRole("button", { name: /^Selling agents/ })).toHaveTextContent("—");
  });
});
