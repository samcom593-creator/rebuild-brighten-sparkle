import { describe, expect, it } from "vitest";
import {
  isDialablePhone,
  googleVoiceAccountChooserHref,
  normalizePhoneForDial,
  phoneHref,
  smsHref,
  isRealUsNumber,
  maskUsPhoneInput,
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
    const call = decodeURIComponent(phoneHref("(469) 767-6068")!);
    const text = decodeURIComponent(smsHref("(469) 767-6068")!);
    expect(call).toContain("accounts.google.com/AccountChooser?continue=https://voice.google.com/calls?a=nc,%2B14697676068");
    expect(text).toContain("accounts.google.com/AccountChooser?continue=https://voice.google.com/messages?itemId=t.%2B14697676068");
  });

  it("provides an account-switch recovery link for ineligible Voice accounts", () => {
    const href = googleVoiceAccountChooserHref();
    expect(href).toContain("accounts.google.com/AccountChooser");
    expect(decodeURIComponent(href)).toContain("continue=https://voice.google.com/");
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

describe("maskUsPhoneInput: the country code comes off before the ten digits are counted", () => {
  it("an autofilled +1 number keeps all ten of its own digits", () => {
    expect(maskUsPhoneInput("+1 (480) 555-0100")).toBe("(480) 555-0100");
    expect(maskUsPhoneInput("14805550100")).toBe("(480) 555-0100");
    expect(maskUsPhoneInput("4805550100")).toBe("(480) 555-0100");
  });

  it("the old rule, ten digits first, still loses the last digit on the same input", () => {
    const old = (v: string) => v.replace(/\D+/g, "").slice(0, 10);
    expect(old("+1 (480) 555-0100")).toBe("1480555010");
  });

  it("masks a number as it is typed and never exceeds ten digits", () => {
    expect(maskUsPhoneInput("480")).toBe("480");
    expect(maskUsPhoneInput("48055")).toBe("(480) 55");
    expect(maskUsPhoneInput("48055501009999")).toBe("(480) 555-0100");
    expect(maskUsPhoneInput("")).toBe("");
  });

  it("isRealUsNumber refuses the shape the old mask stored", () => {
    expect(isRealUsNumber("1480555010")).toBe(false);
    expect(isRealUsNumber("4805550100")).toBe(true);
    expect(isRealUsNumber("+1 (480) 555-0100")).toBe(true);
    expect(isRealUsNumber("")).toBe(false);
    expect(isRealUsNumber(null)).toBe(false);
  });
});
