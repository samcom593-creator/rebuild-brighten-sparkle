/**
 * Launch Board (src/pages/LaunchBoard.tsx), OVERHAUL-launchboard 2026-10-31.
 *
 * Sam: "still pretty ugly." These pin the page as it opens: Up next with the page's one gold button, four numbers
 * that each equal the list they open, one list with every video's step in colour and words and one next action per
 * row, the moves that button makes, the admin-only approval, a board that did not load reading as unknown rather than
 * zero, the old links still opening, and the momentum and Remake a winner moved to Analytics.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/hooks/useConfirm";

const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: auth.isAdmin, user: { id: "u-sam", email: "sam@example.com" } }) }));
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn(async () => undefined), prefersReducedMotion: () => true }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  cards: [] as Row[],
  failCards: false,
  writes: [] as Array<{ table: string; op: string; payload: unknown; id: unknown }>,
}));
vi.mock("@/integrations/supabase/client", () => {
  const rowsOf = (table: string): Row[] => (table === "content_cards" ? db.cards : []);
  const query = (table: string) => {
    let op: "select" | "update" | "insert" | "delete" = "select";
    let payload: unknown = null;
    let single = false;
    const eq: Array<[string, unknown]> = [];
    const run = () => {
      if (table === "content_cards" && op === "select" && db.failCards) return { data: null, error: { message: "permission denied for table content_cards" } };
      let rows = rowsOf(table).filter((r) => eq.every(([k, v]) => r[k] === v));
      if (op === "update") {
        db.writes.push({ table, op, payload, id: eq.find(([k]) => k === "id")?.[1] });
        rows.forEach((r) => Object.assign(r, payload as Row));
      } else if (op === "insert") {
        db.writes.push({ table, op, payload, id: null });
        rows = [];
      } else if (op === "delete") {
        db.writes.push({ table, op, payload: null, id: eq.find(([k]) => k === "id")?.[1] });
        db.cards = db.cards.filter((r) => !rows.includes(r));
      }
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    const chain: Record<string, unknown> = {};
    const self = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return chain; };
    Object.assign(chain, {
      select: self(), order: self(), is: self(), gte: self(), in: self(), or: self(), filter: self(), limit: self(),
      eq: self((k, v) => eq.push([k as string, v])),
      update: self((p) => { op = "update"; payload = p; }),
      insert: self((p) => { op = "insert"; payload = p; }),
      delete: self(() => { op = "delete"; }),
      maybeSingle: self(() => { single = true; }),
      single: self(() => { single = true; }),
      range: () => Promise.resolve(run()),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    });
    return chain;
  };
  return { supabase: { from: query, rpc: () => Promise.resolve({ data: null, error: null }) } };
});

import LaunchBoard from "@/pages/LaunchBoard";

let seq = 0;
function card(o: Row = {}): Row {
  seq += 1;
  return {
    id: `card-${String(seq).padStart(3, "0")}`, title: `Idea ${seq}`, brand: "SH", content_type: "short", job: "REACH", hook: "", caption: "",
    status: "idea", day: 0, clip: "", sort: 500 - seq, posted_at: null, record_script: "", edit_prompt: "", cta: "", owner: "", due_date: null,
    approved_at: null, scheduled_for: null, schedule_kind: null, schedule_job_ref: null, published_url: null, publish_evidence: null,
    planned_week: null, brief: null, archived_at: null, ...o,
  };
}
const PACK = "FILM: x\n- [ ] 1. Open on the hook\n- [ ] 2. The point\n- [ ] 3. The lesson";

/** Sam's board on Oct 31: 31 ideas, 1 picked to film with no shot list yet, 2 marked posted with no live link. */
function samsBoard(): Row[] {
  return [
    ...Array.from({ length: 31 }, (_, i) => card({ title: `Idea ${i + 1}`, record_script: i < 18 ? PACK : "", hook: i === 0 ? "[YT-80/20] The gym taught me to keep promises. Then the rest." : "" })),
    card({ title: "How I'd make your first $10K in the next 90 days starting with nothing", status: "record", brand: "YT", content_type: "long" }),
    card({ title: "A Weekend In My Life at 20 - Arizona", status: "posted", brand: "YT", content_type: "long" }),
    card({ title: "Day in My Life Running a $1.4M Agency at 20", status: "posted", brand: "YT", content_type: "long" }),
  ];
}

