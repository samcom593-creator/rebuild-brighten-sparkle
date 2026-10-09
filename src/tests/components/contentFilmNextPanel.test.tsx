import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BANK_IDEAS } from "@/data/contentIdeaBank";
import { DEFAULT_FILTERS, selectPicks } from "@/lib/contentPicks";
import { FilmNextPanel } from "@/components/content/FilmNextPanel";

type Props = React.ComponentProps<typeof FilmNextPanel>;
const handlers = () => ({ onFilm: vi.fn(), onSaveLater: vi.fn(), onDismiss: vi.fn(), onBringBack: vi.fn() });
const none = { dismissed: new Set<string>(), used: new Set<string>() };
function setup(over: Partial<Props> = {}) {
  const h = handlers();
  const props: Props = { ideas: BANK_IDEAS, used: new Set(), dismissed: [], dismissalsFailed: false, busyKey: null, ...h, ...over };
  const utils = render(<FilmNextPanel {...props} />);
  return { ...utils, ...h, props };
}
const picksList = () => within(screen.getByRole("region", { name: "Film next" })).queryAllByRole("listitem").filter((li) => li.getAttribute("aria-label"));
beforeEach(() => { localStorage.clear(); });

describe("Film next: three picks", () => {
  it("shows three distinct picks, each with premise, what the viewer gets, the opening line, why it fits and the effort", () => {
    setup();
    const items = picksList();
    expect(items).toHaveLength(3);
    const expected = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks;
    expect(items.map((i) => i.getAttribute("aria-label"))).toEqual(expected.map((p) => p.title));
    for (const [i, idea] of expected.entries()) {
      const li = items[i];
      expect(li).toHaveTextContent(idea.premise);
      expect(li).toHaveTextContent(`“${idea.hook}”`);
      expect(li).toHaveTextContent("The viewer gets:");
      expect(li).toHaveTextContent("Why it fits:");
      expect(li).toHaveTextContent(/About \d+ (minutes|hours) to film/);
    }
  });
  it("says it uses no AI, and offers Film this, Edit and Not for me on every pick", () => {
    setup();
    expect(screen.getByText(/nothing here uses ai/i)).toBeInTheDocument();
    for (const li of picksList()) {
      expect(within(li).getByRole("button", { name: /^Film this:/ })).toBeEnabled();
      expect(within(li).getByRole("button", { name: /^Edit before filming:/ })).toBeEnabled();
      expect(within(li).getByRole("button", { name: /^Not for me:/ })).toBeEnabled();
    }
  });
});

describe("Film next: filters", () => {
  it("changing a filter changes the picks, and every pick fits it", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "short" } });
    const items = picksList();
    expect(items).toHaveLength(3);
    for (const li of items) expect(li).toHaveTextContent(/Short\b/);
    expect(screen.getByRole("status")).toHaveTextContent("1 filter is on");
  });
  it("keeps time and place out of the way until asked, then filters by them", () => {
    setup();
    expect(screen.queryByLabelText("Time to film")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /time and place/i }));
    fireEvent.change(screen.getByLabelText("Time to film"), { target: { value: "20" } });
    for (const li of picksList()) expect(li).toHaveTextContent(/About (15|20) minutes to film/);
    fireEvent.change(screen.getByLabelText("Where I am"), { target: { value: "car" } });
    expect(screen.getByRole("status")).toHaveTextContent("2 filters are on");
  });
  it("Clear filters puts everything back", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "faith" } });
    for (const li of picksList()) expect(li).toHaveTextContent("Faith");
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText("Topic")).toHaveValue("any");
  });
  it("remembers the filters on this device across a reload", () => {
    const { unmount } = setup();
    fireEvent.change(screen.getByLabelText("Platform"), { target: { value: "TikTok" } });
    unmount();
    setup();
    expect(screen.getByLabelText("Platform")).toHaveValue("TikTok");
  });
  it("says so plainly when nothing fits, instead of showing an empty box", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "faith" } });
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "long" } });
    fireEvent.click(screen.getByRole("button", { name: /time and place/i }));
    fireEvent.change(screen.getByLabelText("Time to film"), { target: { value: "20" } });
    expect(picksList()).toHaveLength(0);
    expect(screen.getByText(/no saved idea fits these filters/i)).toBeInTheDocument();
  });
});

