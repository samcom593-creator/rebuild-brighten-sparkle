/**
 * OVERHAUL-1 (2026-10-29): the pure rules behind "Your link" and "Make a link" on Invite an agent
 * and Refer a recruit. What a link carries, how long it works, and the words people read.
 */
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TEMPORARY_HOURS,
  EMPTY_DETAILS,
  PUBLIC_SITE,
  TEMPORARY_SPANS,
  detailsToSend,
  emailHref,
  expiryFrom,
  formatExpiry,
  hasAnyDetail,
  hireTargetRole,
  lifetimeLine,
  linkSentence,
  linkText,
  ownLinkPath,
  ownLinkUrl,
  shareLink,
  textHref,
} from "@/lib/recruitLinks";
import { licensePathTone, linkLifetimeTone } from "@/lib/tones";

const PHX = { timeZone: "America/Phoenix", locale: "en-US" };

describe("your own link", () => {
  it("is /r/<slug> on the public site, from the slug alone", () => {
    expect(ownLinkUrl("samuel-james-7c3c55")).toBe(`${PUBLIC_SITE}/r/samuel-james-7c3c55`);
    expect(PUBLIC_SITE).toBe("https://apex-financial.org");
    expect(ownLinkPath(ownLinkUrl("samuel-james-7c3c55") as string)).toBe("/r/samuel-james-7c3c55");
  });

  it("is no link at all when there is no slug, never a link that credits nobody", () => {
    expect(ownLinkUrl(null)).toBeNull();
    expect(ownLinkUrl(undefined)).toBeNull();
    expect(ownLinkUrl("   ")).toBeNull();
  });

  it("encodes a slug that is not URL-safe", () => {
    expect(ownLinkUrl("a b/c")).toBe(`${PUBLIC_SITE}/r/a%20b%2Fc`);
  });
});