function renderPage(path = "/dashboard/launch-board") {
  return render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/dashboard/launch-board" element={<LaunchBoard />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>,
  );
}

/** The number on a scoreboard tile, read from its button. */
function tileValue(label: string): string {
  const tile = screen.getByRole("button", { name: new RegExp(`^${label}`) });
  return within(tile).getAllByText(/^(\d[\d,]*|—)$/)[0].textContent ?? "";
}
/** Every video shown: Up next, then the rows. */
function shownTitles(): string[] {
  const up = screen.queryByRole("heading", { name: /^Up next: / })?.textContent?.replace("Up next: ", "");
  const list = screen.queryByRole("list", { name: /./ });
  const rows = list
    ? within(list).getAllByRole("listitem").map((li) => {
        const open = within(li).getAllByRole("button")[0];
        return document.getElementById(open.getAttribute("aria-labelledby") ?? "")?.textContent ?? "";
      })
    : [];
  return [...(up ? [up] : []), ...rows];
}
const goldButtons = (root: HTMLElement) => [...root.querySelectorAll("button, a")].filter((b) => b.classList.contains("bg-primary"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T19:00:00Z"));
  seq = 0;
  auth.isAdmin = true;
  db.failCards = false;
  db.writes = [];
  db.cards = samsBoard();
});
afterEach(() => { vi.useRealTimers(); });