describe("Film next: choosing, editing, dismissing", () => {
  it("Film this chooses exactly that idea with no edits", () => {
    const { onFilm } = setup();
    const first = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks[0];
    fireEvent.click(screen.getByRole("button", { name: `Film this: ${first.title}` }));
    expect(onFilm).toHaveBeenCalledTimes(1);
    expect(onFilm).toHaveBeenCalledWith(first, undefined);
  });
  it("while one pick is saving every button waits, so a double tap cannot save twice", () => {
    setup({ busyKey: BANK_IDEAS[0].key });
    for (const b of screen.getAllByRole("button", { name: /^(Film this|Edit before filming|Not for me):/ })) expect(b).toBeDisabled();
    expect(screen.getByRole("button", { name: /write my own idea/i })).toBeEnabled(); // opening a form is not a save
  });
  it("editing changes the title, opening line and premise before choosing, and passes those edits along", () => {
    const { onFilm } = setup();
    const first = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks[0];
    fireEvent.click(screen.getByRole("button", { name: `Edit before filming: ${first.title}` }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My own title" } });
    fireEvent.change(screen.getByLabelText("Opening line"), { target: { value: "My own opening" } });
    fireEvent.click(screen.getByRole("button", { name: /film this with my changes/i }));
    expect(onFilm).toHaveBeenCalledWith(first, { title: "My own title", hook: "My own opening", premise: first.premise });
  });
  it("cancelling an edit restores the original and chooses nothing", () => {
    const { onFilm } = setup();
    const first = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks[0];
    fireEvent.click(screen.getByRole("button", { name: `Edit before filming: ${first.title}` }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: first.title })).toBeInTheDocument();
    expect(onFilm).not.toHaveBeenCalled();
  });
  it("Not for me asks for an optional reason, and Keep it dismisses nothing", () => {
    const { onDismiss } = setup();
    const first = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks[0];
    fireEvent.click(screen.getByRole("button", { name: `Not for me: ${first.title}` }));
    expect(screen.getByLabelText(/why not/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: `Film this: ${first.title}` })).toBeInTheDocument();
  });
  it("dismissing with no reason passes an empty reason, because the reason is optional", () => {
    const { onDismiss } = setup();
    const first = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks[0];
    fireEvent.click(screen.getByRole("button", { name: `Not for me: ${first.title}` }));
    fireEvent.click(screen.getByRole("button", { name: `Dismiss: ${first.title}` }));
    expect(onDismiss).toHaveBeenCalledWith(first, "");
  });
  it("dismissing with a reason passes the reason along", () => {
    const { onDismiss } = setup();
    const first = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks[0];
    fireEvent.click(screen.getByRole("button", { name: `Not for me: ${first.title}` }));
    fireEvent.change(screen.getByLabelText(/why not/i), { target: { value: "wrong season" } });
    fireEvent.click(screen.getByRole("button", { name: `Dismiss: ${first.title}` }));
    expect(onDismiss).toHaveBeenCalledWith(first, "wrong season");
  });
  it("a dismissed idea is never offered, and can be brought back from the dismissed list with its reason shown", () => {
    const top = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks[0];
    const { onBringBack } = setup({ dismissed: [{ idea_key: top.key, title: top.title, reason: "wrong season", dismissed_at: "2026-10-09T00:00:00Z" }] });
    expect(picksList().map((li) => li.getAttribute("aria-label"))).not.toContain(top.title);
    expect(screen.getByText("Dismissed ideas (1)")).toBeInTheDocument();
    expect(screen.getByText("Reason: wrong season")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Bring back: ${top.title}` }));
    expect(onBringBack).toHaveBeenCalledWith(top.key);
  });
  it("an idea that already has a project is not offered again", () => {
    const top = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks[0];
    setup({ used: new Set([top.key]) });
    expect(picksList().map((li) => li.getAttribute("aria-label"))).not.toContain(top.title);
  });
  it("warns that a dismissed idea may reappear when the dismissals could not be loaded", () => {
    setup({ dismissalsFailed: true });
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
  });
});

describe("Film next: write my own idea", () => {
  it("needs a title, then either films it or saves it for later as the viewer's own idea", () => {
    const { onFilm, onSaveLater } = setup();
    fireEvent.click(screen.getByRole("button", { name: /write my own idea/i }));
    const group = screen.getByRole("group", { name: "Write my own idea" });
    expect(within(group).getByRole("button", { name: "Film this" })).toBeDisabled();
    fireEvent.change(within(group).getByLabelText("Title"), { target: { value: "  Why I train at 5am  " } });
    fireEvent.change(within(group).getByLabelText("Format"), { target: { value: "long" } });
    act(() => { within(group).getByRole("button", { name: "Film this" }).click(); });
    expect(onFilm).toHaveBeenCalledTimes(1);
    const idea = onFilm.mock.calls[0][0];
    expect(idea).toMatchObject({ title: "Why I train at 5am", format: "long", source: "own" });
    expect(idea.key).toMatch(/^own:/);
    fireEvent.click(screen.getByRole("button", { name: /write my own idea/i }));
    fireEvent.change(screen.getByRole("group", { name: "Write my own idea" }).querySelector("input")!, { target: { value: "Another" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for later" }));
    expect(onSaveLater).toHaveBeenCalledTimes(1);
    expect(onSaveLater.mock.calls[0][0]).toMatchObject({ title: "Another", source: "own" });
  });
});
