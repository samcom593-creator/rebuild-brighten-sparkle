// PL-WIB-CONFIRM-NO-DEAD-LINK. The interview confirmation email must never
// carry a reschedule link nobody configured. Its old hardcoded fallback was the
// deleted Calendly seminar event, so every email shipped a dead button.
// Run: deno test --no-check --allow-read supabase/functions/send-candidate-confirmation/email.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildConfirmationEmail,
  resolveRescheduleUrl,
} from "./email.ts";

const AT = "2026-10-21T19:00:00Z";
const DEAD = "https://calendly.com/apexfinancialempire/interview";

Deno.test("no configured link: no calendly anywhere, reply line instead", () => {
  const e = buildConfirmationEmail("Jordan Price", AT, null);
  assert(!e.html.includes("calendly"), "html still carries a calendly link");
  assert(!e.text.includes("calendly"), "text still carries a calendly link");
  assert(!e.html.includes("<a "), "html renders a button with no target");
  assert(e.text.includes("If the time no longer works, reply to this email."));
  assert(e.html.includes("If the time no longer works, reply to this email."));
  assert(e.text.startsWith("Hey Jordan,"));
});

Deno.test("a configured https link renders as the reschedule button", () => {
  const url = "https://calendly.com/apexfinancialempire/apex-onboarding-call";
  const e = buildConfirmationEmail("Jordan", AT, url);
  assert(e.html.includes(`href="${url}"`));
  assert(e.text.includes(`reschedule here: ${url}`));
  assert(!e.text.includes("reply to this email"));
});

Deno.test("unusable values never become a button", () => {
  for (const bad of ["", "   ", null, undefined, "/schedule", "http://x.test/a", "calendly.com/x", "javascript:alert(1)"]) {
    assertEquals(resolveRescheduleUrl(bad), null, `accepted ${String(bad)}`);
    assert(!buildConfirmationEmail("A", AT, bad ?? null).html.includes("<a "), `button for ${String(bad)}`);
  }
  // A to_jsonb-quoted value (MP-400) is unwrapped, not rejected.
  assertEquals(resolveRescheduleUrl(`"${DEAD}"`), DEAD);
});

Deno.test("user-controlled name is escaped", () => {
  const e = buildConfirmationEmail(`<img src=x onerror=1>`, AT, null);
  assert(!e.html.includes("<img"));
});

// The fix is only real if the sender cannot re-introduce a link on its own.
// Comment lines are skipped so the history in the header cannot trip it.
Deno.test("send-candidate-confirmation has no hardcoded booking URL", async () => {
  const src = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
  assert(!/calendly\.com/i.test(code), "index.ts hardcodes a calendly.com URL again");
  assert(code.includes("buildConfirmationEmail"), "index.ts no longer uses the shared builder");
});
