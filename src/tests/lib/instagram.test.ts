import { describe, expect, it } from "vitest";

import { instagramProfileLink } from "@/lib/instagram";

describe("instagramProfileLink", () => {
  it.each([
    ["samjames", "samjames"],
    ["@@theprincejamez", "theprincejamez"],
    ["https://www.instagram.com/theprincejamez/", "theprincejamez"],
    ["instagram.com/theprincejamez?hl=en", "theprincejamez"],
  ])("builds a one-tap profile link from %s", (input, handle) => {
    expect(instagramProfileLink(input)).toEqual({
      handle,
      href: `https://www.instagram.com/${handle}/`,
    });
  });

  it.each([null, undefined, "", "@", "not a handle", "https://example.com/person"])(
    "rejects unusable Instagram values",
    (input) => {
      expect(instagramProfileLink(input)).toBeNull();
    },
  );
});
