import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "@/lib/chunkRecovery";

describe("isChunkLoadError", () => {
  it("recognises a stale chunk that React.lazy received as undefined, in Chrome and Safari wording", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'default')"))).toBe(true);
    expect(isChunkLoadError(new TypeError("undefined is not an object (evaluating 's._result.default')"))).toBe(true);
  });

  it("still recognises the network failures it caught before", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x.test/assets/a.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/b.css"))).toBe(true);
  });

  it("leaves ordinary errors to the normal error screen", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'waiting')"))).toBe(false);
  });
});
