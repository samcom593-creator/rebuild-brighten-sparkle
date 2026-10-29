/**
 * The Instagram desk page (OVERHAUL-instagram). Pins what Sam asked for at the page level:
 *  - the four numbers at the top equal the lists they open (a tap on "Gave a number" lands on the
 *    People tab with exactly those people);
 *  - every card carries what they said and what we did;
 *  - one gold button on the screen, the Up next card's;
 *  - a failed load says so and offers a retry, never an empty desk.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ConfirmProvider } from "@/hooks/useConfirm";
import InstagramInbox from "@/pages/InstagramInbox";
import type { IgDashboard, IgRow, IgStage, IgStageKey } from "@/components/instagram/igTypes";

vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));

const now = Date.now();
const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();

function person(i: number, over: Partial<IgRow> = {}): IgRow {
  return {
    external_id: String(5000 + i), handle: `@lead${i}`, name: `Lead ${i}`, status: "casual", rank: 7,
    last_body: `message ${i}`, last_direction: "inbound", last_at: iso(i + 1), last_inbound_at: iso(i + 1), age_min: 60,
    phone: null, email: null, intent: "casual", licensed: false, human_lane: false, booked_event: null, has_booking: false, applied: false,
    last_in_body: `message ${i}`, last_out: null, last_action: null, first_in_at: iso(48), in_count: 2, came_from: { channel: "dm", media_id: null },
    ...over,
  };
}

function stage(key: IgStageKey, count: number, people: IgRow[] = [], prior = 0): IgStage {
  return { key, label: key, caption: "", count, prior_count: prior, prev_key: null, people };
}

const needs: IgRow[] = [
  person(1, { status: "call", rank: 1, phone: "4803277544", intent: "licensed", licensed: true, last_in_body: "we still on for the call?",
    last_out: { body: "locked in, talk soon", at: iso(1), by: "bot", state: "handed", kind: null } }),
  person(2, { status: "closed", rank: 6, intent: "opportunity", last_in_body: "how do i start",
    last_out: { body: "do you have your license?", at: iso(2), by: "bot", state: "refused", kind: "window_closed" } }),
  person(3, { status: "reply", rank: 4, intent: "opportunity", last_in_body: "what's the pay" }),
];
const people: IgRow[] = Array.from({ length: 8 }, (_, i) => person(10 + i, {
  stages: { business: i < 3, licensed: i === 0, number: i < 2, booked: false },
  phone: i < 2 ? `60255501${10 + i}` : null,
}));

function dashboard(): IgDashboard {
  return {
    status: {
      token_ok: true, token_checked_at: iso(0), ig_username: "sell4daddy", links_blocked: false, links_blocked_at: null,
      last_link_refusal_at: null, links_proven_at: iso(100), last_delivered_at: iso(1), last_bot_delivered_at: iso(1), last_inbound_at: iso(1),
      nudge_cron_last_at: iso(0.1), nudge_cron_last_status: "succeeded", human_agent_supported: false, window: "30d", since: iso(720), prior_since: iso(1440),
      generated_at: iso(0),
    },
    needs,
    everyone: [person(40)],
    later: [],
    lever: { key: "business_number", sentence: "3 talked business, 2 gave a number. ask for the number sooner.", button_label: "see the 1", people: [people[2]], lost: { business_number: 1, number_booked: 0, booked_showed: 0 } },
    funnel: {
      since: iso(720), prior_since: iso(1440), locked_in_gap: 0, locked_in_people: [],
      stages: [
        stage("in", 8, people.slice(0, 5), 4), stage("business", 3, people.slice(0, 3), 1), stage("licensed", 1, [people[0]]),
        stage("number", 2, people.slice(0, 2), 1), stage("booked", 1, [people[0]], 0), stage("showed", 0), stage("applied", 2, [people[0], people[1]], 3),
        stage("hired", 0), stage("recovered", 0),
      ],
    },
    working: { reels: [], top_views: null, lines: [], sam_short_pct: null, bot_long_pct: null, intents: [] },
    health: {
      bot_handed: 5, bot_receipts: 1, you_delivered: 2, you_got_reply: 1, replied_24h_n: 3, replied_24h_of: 8, refused_30d: 1, comment_refused_7d: 0,
      followups_sent_30d: 0, followup_last_run_at: iso(0.1), followup_last_status: "succeeded", nudged: [], recovery: [],
    },
    people,
  };
}

function renderPage(path = "/dashboard/inbox/instagram") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ConfirmProvider>
          <InstagramInbox />
        </ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(supabase.rpc).mockImplementation((async (fn: string) => {
    if (fn === "fn_ig_dashboard") return { data: dashboard(), error: null };
    return { data: null, error: null };
  }) as never);
});

describe("Instagram desk", () => {
  it("leads with the numbers, then the Up next card with the screen's only gold button", async () => {
    const { container } = renderPage();
    await screen.findByRole("heading", { name: "Up next" });
    const board = screen.getByRole("region", { name: "Instagram numbers" });
    expect(within(board).getByText("Needs you")).toBeInTheDocument();
    expect(within(board).getByText("Gave a number")).toBeInTheDocument();
    expect(within(board).getByText("Booked a call")).toBeInTheDocument();
    expect(within(board).getByText("Applied")).toBeInTheDocument();
    const gold = Array.from(container.querySelectorAll("a, button")).filter((el) => el.classList.contains("bg-primary"));
    expect(gold).toHaveLength(1);
    expect(gold[0].textContent).toContain("Call (480) 327-7544");
    // Every card answers what they said and what we did.
    expect(screen.getByText("“we still on for the call?”")).toBeInTheDocument();
    expect(screen.getByText("“locked in, talk soon”")).toBeInTheDocument();
    expect(screen.getByText("not delivered: window closed")).toBeInTheDocument();
    expect(screen.getByText("Nobody has answered yet")).toBeInTheDocument();
  });

  it("a number at the top opens exactly the people it counts", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Up next" });
    const board = screen.getByRole("region", { name: "Instagram numbers" });
    const tile = within(board).getByRole("button", { name: /Gave a number/ });
    expect(tile.textContent).toContain("2");
    fireEvent.click(tile);
    const lists = await screen.findByRole("group", { name: "Lists" });
    const chip = within(lists).getByRole("button", { name: /Gave a number/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip.textContent).toContain("2");
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  });

  it("the People tab lists everyone who wrote in, and its search finds a person by their words", async () => {
    renderPage("/dashboard/inbox/instagram?tab=people");
    const lists = await screen.findByRole("group", { name: "Lists" });
    expect(within(lists).getByRole("button", { name: /Everyone/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("article")).toHaveLength(8);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search people" }), { target: { value: "message 13" } });
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
  });

  it("a failed load says so and offers a retry", async () => {
    vi.mocked(supabase.rpc).mockImplementation((async () => ({ data: null, error: { message: "boom" } })) as never);
    renderPage();
    expect(await screen.findByText("The Instagram desk didn't load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