describe("Launch Board: the Videos view", () => {
  it("opens on what is in progress, led by Up next and the page's only gold button", async () => {
    const { container } = renderPage();
    const up = await screen.findByRole("heading", { name: /^Up next: How I'd make your first \$10K/ });
    expect(up).toBeInTheDocument();
    const gold = goldButtons(container);
    expect(gold).toHaveLength(1);
    expect(gold[0]).toHaveTextContent("Write shot list");
    const whatToDo = screen.getByRole("region", { name: "What to do next" });
    expect(within(whatToDo).getByText("Write the shot list")).toBeInTheDocument();
    // The old Today screen is gone from this view: no table, no picks, no question cards.
    expect(screen.queryByText(/Needs finishing/i)).toBeNull();
    expect(screen.queryByRole("region", { name: "Film next" })).toBeNull();
    expect(screen.queryByText(/What should I record next/i)).toBeNull();
  });

  it("shows four numbers, Ideas, To film, To edit and To post, that add up to every video not yet live", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /^Up next:/ });
    expect([tileValue("Ideas"), tileValue("To film"), tileValue("To edit"), tileValue("To post")]).toEqual(["31", "1", "0", "2"]);
    expect(screen.getByRole("button", { name: /^All videos/ })).toHaveTextContent("34");
    expect(screen.getByRole("button", { name: /^Published/ })).toHaveTextContent("0");
  });

  it("every number opens exactly the videos it counts", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /^Up next:/ });
    for (const label of ["To post", "To film", "Ideas"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
      await waitFor(() => expect(shownTitles()).toHaveLength(Number(tileValue(label))));
    }
    // Tapping the tile that is on goes back to In progress.
    fireEvent.click(screen.getByRole("button", { name: /^Ideas/ }));
    await waitFor(() => expect(shownTitles()).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: /^All videos/ }));
    await waitFor(() => expect(shownTitles()).toHaveLength(34));
  });

  it("each row says where its video is in words beside the colour, with one button for the next step", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /^Up next:/ });
    const list = screen.getByRole("list", { name: "In progress, after Up next" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getByText("Published, no link")).toBeInTheDocument();
      expect(within(row).getByText("Step 6 of 6:")).toBeInTheDocument();
      // One row button that opens the card, and one that does the next step.
      const buttons = within(row).getAllByRole("button");
      expect(buttons).toHaveLength(2);
      expect(buttons[1]).toHaveAccessibleName(/^Add link: /);
    }
  });

  it("Film this on an idea saves one move to Selected, and the numbers follow it", async () => {
    renderPage("/dashboard/launch-board?list=ideas");
    const up = await screen.findByRole("heading", { name: /^Up next: Idea 1$/ });
    expect(up).toBeInTheDocument();
    // The opening line, without its planning tag, says why.
    expect(screen.getByText("It opens with: “The gym taught me to keep promises.”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Film this: Idea 1" }));
    await waitFor(() => expect(db.writes.some((w) => w.op === "update" && w.id === "card-001")).toBe(true));
    const write = db.writes.find((w) => w.op === "update" && w.id === "card-001")!;
    expect(write.payload).toEqual({ status: "record" });
    // It has a filming pack, so the pack opens to film it; the board behind it has moved the video to To film.
    const pack = await screen.findByRole("dialog", { name: "Idea 1" });
    expect(within(pack).getByRole("list", { name: "Filming pack" })).toBeInTheDocument();
    fireEvent.keyDown(pack, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(tileValue("Ideas")).toBe("30"));
    expect(tileValue("To film")).toBe("2");
  });

  it("only an admin approves; anyone else sees the video waiting on approval, with no Approve button", async () => {
    db.cards = [card({ title: "Money after the 9 to 5", status: "review", caption: "Money." })];
    auth.isAdmin = false;
    const first = renderPage("/dashboard/launch-board?list=edit");
    await screen.findByRole("heading", { name: /^Up next: Money after the 9 to 5/ });
    expect(screen.getByText("An admin approves it before it can post.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
    expect(goldButtons(first.container)).toHaveLength(0);
    first.unmount();

    auth.isAdmin = true;
    renderPage("/dashboard/launch-board?list=edit");
    fireEvent.click(await screen.findByRole("button", { name: "Approve: Money after the 9 to 5" }));
    await waitFor(() => expect(db.writes.find((w) => w.op === "update")?.payload).toMatchObject({ status: "ready" }));
  });

  it("a board that did not load says so and shows a dash for every number, never a zero", async () => {
    db.failCards = true;
    renderPage();
    expect(await screen.findByText("The board did not load")).toBeInTheDocument();
    expect(screen.getByText(/Permission denied for table content_cards/)).toBeInTheDocument();
    expect([tileValue("Ideas"), tileValue("To film"), tileValue("To edit"), tileValue("To post")]).toEqual(["—", "—", "—", "—"]);
    db.failCards = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: /^Up next:/ })).toBeInTheDocument();
    expect(tileValue("Ideas")).toBe("31");
  });

  it("an empty board offers New idea and nothing else to count", async () => {
    db.cards = [];
    renderPage();
    expect(await screen.findByText("No videos on the board yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Ideas/ })).toBeNull();
  });
});

describe("Launch Board: the other views", () => {
  it("keeps the old links working: ?tab=board opens the Videos view, ?tab=week the week", async () => {
    const board = renderPage("/dashboard/launch-board?tab=board");
    expect(await screen.findByRole("heading", { name: /^Up next:/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Videos" })).toHaveAttribute("aria-current", "page");
    board.unmount();
    renderPage("/dashboard/launch-board?tab=week");
    expect(await screen.findByRole("region", { name: /^Monday/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-current", "page");
  });

  it("New idea opens the three picks from the idea bank, with Write my own idea", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /^Up next:/ });
    fireEvent.click(screen.getByRole("button", { name: "New idea" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("region", { name: "Film next" })).toBeInTheDocument();
    expect(within(sheet).getAllByRole("button", { name: /^Film this: / }).length).toBeGreaterThan(0);
    expect(within(sheet).getByRole("button", { name: "Write my own idea" })).toBeInTheDocument();
    // One gold button in the sheet: the first pick's.
    expect(goldButtons(sheet)).toHaveLength(1);
  });

  it("Analytics leads with the momentum and Remake a winner, moved off the Videos view", async () => {
    renderPage("/dashboard/launch-board?tab=analytics");
    expect(await screen.findByRole("region", { name: "Your momentum" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Remake a winner" })).toBeInTheDocument();
  });
});
