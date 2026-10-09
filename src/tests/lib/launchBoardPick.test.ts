import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// "Film this" failed with "Couldn't pick this video: save failed" because the card it inserts started from
// the editor's blank draft, whose due_date is "", and due_date is a date column: Postgres rejects "" with a
// 400, so every pick failed and nothing said why. Any insert built from the blank draft must send null.
const src = readFileSync(resolve(__dirname, "../../pages/LaunchBoard.tsx"), "utf8");
// Picks are now saved by the save layer (src/lib/contentProjects.ts), which owns the insert.
const saveLayer = readFileSync(resolve(__dirname, "../../lib/contentProjects.ts"), "utf8");

describe("Launch Board pick", () => {
  it("never inserts a card built from the blank draft with an empty-string due date", () => {
    // Any insert the page still builds from the blank draft must send null.
    for (const l of src.split("\n").filter((x) => /const base = \{ \.\.\.emptyDraft/.test(x))) expect(l).toMatch(/due_date: null/);
    // And the save layer, which now owns picking, sends null and never an empty string.
    expect(saveLayer).toMatch(/due_date: null as string \| null/);
    expect(saveLayer).not.toMatch(/due_date: ""/);
  });

  it("the editor save still turns an empty date into null", () => {
    expect(src).toMatch(/f === "due_date" \? \(draftStr\(f\) \|\| null\)/);
  });
});
