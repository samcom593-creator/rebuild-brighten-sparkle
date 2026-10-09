import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WinnersPanel } from "@/components/content/WinnersPanel";
import type { ResultPost } from "@/lib/contentWinners";

const NOW = new Date("2026-10-09T19:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000 - 3600_000).toISOString();
let n = 0;
const post = (views: number | null, o: Partial<ResultPost> = {}): ResultPost => ({
  id: ++n, platform: "youtube", account: "Samuel James", format: "short", title: `Post ${n}`, url: `https://youtu.be/vid${n}abcdef`, posted_at: ago(10), views, external_id: `vid${n}abcdef`, ...o,
});
const base = () => [900, 950, 1000, 1050, 1100].map((v) => post(v));
const props = (over: Partial<React.ComponentProps<typeof WinnersPanel>> = {}): React.ComponentProps<typeof WinnersPanel> => ({
  posts: [...base(), post(5000, { title: "Why I stopped waiting" })], loading: false, failed: false, onRetry: vi.fn(), cards: [], busy: false,
  onRemake: vi.fn(), onOpenCard: vi.fn(), onLogResults: vi.fn(), now: NOW, ...over,
});
const view = (p: React.ComponentProps<typeof WinnersPanel>) => render(<WinnersPanel {...p} />);

describe("winners panel: honest states", () => {
  it("states the rule on screen", () => {
    view(props());
    expect(screen.getByText(/at least 2x the median views/)).toHaveTextContent("3 days of views for a Short or 7 for long-form");
    expect(screen.getByText(/at least 5 posts to compare against/)).toBeInTheDocument();
  });
  it("loading is not 'no winners'", () => {
    view(props({ loading: true, posts: [] }));
    expect(screen.getByRole("status")).toHaveTextContent(/loading your results/i);
    expect(screen.queryByText(/no post has clearly beaten/i)).toBeNull();
  });
  it("a failed read says so with Retry and shows no winners", () => {
    const onRetry = vi.fn();
    view(props({ failed: true, onRetry }));
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByRole("button", { name: /remake this winner/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });
  it("with no recorded results it says so and offers the manual way, never an invented winner", () => {
    const onLogResults = vi.fn();
    view(props({ posts: [], onLogResults }));
    expect(screen.getByText("No results are recorded yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Log results by hand" }));
    expect(onLogResults).toHaveBeenCalled();
  });
  it("too few posts to compare is reported with the counts, not as a verdict", () => {
    view(props({ posts: [post(100), post(900), post(9000)] }));
    expect(screen.getByText(/not enough posts to judge: YouTube Short \(3 of 5\)/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remake this winner/i })).toBeNull();
  });
  it("reports recent posts that are too new and posts with no views", () => {
    view(props({ posts: [post(1, { posted_at: ago(1) }), post(null)] }));
    expect(screen.getByText(/1 recent post is too new to judge/i)).toBeInTheDocument();
    expect(screen.getByText(/1 post has no view count recorded/i)).toBeInTheDocument();
  });
});

describe("winners panel: remake", () => {
  it("shows the measured basis for a winner: views, days, median and sample", () => {
    view(props());
    const li = screen.getByRole("listitem", { name: "Why I stopped waiting" });
    expect(li).toHaveTextContent("4.9x your usual");
    expect(li).toHaveTextContent("5,000 views after 10 days, against a median of 1,025 across 6 Shorts on YouTube");
  });
  it("Remake this winner offers a sequel, a fresh application or an experiment, with a one-sentence hypothesis, and creates the draft once", () => {
    const onRemake = vi.fn();
    view(props({ onRemake }));
    fireEvent.click(screen.getByRole("button", { name: /remake this winner/i }));
    const group = screen.getByRole("group", { name: "Remake options" });
    expect(within(group).getByText("A sequel")).toBeInTheDocument();
    expect(within(group).getByText("A fresh application")).toBeInTheDocument();
    expect(within(group).getByText("A new experiment")).toBeInTheDocument();
    expect(group).toHaveTextContent(/changing the opening line/i);
    expect(group).toHaveTextContent("The original and its numbers stay exactly as they are");
    fireEvent.click(within(group).getByLabelText(/a sequel/i));
    fireEvent.change(within(group).getByLabelText("Change on purpose"), { target: { value: "example" } });
    expect(group).toHaveTextContent("Part 2: Why I stopped waiting");
    fireEvent.click(within(group).getByRole("button", { name: "Create the draft" }));
    expect(onRemake).toHaveBeenCalledTimes(1);
    expect(onRemake.mock.calls[0][0]).toMatchObject({ title: "Part 2: Why I stopped waiting", format: "short", brief: expect.objectContaining({ variation: "sequel", change: "example" }) });
  });
  it("a remake that already exists is opened instead of offered again", () => {
    const winnerId = [...base()].length; // not used: the key is derived from the real post id below
    const posts = [...base(), post(5000, { title: "Why I stopped waiting" })];
    const win = posts[posts.length - 1];
    const onOpenCard = vi.fn(); const onRemake = vi.fn();
    view(props({ posts, onOpenCard, onRemake, cards: [{ id: "made", title: "Part 2: Why I stopped waiting", brief: { idea_key: `remake:${win.id}:experiment:hook` } }] }));
    void winnerId;
    fireEvent.click(screen.getByRole("button", { name: /remake this winner/i }));
    fireEvent.click(screen.getByRole("button", { name: "Open the draft you already made" }));
    expect(onOpenCard).toHaveBeenCalledWith("made");
    expect(onRemake).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Create the draft" })).toBeNull();
  });
  it("an archived remake does not count as already made", () => {
    const posts = [...base(), post(5000, { title: "Why I stopped waiting" })];
    const win = posts[posts.length - 1];
    view(props({ posts, cards: [{ id: "old", title: "x", archived_at: "2026-10-01T00:00:00Z", brief: { idea_key: `remake:${win.id}:experiment:hook` } }] }));
    fireEvent.click(screen.getByRole("button", { name: /remake this winner/i }));
    expect(screen.getByRole("button", { name: "Create the draft" })).toBeInTheDocument();
  });
  it("waits while a remake is being created", () => {
    view(props({ busy: true }));
    fireEvent.click(screen.getByRole("button", { name: /remake this winner/i }));
    expect(screen.getByRole("button", { name: "Create the draft" })).toBeDisabled();
  });
});
