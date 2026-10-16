import { describe, expect, it } from "vitest";
import { carriedQuery, shortLinkFallbackTarget } from "@/lib/recruitingShortLink";

describe("carriedQuery (what /r/<code> forwards beside the recruiter code)", () => {
  it("is empty when the visitor brought nothing", () => {
    expect(carriedQuery("")).toBe("");
    expect(carriedQuery(null)).toBe("");
    expect(carriedQuery(undefined)).toBe("");
  });

  it("carries campaign keys as an '&' suffix ready to follow ?ref=", () => {
    expect(carriedQuery("?utm_source=ig&utm_medium=bio")).toBe("&utm_source=ig&utm_medium=bio");
  });

  it("drops a ?ref= the visitor already had: the path code is the recruiter", () => {
    expect(carriedQuery("?ref=someone-else&utm_source=ig")).toBe("&utm_source=ig");
    expect(carriedQuery("?ref=someone-else")).toBe("");
  });

  it("drops only the keys it is told to", () => {
    expect(carriedQuery("?ref=x&source=snap", ["source"])).toBe("&ref=x");
  });
});

describe("shortLinkFallbackTarget (no usable code)", () => {
  it("is the bare apply page with nothing else", () => {
    expect(shortLinkFallbackTarget("", "")).toBe("/apply");
    expect(shortLinkFallbackTarget(null, undefined)).toBe("/apply");
  });

  it("keeps the visitor's query and hash", () => {
    expect(shortLinkFallbackTarget("?utm_source=ig", "#form")).toBe("/apply?utm_source=ig#form");
    expect(shortLinkFallbackTarget("", "#")).toBe("/apply");
  });
});
