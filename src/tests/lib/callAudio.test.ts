import { describe, expect, it } from "vitest";
import { momentsFrom, toSeconds } from "@/lib/callAudio";

describe("callAudio", () => {
  it("reads transcript stamps as seconds", () => {
    expect(toSeconds("3:45")).toBe(225);
    expect(toSeconds("[1:02:07]")).toBe(3727);
    expect(toSeconds("75")).toBe(75);
    expect(toSeconds("")).toBeNull();
    expect(toSeconds("ab:cd")).toBeNull();
    expect(toSeconds(null)).toBeNull();
  });
  it("builds moments from quotes and key moments and drops what it cannot place", () => {
    expect(momentsFrom([{ t: "1:05", label: "price objection" }, { t: "2:10", who: "client", quote: "I can't afford that right now" }, { t: "x" }, null, "bad"]))
      .toEqual([{ t: "1:05", label: "price objection" }, { t: "2:10", label: "client: I can't afford that right now" }]);
    expect(momentsFrom(undefined)).toEqual([]);
  });
});
