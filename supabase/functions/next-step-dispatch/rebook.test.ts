// MP-ONBOARD-ANCHOR-PKG1: the post-call "pick a new time" link is the call the person booked.
// Run: deno test --no-check supabase/functions/next-step-dispatch/rebook.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rebookBaseUrl, rebookUrl } from "./rebook.ts";
import { SCHEDULING_LINKS } from "../_shared/scheduling-links.ts";

Deno.test("licensed call for the licensed lane, licensing call for a licensing booking, else the questions call", () => {
  assertEquals(rebookBaseUrl("licensed", "unlicensed"), SCHEDULING_LINKS.licensed);
  assertEquals(rebookBaseUrl("leader", null), SCHEDULING_LINKS.licensed);
  assertEquals(rebookBaseUrl("licensing", "unlicensed"), SCHEDULING_LINKS.licensing);
  assertEquals(rebookBaseUrl(null, "licensed"), SCHEDULING_LINKS.licensed);
  assertEquals(rebookBaseUrl(null, "unlicensed"), SCHEDULING_LINKS.questions);
  assertEquals(rebookBaseUrl("", "pending"), SCHEDULING_LINKS.questions);
});

Deno.test("prefilled, attributed to the application, tagged as a ladder link", () => {
  const u = new URL(rebookUrl({
    callTrack: "licensed", licenseStatus: "licensed", applicationId: "app-1",
    firstName: "Jo", lastName: "Lee", email: "jo@example.com",
  }));
  assertEquals(`${u.origin}${u.pathname}`, SCHEDULING_LINKS.licensed);
  assertEquals(u.searchParams.get("utm_content"), "app-1");
  assertEquals(u.searchParams.get("utm_source"), "nextstep");
  assertEquals(u.searchParams.get("utm_medium"), "email");
  assertEquals(u.searchParams.get("email"), "jo@example.com");
  assertEquals(u.searchParams.get("name"), "Jo Lee");
});