describe("how long a link works", () => {
  it("offers one day to thirty days, defaulting to the week the team has always used", () => {
    expect(TEMPORARY_SPANS.map((s) => s.hours)).toEqual([24, 72, 168, 336, 720]);
    expect(TEMPORARY_SPANS.map((s) => s.label)).toEqual(["1 day", "3 days", "7 days", "14 days", "30 days"]);
    expect(DEFAULT_TEMPORARY_HOURS).toBe(168);
  });

  it("computes the stop time from now, clamped to the server's 1..720 hours", () => {
    const now = new Date("2026-10-29T03:00:00Z");
    expect(expiryFrom(72, now).toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(expiryFrom(0, now).toISOString()).toBe("2026-10-29T04:00:00.000Z");
    expect(expiryFrom(10_000, now).toISOString()).toBe("2026-11-28T03:00:00.000Z");
    expect(expiryFrom(Number.NaN, now).toISOString()).toBe("2026-11-05T03:00:00.000Z");
  });

  it("names the day and the time, and the year only when it is not this year", () => {
    const now = new Date("2026-10-29T03:00:00Z");
    expect(formatExpiry("2026-11-05T03:57:00Z", { now, ...PHX })).toBe("Wed, Nov 4 at 8:57 PM");
    expect(formatExpiry("2027-01-02T19:05:00Z", { now, ...PHX })).toBe("Sat, Jan 2, 2027 at 12:05 PM");
  });

  it("returns nothing for a missing or unreadable date, so no page prints Invalid Date", () => {
    expect(formatExpiry(null)).toBeNull();
    expect(formatExpiry("")).toBeNull();
    expect(formatExpiry("infinity")).toBeNull();
    expect(formatExpiry("not a date")).toBeNull();
  });

  it("says Never expires only when the server said permanent; an unknown date is never called permanent", () => {
    const now = new Date("2026-10-29T03:00:00Z");
    expect(lifetimeLine({ permanent: true, expiresAt: null })).toBe("Never expires");
    expect(lifetimeLine({ permanent: false, expiresAt: "2026-11-05T03:57:00Z" }, { now, ...PHX })).toBe("Stops working Wed, Nov 4 at 8:57 PM");
    expect(lifetimeLine({ permanent: false, expiresAt: null })).toBe("Expiry date unknown");
    expect(lifetimeLine({ expiresAt: "unreadable" })).toBe("Expiry date unknown");
  });
});

describe("Quick link or With details", () => {
  const typed = { firstName: " Mary Ann ", lastName: "Smith", email: "mary@example.com ", phone: "(256) 975-6155", npn: "12345678" };

  it("a Quick link carries no details, even ones typed before switching", () => {
    expect(detailsToSend("quick", typed)).toEqual(EMPTY_DETAILS);
  });

  it("With details carries what was typed, trimmed", () => {
    expect(detailsToSend("details", typed)).toEqual({
      firstName: "Mary Ann", lastName: "Smith", email: "mary@example.com", phone: "(256) 975-6155", npn: "12345678",
    });
  });

  it("knows when nothing was filled in", () => {
    expect(hasAnyDetail(EMPTY_DETAILS)).toBe(false);
    expect(hasAnyDetail({ ...EMPTY_DETAILS, npn: " 1 " })).toBe(true);
  });
});

describe("License either-or", () => {
  it("turns the agent's license choice into the server's role and leaves other roles alone", () => {
    expect(hireTargetRole("agent", "licensed")).toBe("hired_licensed");
    expect(hireTargetRole("agent", "unlicensed")).toBe("hired_unlicensed");
    expect(hireTargetRole("hired_manager", "licensed")).toBe("hired_manager");
    expect(hireTargetRole("staff", null)).toBe("staff");
  });

  it("pairs every state with its tone through one map, and an unknown one is quiet", () => {
    expect(licensePathTone("licensed")).toBe("good");
    expect(licensePathTone("unlicensed")).toBe("cool");
    expect(licensePathTone(null)).toBe("slate");
    expect(linkLifetimeTone("permanent")).toBe("good");
    expect(linkLifetimeTone("temporary")).toBe("warm");
    expect(linkLifetimeTone("whatever")).toBe("slate");
  });
});

describe("the words that go with a shared link", () => {
  const url = "https://apex-financial.org/hire/tok";

  it("greets by first name, names what the link does, and puts the link on its own line", () => {
    expect(linkSentence({ kind: "hire", url, orgName: "Galaxy Financial", firstName: "Mary Ann" })).toBe("Hi Mary, here is your personal link to join Galaxy Financial:");
    expect(linkSentence({ kind: "join", url, orgName: "Galaxy Financial" })).toBe("Here is your link to apply to Galaxy Financial:");
    expect(linkSentence({ kind: "own", url, orgName: "Galaxy Financial", firstName: "ignored" })).toBe("Here is my link to join Galaxy Financial:");
    expect(linkText({ kind: "join", url, orgName: "Galaxy Financial", firstName: "Jo" })).toBe(`Hi Jo, here is your link to apply to Galaxy Financial:\n${url}`);
  });

  it("opens Messages with the text filled in, to the number when there is one", () => {
    expect(textHref("(256) 975-6155", "Hi\nlink")).toBe("sms:+12569756155?&body=Hi%0Alink");
    expect(textHref(null, "Hi")).toBe("sms:?&body=Hi");
    expect(textHref("123", "Hi")).toBe("sms:?&body=Hi");
  });

  it("drafts an email that says the rules: once, this address only, and when it stops", () => {
    const href = emailHref({
      to: "mary@example.com", kind: "hire", url, orgName: "Galaxy Financial", firstName: "Mary",
      permanent: false, expiresAt: "2026-11-05T03:57:00Z", recipientLocked: true,
    });
    expect(href.startsWith("mailto:mary%40example.com?subject=")).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(params.get("subject")).toBe("Your invitation to Galaxy Financial");
    expect(params.get("body")).toContain("Hi Mary,\n\nHere is your personal link to join Galaxy Financial:\n" + url);
    expect(params.get("body")).toContain("It works once, and only for this email address.");
    expect(params.get("body")).toMatch(/It stops working \w{3}, Nov \d+ at/);
  });

  it("a permanent link's email names no stop date, and an open link's email no address rule", () => {
    const href = emailHref({ kind: "join", url, orgName: "Galaxy Financial", permanent: true });
    expect(href.startsWith("mailto:?subject=")).toBe(true);
    const body = new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("body") ?? "";
    expect(body).toBe(`Hi,\n\nHere is your link to apply to Galaxy Financial:\n${url}\n\nIt works once.`);
  });
});

describe("Share", () => {
  const data = { title: "Join", text: "Here is my link:", url: "https://apex-financial.org/r/x" };

  it("uses the phone's share sheet when there is one", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await shareLink(data, { share, clipboard: { writeText } } as never)).toBe("shared");
    expect(share).toHaveBeenCalledWith(data);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("a closed share sheet is not an error and copies nothing", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"));
    const writeText = vi.fn();
    expect(await shareLink(data, { share, clipboard: { writeText } } as never)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("a browser with no share sheet copies the link instead, and says when even that is blocked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareLink(data, { clipboard: { writeText } } as never)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(data.url);
    const refused = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    expect(await shareLink(data, { clipboard: { writeText: refused } } as never)).toBe("failed");
  });

  it("a share sheet that refuses the payload still leaves the copy path", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareLink(data, { share, clipboard: { writeText } } as never)).toBe("copied");
  });
});
