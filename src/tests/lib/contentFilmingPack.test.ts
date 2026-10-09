import { describe, expect, it } from "vitest";
import { BANK_IDEAS } from "@/data/contentIdeaBank";
import { buildFilmingPack, clearPackTicks, packSummary, parsePack, togglePackItem } from "@/lib/contentFilmingPack";
import { lifecycleOf, lifecycleText } from "@/lib/contentWorkflow";

const talking = BANK_IDEAS.find((i) => i.kind === "talking_head" && i.format === "short")!;
const vlog = BANK_IDEAS.find((i) => i.kind === "vlog" && i.format === "long")!;

describe("filming pack", () => {
  it("a talking-head pack is a script outline: the opening, every beat, then the ending", () => {
    const text = buildFilmingPack(talking);
    expect(text).toContain("SCRIPT OUTLINE");
    expect(text).not.toContain("SHOTS TO CAPTURE");
    expect(text).toContain(`Open on the hook: "${talking.hook}"`);
    const p = parsePack(text);
    expect(p.total).toBe(talking.beats.length + 2); // hook + beats + ending
    expect(p.done).toBe(0);
    expect(text).toContain("VERTICAL 9:16");
  });
  it("a vlog pack is a story outline plus a shot list, and says the cut is the person's own", () => {
    const text = buildFilmingPack(vlog);
    expect(text).toContain("STORY OUTLINE");
    expect(text).toContain("SHOTS TO CAPTURE");
    expect(parsePack(text).total).toBe(vlog.beats.length + vlog.shots.length + 2);
    expect(text).toContain("Vlogs are cut by you");
    expect(text).toContain("HORIZONTAL 16:9");
  });
  it("an idea with no beats of its own still gets a usable pack with nothing blank", () => {
    const text = buildFilmingPack({ title: "Mine", format: "short", kind: "talking_head", minutes: 30, hook: "Mine", premise: "", payoff: "", beats: [], shots: [], ending: "" });
    const p = parsePack(text);
    expect(p.total).toBe(5);
    expect(p.items.every((i) => i.text.trim().length > 0)).toBe(true);
  });
  it("ticking flips exactly one line, and ticking again flips it back", () => {
    const text = buildFilmingPack(talking);
    const first = parsePack(text).items[1];
    const once = togglePackItem(text, first.line);
    expect(parsePack(once).done).toBe(1);
    expect(parsePack(once).items[1].checked).toBe(true);
    expect(once.split("\n").filter((l, i) => l !== text.split("\n")[i])).toHaveLength(1);
    expect(togglePackItem(once, first.line)).toBe(text);
  });
  it("toggling a line that is not a checklist item changes nothing", () => {
    const text = buildFilmingPack(talking);
    expect(togglePackItem(text, 0)).toBe(text);
    expect(togglePackItem(text, 9999)).toBe(text);
  });
  it("survives a manual edit of the text: the person's own lines and ticks are kept", () => {
    const text = `${buildFilmingPack(talking)}\n- [x] My own extra shot\nA note I typed`;
    const p = parsePack(text);
    expect(p.items.at(-1)).toMatchObject({ checked: true, text: "My own extra shot" });
    expect(text.includes("A note I typed")).toBe(true);
  });
  it("reports progress, complete only when every item is ticked, and clears for a re-shoot", () => {
    let text = buildFilmingPack(talking);
    expect(packSummary(text)).toBe(`0 of ${parsePack(text).total} done`);
    for (const item of parsePack(text).items) text = togglePackItem(text, item.line);
    expect(parsePack(text).complete).toBe(true);
    expect(parsePack(clearPackTicks(text)).done).toBe(0);
    expect(packSummary("no checklist here")).toBeNull();
    expect(parsePack("").complete).toBe(false);
  });
});

describe("simple lifecycle", () => {
  const base = { status: "record", clip: "", record_script: buildFilmingPack(talking), published_url: null, publish_evidence: null };
  it("an idea is an Idea, and a picked project is Selected until filming actually starts", () => {
    expect(lifecycleOf({ ...base, status: "idea" })).toBe("idea");
    expect(lifecycleOf(base)).toBe("selected");
  });
  it("a ticked item or attached footage makes it Filming", () => {
    const ticked = togglePackItem(base.record_script, parsePack(base.record_script).items[0].line);
    expect(lifecycleOf({ ...base, record_script: ticked })).toBe("filming");
    expect(lifecycleOf({ ...base, clip: "clip-1" })).toBe("filming");
  });
  it("maps the later stored statuses onto Editing, Ready and Published, with evidence required for Published", () => {
    expect(lifecycleOf({ ...base, status: "edit" })).toBe("editing");
    expect(lifecycleOf({ ...base, status: "review" })).toBe("editing");
    expect(lifecycleOf({ ...base, status: "ready" })).toBe("ready");
    expect(lifecycleOf({ ...base, status: "scheduled" })).toBe("ready");
    expect(lifecycleOf({ ...base, status: "published", published_url: "https://youtu.be/abcdef12", publish_evidence: "manual_confirmation" })).toBe("published");
    // Published without evidence is shown as the display stage published_unconfirmed, which is still Published for the person, never "Ready".
    expect(lifecycleOf({ ...base, status: "posted" })).toBe("published");
  });
  it("a post marked published without a live link is shown as unconfirmed, never as plain Published", () => {
    expect(lifecycleText({ ...base, status: "posted" })).toBe("Published (unconfirmed)");
    expect(lifecycleText({ ...base, status: "published", published_url: "https://youtu.be/abcdef12", publish_evidence: "manual_confirmation" })).toBe("Published");
    expect(lifecycleText({ ...base, status: "edit" })).toBe("Editing");
  });
  it("an unknown stored status falls back to Idea, never to Published", () => {
    expect(lifecycleOf({ ...base, status: "weird" })).toBe("idea");
  });
});
