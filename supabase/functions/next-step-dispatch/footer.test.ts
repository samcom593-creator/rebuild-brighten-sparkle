// MP-ONBOARD-ANCHOR-PKG1: no stage email leaves with the dead "reply STOP" mailto, and none
// leaves with a link that goes nowhere.
// Run: deno test --no-check --allow-read supabase/functions/next-step-dispatch/footer.test.ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasEmptyHref, stripDeadReplyStop } from "./footer.ts";

// The live footer, byte for byte, as read from next_step_stages on 2026-11-11.
const LIVE_FOOTER =
  '<p style="font-size:11px;color:#6b7280;line-height:1.5">Galaxy Financial · Recruiting Communications<br/>You received this because you applied to Galaxy Financial. You can <a href="https://xrzweoneiieddzxogewk.supabase.co/functions/v1/unsubscribe?u=jo%40example.com" style="color:#6b7280">unsubscribe</a> or <a href="mailto:hello@apex-financial.org?subject=STOP">reply STOP</a> to stop these messages.<br/>Galaxy Financial · Dallas, TX</p>';

Deno.test("the dead mailto is removed and the working unsubscribe link is kept", () => {
  const out = stripDeadReplyStop(LIVE_FOOTER);
  assertEquals(out.includes("mailto:"), false);
  assertEquals(/reply STOP/i.test(out), false);
  assertStringIncludes(out, "functions/v1/unsubscribe?u=jo%40example.com");
  assertStringIncludes(out, "You can <a href=\"https://xrzweoneiieddzxogewk.supabase.co/functions/v1/unsubscribe?u=jo%40example.com\" style=\"color:#6b7280\">unsubscribe</a> to stop these messages.");
});

Deno.test("idempotent, and leaves bodies without the footer alone", () => {
  const once = stripDeadReplyStop(LIVE_FOOTER);
  assertEquals(stripDeadReplyStop(once), once);
  assertEquals(stripDeadReplyStop("<p>Jo, hi.</p>"), "<p>Jo, hi.</p>");
  // a mailto on a real inbox is not touched
  const ok = 'Write to <a href="mailto:info@kingofsales.net">us</a>';
  assertEquals(stripDeadReplyStop(ok), ok);
});

Deno.test("an empty href is detected (a token rendered blank)", () => {
  assertEquals(hasEmptyHref('<a href="">Pick a new time</a>'), true);
  assertEquals(hasEmptyHref("<a href=''>x</a>"), true);
  assertEquals(hasEmptyHref('<a href="https://calendly.com/x">x</a>'), false);
});
