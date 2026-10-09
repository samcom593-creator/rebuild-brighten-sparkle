import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// "Film this" failed with "Couldn't pick this video: save failed" because the card it inserts started from
// the editor's blank draft, whose due_date is "", and due_date is a date column: Postgres rejects "" with a
// 400, so every pick failed and nothing said why. Any insert built from the blank draft must send null.
const src = readFileSync(resolve(__dirname, "../../pages/LaunchBoard.tsx"), "utf8");

describe("Launch Board pick", () => {
  it("never inserts a card built from the blank draft with an empty-string due date", () => {
    const lines = src.split("\n").filter((l) => /const base = \{ \.\.\.emptyDraft/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/due_date: null/);
  });

  it("the editor save still turns an empty date into null", () => {
    expect(src).toMatch(/f === "due_date" \? \(draftStr\(f\) \|\| null\)/);
  });
});
