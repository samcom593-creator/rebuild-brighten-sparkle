/**
 * The filming pack: what to say, in what order, and what to capture, as a plain-text checklist that lives in the
 * card's existing record_script column. Ticking an item rewrites one line of that text, so progress survives a
 * refresh, a phone, another device and an edit in the card editor, with no new storage.
 *
 * Format (one item per line, everything else is free text the person can edit):
 *     - [ ] 1. Open on the hook: "..."
 *     - [x] 2. Say the goal in one sentence.
 */
import type { PickIdea } from "@/lib/contentPicks";

const ITEM = /^(\s*)-\s\[( |x|X)\]\s?(.*)$/;

export interface PackItem { line: number; checked: boolean; text: string }
export interface PackProgress { done: number; total: number; items: PackItem[]; complete: boolean }

/** Every checklist line in the pack, with its line number, in order. */
export function parsePack(text: string | null | undefined): PackProgress {
  const items: PackItem[] = [];
  (text ?? "").split("\n").forEach((raw, line) => {
    const m = ITEM.exec(raw);
    if (m) items.push({ line, checked: m[2].toLowerCase() === "x", text: m[3] });
  });
  const done = items.filter((i) => i.checked).length;
  return { done, total: items.length, items, complete: items.length > 0 && done === items.length };
}

/** Flip one checklist line and return the new text. Any other line, or a non-item line, leaves the text unchanged. */
export function togglePackItem(text: string, line: number): string {
  const lines = text.split("\n");
  const m = ITEM.exec(lines[line] ?? "");
  if (!m) return text;
  lines[line] = `${m[1]}- [${m[2] === " " ? "x" : " "}] ${m[3]}`;
  return lines.join("\n");
}

/** Reset every tick, for a re-shoot. */
export const clearPackTicks = (text: string): string => text.split("\n").map((l) => l.replace(/^(\s*-\s\[)[xX](\])/, "$1 $2")).join("\n");

const camera = (idea: Pick<PickIdea, "format" | "kind">): string =>
  idea.format === "short" ? "VERTICAL 9:16, one idea in 20 to 45 seconds"
    : idea.kind === "vlog" ? "HORIZONTAL 16:9, film the whole thing and keep the camera rolling on the real moments"
    : "HORIZONTAL 16:9, one take with a clean framing, aim for 8 to 12 finished minutes";

const minutesLabel = (m: number): string => (m >= 120 ? `about ${Math.round(m / 60)} hours` : `about ${m} minutes`);

/**
 * Build the pack for a chosen idea. A talking-head idea gets a script outline (the opening, the beats, the ending). A
 * vlog gets a story outline plus a shot list. An idea with no beats of its own still gets a usable pack: the opening,
 * a prompt for each beat and the ending, so nothing is blank. Vlogs say plainly that the cut is the person's own.
 */
export function buildFilmingPack(idea: Pick<PickIdea, "title" | "format" | "kind" | "minutes" | "hook" | "premise" | "payoff" | "beats" | "shots" | "ending">): string {
  const out: string[] = [];
  out.push(`FILM: ${idea.title}`);
  out.push(`Camera: ${camera(idea)}`);
  out.push(`Time to film: ${minutesLabel(idea.minutes)}`);
  if (idea.premise) out.push(`The idea: ${idea.premise}`);
  if (idea.payoff) out.push(`What the viewer gets: ${idea.payoff}`);
  out.push("");
  out.push(idea.kind === "vlog" ? "STORY OUTLINE" : "SCRIPT OUTLINE");
  const beats = idea.beats.length > 0 ? idea.beats : ["Say the point of this video in one sentence.", "Give the real example, with only details you can stand behind.", "Say the one thing the viewer should do next."];
  let n = 1;
  out.push(`- [ ] ${n++}. Open on the hook: "${idea.hook}"`);
  for (const b of beats) out.push(`- [ ] ${n++}. ${b}`);
  if (idea.shots.length > 0) {
    out.push("");
    out.push("SHOTS TO CAPTURE");
    for (const s of idea.shots) out.push(`- [ ] ${s}`);
  }
  out.push("");
  out.push("ENDING");
  out.push(`- [ ] ${idea.ending || "Say the one lesson, then stop."}`);
  if (idea.kind === "vlog") {
    out.push("");
    out.push("Vlogs are cut by you. This pack lists what to capture, not an edit.");
  }
  return out.join("\n");
}

/** A progress line for the card: "3 of 8 done", or null when the text has no checklist. */
export function packSummary(text: string | null | undefined): string | null {
  const p = parsePack(text);
  return p.total === 0 ? null : `${p.done} of ${p.total} done`;
}
