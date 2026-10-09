import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BANK_IDEAS } from "@/data/contentIdeaBank";
import { buildFilmingPack, parsePack } from "@/lib/contentFilmingPack";
import { FilmingPackSheet, type PackCard } from "@/components/content/FilmingPackSheet";

const idea = BANK_IDEAS.find((i) => i.kind === "vlog" && i.format === "long")!;
const card = (over: Partial<PackCard> = {}): PackCard => ({ id: "c1", title: idea.title, status: "record", clip: "", record_script: buildFilmingPack(idea), brief: { premise: idea.premise, payoff: idea.payoff }, ...over });
const boxes = () => screen.getAllByRole("checkbox");
let onSave: ReturnType<typeof vi.fn>;
const open = (c: PackCard | null = card(), extra: Partial<React.ComponentProps<typeof FilmingPackSheet>> = {}) =>
  render(<FilmingPackSheet card={c} open onOpenChange={vi.fn()} onSave={onSave as never} onOpenEditor={vi.fn()} {...extra} />);
beforeEach(() => { onSave = vi.fn(async () => true); });

describe("filming pack sheet", () => {
  it("shows the idea, the viewer's payoff, where the project is and what to do next", () => {
    open();
    expect(screen.getByText(idea.premise)).toBeInTheDocument();
    expect(screen.getByText(idea.payoff)).toBeInTheDocument();
    expect(screen.getByText(/Selected · /)).toBeInTheDocument();
  });
  it("lists every checklist line as a large checkbox with progress, and the vlog note about the cut", () => {
    open();
    const total = parsePack(card().record_script).total;
    expect(boxes()).toHaveLength(total);
    expect(screen.getByText(`0 of ${total} done`)).toBeInTheDocument();
    expect(screen.getByText(/vlogs are cut by you/i)).toBeInTheDocument();
  });
  it("ticking saves the new text once, shows it ticked, and updates the progress", async () => {
    open();
    fireEvent.click(boxes()[1]);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [id, text] = onSave.mock.calls[0];
    expect(id).toBe("c1");
    expect(parsePack(text).done).toBe(1);
    expect(parsePack(text).items[1].checked).toBe(true);
    expect(boxes()[1]).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });
  it("two quick taps are saved one after the other, and the last save holds both ticks", async () => {
    const order: string[] = [];
    let release: (v: boolean) => void = () => {};
    onSave = vi.fn((_id: string, text: string) => { order.push(`start:${parsePack(text).done}`); return new Promise<boolean>((r) => { release = (v) => { order.push(`end:${parsePack(text).done}`); r(v); }; }); });
    open();
    act(() => { boxes()[0].click(); boxes()[1].click(); });
    expect(onSave).toHaveBeenCalledTimes(1); // the second tap waits for the first save
    await act(async () => { release(true); });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(parsePack(onSave.mock.calls[1][1]).done).toBe(2);
    await act(async () => { release(true); });
    expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
  });
  it("a save that fails says Not saved with a Retry, keeps the tick on screen, and the retry sends the same text", async () => {
    onSave = vi.fn(async () => false);
    open();
    fireEvent.click(boxes()[0]);
    await waitFor(() => expect(screen.getByText(/not saved/i)).toBeInTheDocument());
    expect(boxes()[0]).toHaveAttribute("aria-checked", "true");
    const failedText = onSave.mock.calls[0][1];
    onSave.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][1]).toBe(failedText);
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });
  it("lets the person edit the raw text and saves it, and clear the ticks for a re-shoot", async () => {
    open(card({ record_script: `${buildFilmingPack(idea)}`.replace("- [ ] 1.", "- [x] 1.") }));
    expect(screen.getByRole("button", { name: /clear ticks/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /clear ticks/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(parsePack(onSave.mock.calls[0][1]).done).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Edit text" }));
    fireEvent.change(screen.getByLabelText("Pack text"), { target: { value: "FILM: mine\n- [ ] 1. only this" } });
    fireEvent.click(screen.getByRole("button", { name: "Save text" }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith("c1", "FILM: mine\n- [ ] 1. only this"));
  });
  it("a project with no pack says so and points at the editor instead of showing an empty list", () => {
    open(card({ record_script: "" }));
    expect(screen.getByText(/no filming pack yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
  it("renders nothing without a project", () => {
    const { container } = open(null);
    expect(container).toBeEmptyDOMElement();
  });
  it("filming starts the moment an item is ticked: the label moves from Selected to Filming", async () => {
    open();
    expect(screen.getByText(/Selected · /)).toBeInTheDocument();
    fireEvent.click(boxes()[0]);
    await waitFor(() => expect(screen.getByText(/Filming · /)).toBeInTheDocument());
  });
});
