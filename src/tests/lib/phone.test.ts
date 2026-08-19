import { describe, expect, it } from "vitest";
import {
  isDialablePhone,
  normalizePhoneForDial,
  phoneHref,
  smsHref,
} from "@/lib/phone";

describe("phone helpers", () => {
  it.each([
    ["(469) 767-6068", "+14697676068"],
    ["469-767-6068", "+14697676068"],
    ["1 (469) 767-6068", "+14697676068"],
    ["+44 20 7946 0958", "+442079460958"],
    ["011 44 20 7946 0958", "+442079460958"],
    ["00 44 20 7946 0958", "+442079460958"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePhoneForDial(input)).toBe(expected);
  });

  it.each([
    "",
    "not-a-phone",
    "jmosdfifrnjmgnmhbrdn=o=0o=",
    "12345",
    "09078401144",
    "0000000000",
  ])("rejects ambiguous or invalid input %s", (input) => {
    expect(isDialablePhone(input)).toBe(false);
    expect(phoneHref(input)).toBeNull();
    expect(smsHref(input)).toBeNull();
  });

  it("builds normalized call and text links on desktop", () => {
    expect(phoneHref("(469) 767-6068")).toBe("https://voice.google.com/u/0/calls?a=nc,%2B14697676068");
    expect(smsHref("(469) 767-6068")).toBe("https://voice.google.com/u/0/messages?itemId=t.%2B14697676068");
  });

  it("builds tel and sms links on touch devices", () => {
    const originalMatchMedia = window.matchMedia;
    try {
      window.matchMedia = (query: string) => ({
        matches: query === "(pointer: coarse)",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      });
      expect(phoneHref("(469) 767-6068")).toBe("tel:+14697676068");
      expect(smsHref("(469) 767-6068")).toBe("sms:+14697676068");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
